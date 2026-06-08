// ─────────────────────────────────────────────────────────────────────────────
//  Lana Media Server — browser upload helper (media.lanaloves.us)
//  Auth: secp256k1 ECDSA (DER) signature over SHA-256("lana-media-upload:" + ts).
//  Pubkey header is the x-only (Nostr) pubkey hex. Images are re-encoded to JPEG
//  (max 1200px, q80, ≤10MB) server-side; documents ≤50MB.
//  Mirrors being3/public/lana-media.js, using the repo's `elliptic` + WebCrypto.
// ─────────────────────────────────────────────────────────────────────────────
import elliptic from "elliptic";

const ec = new elliptic.ec("secp256k1");
const MEDIA_BASE = "https://media.lanaloves.us";

export interface LanaMediaResult {
  url: string;
  filename: string;
  size: number;
  mime_type: string;
  category: "image" | "document";
  width?: number;
  height?: number;
}

/**
 * Upload a File/Blob to media.lanaloves.us and return the permanent absolute URL.
 * @param file     image/document to upload
 * @param privHex  64-char hex secp256k1 private key (session.nostrPrivateKey)
 * @param pubHex   x-only Nostr pubkey hex (session.nostrHexId)
 */
export async function uploadToLanaMedia(
  file: File | Blob,
  privHex: string,
  pubHex: string,
): Promise<LanaMediaResult> {
  if (!/^[0-9a-f]{64}$/i.test(privHex)) throw new Error("Valid 64-char hex private key required");

  const ts = Math.floor(Date.now() / 1000);
  const msg = new TextEncoder().encode("lana-media-upload:" + ts);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", msg));

  // Standard ECDSA DER signature (canonical/low-S to match the noble reference impl).
  const key = ec.keyFromPrivate(privHex, "hex");
  const sigHex = key.sign(digest, { canonical: true }).toDER("hex");

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${MEDIA_BASE}/api/upload`, {
    method: "POST",
    headers: {
      "X-Upload-Pubkey": pubHex,
      "X-Upload-Timestamp": String(ts),
      "X-Upload-Sig": sigHex,
    },
    body: form,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Media upload failed (${res.status})`);
  return json as LanaMediaResult;
}
