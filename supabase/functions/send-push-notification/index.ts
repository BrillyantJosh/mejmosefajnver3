import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to get a proper ArrayBuffer from Uint8Array
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(arr.length);
  new Uint8Array(buffer).set(arr);
  return buffer;
}

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) {
    padded += '=';
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// HKDF implementation
async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  const saltBuffer = salt.length ? toArrayBuffer(salt) : new ArrayBuffer(32);
  const key = await crypto.subtle.importKey(
    "raw",
    saltBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const prk = await crypto.subtle.sign("HMAC", key, toArrayBuffer(ikm));
  return new Uint8Array(prk);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(prk),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const result = new Uint8Array(length);
  let offset = 0;
  let counter = 1;
  let prev = new Uint8Array(0);
  
  while (offset < length) {
    const input = concatUint8Arrays(prev, info, new Uint8Array([counter]));
    const output = new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(input)));
    const copyLength = Math.min(output.length, length - offset);
    result.set(output.subarray(0, copyLength), offset);
    offset += copyLength;
    prev = output;
    counter++;
  }
  
  return result;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hkdfExtract(salt, ikm);
  return hkdfExpand(prk, info, length);
}

// Generate VAPID JWT
async function generateVapidJwt(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<{ jwt: string; publicKeyBase64Url: string }> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  
  const header = { alg: "ES256", typ: "JWT" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: "mailto:admin@lana.money"
  };
  
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;
  
  const privateKeyBytes = base64UrlDecode(vapidPrivateKey);
  const publicKeyBytes = base64UrlDecode(vapidPublicKey);
  
  // P-256 uncompressed public key is 65 bytes: 0x04 || x (32) || y (32)
  const x = publicKeyBytes.slice(1, 33);
  const y = publicKeyBytes.slice(33, 65);
  
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    d: base64UrlEncode(privateKeyBytes)
  };
  
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsignedToken)
  );
  
  const signature = new Uint8Array(signatureBuffer);
  const signatureB64 = base64UrlEncode(signature);
  
  return {
    jwt: `${unsignedToken}.${signatureB64}`,
    publicKeyBase64Url: vapidPublicKey
  };
}

// Encrypt payload using Web Push encryption (RFC 8291 - aes128gcm)
async function encryptPayload(
  payload: string,
  p256dhKey: string,
  authSecret: string
): Promise<{ encrypted: Uint8Array; serverPublicKey: Uint8Array }> {
  const clientPublicKeyBytes = base64UrlDecode(p256dhKey);
  const authSecretBytes = base64UrlDecode(authSecret);
  
  // Generate ephemeral ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  
  const serverPublicKeyRaw = await crypto.subtle.exportKey("raw", serverKeyPair.publicKey);
  const serverPublicKey = new Uint8Array(serverPublicKeyRaw);
  
  // Import client public key
  const clientPublicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(clientPublicKeyBytes),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  
  // Derive shared secret via ECDH
  const sharedSecretBuffer = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey },
    serverKeyPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBuffer);
  
  // Generate salt (16 random bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  const encoder = new TextEncoder();
  
  // IKM derivation for aes128gcm (RFC 8291)
  const keyInfoInput = concatUint8Arrays(
    encoder.encode("WebPush: info\0"),
    clientPublicKeyBytes,
    serverPublicKey
  );
  const ikm = await hkdf(authSecretBytes, sharedSecret, keyInfoInput, 32);
  
  // Content encryption key
  const cekInfo = encoder.encode("Content-Encoding: aes128gcm\0");
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  
  // Nonce
  const nonceInfo = encoder.encode("Content-Encoding: nonce\0");
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);
  
  // Import CEK for AES-GCM
  const aesKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(cek),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  
  // Pad the payload with delimiter
  const payloadBytes = encoder.encode(payload);
  const paddedPayload = concatUint8Arrays(payloadBytes, new Uint8Array([2]));
  
  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce) },
    aesKey,
    toArrayBuffer(paddedPayload)
  );
  
  // Build aes128gcm content encoding header + ciphertext
  // Format: salt (16) || rs (4) || idlen (1) || keyid (65) || ciphertext
  const rs = new Uint8Array([0, 0, 16, 0]); // record size = 4096
  const idlen = new Uint8Array([65]);
  
  const encrypted = concatUint8Arrays(
    salt,
    rs,
    idlen,
    serverPublicKey,
    new Uint8Array(ciphertext)
  );
  
  return { encrypted, serverPublicKey };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { recipientPubkey, senderDisplayName, messagePreview } = await req.json();

    if (!recipientPubkey) {
      return new Response(
        JSON.stringify({ error: "recipientPubkey is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get VAPID keys from app_settings
    const { data: vapidPublicData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "vapid_public_key")
      .single();

    const { data: vapidPrivateData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "vapid_private_key")
      .single();

    if (!vapidPublicData?.value || !vapidPrivateData?.value) {
      console.error("VAPID keys not configured");
      return new Response(
        JSON.stringify({ error: "Push notifications not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vapidPublicKey = String(vapidPublicData.value).replace(/^"|"$/g, '');
    const vapidPrivateKey = String(vapidPrivateData.value).replace(/^"|"$/g, '');

    console.log("VAPID public key length:", vapidPublicKey.length);
    console.log("VAPID private key length:", vapidPrivateKey.length);

    // Get all push subscriptions for the recipient
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("nostr_hex_id", recipientPubkey);

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscriptions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log("No push subscriptions found for:", recipientPubkey);
      return new Response(
        JSON.stringify({ message: "No subscriptions found", sent: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${subscriptions.length} subscriptions for ${recipientPubkey}`);

    const notificationPayload = JSON.stringify({
      title: `New message from ${senderDisplayName || 'Someone'}`,
      body: messagePreview || 'You have a new message',
      tag: `dm-${Date.now()}`,
      url: '/chat',
    });

    let sentCount = 0;
    const failedEndpoints: string[] = [];

    for (const sub of subscriptions) {
      try {
        console.log(`Processing subscription: ${sub.endpoint.substring(0, 60)}...`);
        console.log(`p256dh length: ${sub.p256dh?.length}, auth length: ${sub.auth?.length}`);

        const { jwt, publicKeyBase64Url } = await generateVapidJwt(
          sub.endpoint,
          vapidPublicKey,
          vapidPrivateKey
        );

        const { encrypted } = await encryptPayload(
          notificationPayload,
          sub.p256dh,
          sub.auth
        );

        console.log(`Encrypted payload size: ${encrypted.length} bytes`);

        const response = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            "Content-Length": String(encrypted.length),
            "TTL": "86400",
            "Urgency": "normal",
            "Authorization": `vapid t=${jwt}, k=${publicKeyBase64Url}`,
          },
          body: toArrayBuffer(encrypted),
        });

        console.log(`Push response: ${response.status} ${response.statusText}`);

        if (response.ok || response.status === 201) {
          sentCount++;
          console.log(`✅ Push sent successfully to ${sub.endpoint.substring(0, 50)}...`);
        } else if (response.status === 410 || response.status === 404) {
          console.log(`🗑️ Removing expired subscription: ${sub.endpoint.substring(0, 50)}...`);
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id);
          failedEndpoints.push(sub.endpoint);
        } else {
          const errorText = await response.text();
          console.error(`❌ Failed to send push: ${response.status} - ${errorText}`);
          failedEndpoints.push(sub.endpoint);
        }
      } catch (error) {
        console.error(`❌ Error sending to ${sub.endpoint}:`, error);
        failedEndpoints.push(sub.endpoint);
      }
    }

    return new Response(
      JSON.stringify({ 
        message: "Push notifications processed",
        sent: sentCount,
        failed: failedEndpoints.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-push-notification:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
