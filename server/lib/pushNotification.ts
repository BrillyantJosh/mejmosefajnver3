import webpush from 'web-push';
import Database from 'better-sqlite3';

/**
 * Send a push notification to a user by their Nostr hex ID.
 * Reusable function extracted from the send-push-notification route.
 * Returns { sent: boolean, sentCount: number, reason?: string }
 */
export async function sendPushToUser(
  db: Database.Database,
  nostrHexId: string,
  payload: { title: string; body: string; icon?: string; badge?: string; url?: string; tag?: string }
): Promise<{ sent: boolean; sentCount: number; reason?: string }> {
  try {
    // Get VAPID keys from app_settings
    const vapidPublicSetting = db.prepare(`SELECT value FROM app_settings WHERE key = 'vapid_public_key'`).get() as any;
    const vapidPrivateSetting = db.prepare(`SELECT value FROM app_settings WHERE key = 'vapid_private_key'`).get() as any;

    if (!vapidPublicSetting || !vapidPrivateSetting) {
      return { sent: false, sentCount: 0, reason: 'VAPID keys not configured' };
    }

    const vapidPublicKey = JSON.parse(vapidPublicSetting.value);
    const vapidPrivateKey = JSON.parse(vapidPrivateSetting.value);

    webpush.setVapidDetails(
      'mailto:admin@mejmosefajn.com',
      vapidPublicKey,
      vapidPrivateKey
    );

    // Get recipient's push subscriptions
    const subscriptions = db.prepare(`
      SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE nostr_hex_id = ?
    `).all(nostrHexId);

    if (subscriptions.length === 0) {
      return { sent: false, sentCount: 0, reason: 'No push subscriptions found' };
    }

    const jsonPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-192.png',
      data: {
        url: payload.url || '/',
        tag: payload.tag,
      },
    });

    let sentCount = 0;
    for (const sub of subscriptions as any[]) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, jsonPayload);
        sentCount++;
      } catch (pushError: any) {
        if (pushError.statusCode === 410 || pushError.statusCode === 404) {
          // Subscription expired, remove it
          db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(sub.endpoint);
        }
      }
    }

    return { sent: sentCount > 0, sentCount };
  } catch (error: any) {
    console.error('Push notification error:', error.message);
    return { sent: false, sentCount: 0, reason: error.message };
  }
}
