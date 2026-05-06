/**
 * Robust camera setup for html5-qrcode.
 *
 * iOS Safari (especially on Pro iPhones with wide+ultrawide+telephoto trio)
 * needs special handling:
 *   1. Request `getUserMedia({ facingMode: 'environment' })` to trigger the
 *      permission prompt. Without this, camera labels are empty and we can't
 *      distinguish telephoto from wide.
 *   2. Enumerate cameras (now with labels) and pick a *wide* back camera.
 *      Telephoto can't focus on close objects (QR codes), so we explicitly
 *      avoid it — this was the root cause of "Start Camera doesn't focus".
 *   3. Stop the temporary permission stream so html5-qrcode can open its own.
 *
 * Returns the camera ID to pass to `Html5Qrcode.start()`. Throws on failure
 * with a user-friendly message in `error.message`.
 */
import { Html5Qrcode } from 'html5-qrcode';

export class QRCameraError extends Error {
  constructor(message: string, public readonly code:
    | 'no-mediadevices'
    | 'permission-denied'
    | 'no-camera'
    | 'camera-busy'
    | 'unknown',
  ) {
    super(message);
    this.name = 'QRCameraError';
  }
}

/** Acquire permission and return the best back-camera id for QR scanning. */
export async function pickBackCameraId(): Promise<string> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new QRCameraError('Camera not available in this browser.', 'no-mediadevices');
  }

  // 1. Permission prompt with environment hint
  let permissionStream: MediaStream | null = null;
  try {
    permissionStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (permErr: any) {
    const name = permErr?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new QRCameraError(
        'Camera permission denied. Open Safari Settings → Camera → Allow.',
        'permission-denied',
      );
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new QRCameraError('No camera found on this device.', 'no-camera');
    }
    if (name === 'NotReadableError') {
      throw new QRCameraError(
        'Camera is in use by another app. Close it and try again.',
        'camera-busy',
      );
    }
    throw new QRCameraError(
      `Camera error: ${permErr?.message || name || 'Please check permissions.'}`,
      'unknown',
    );
  }

  let chosenId: string;
  try {
    // 2. Enumerate, prefer wide back, avoid telephoto/ultrawide/depth
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      throw new QRCameraError('No camera found on this device.', 'no-camera');
    }

    if (cameras.length === 1) {
      chosenId = cameras[0].id;
    } else {
      const wideBack = cameras.find((c) => {
        const l = (c.label || '').toLowerCase();
        const isBack = l.includes('back') || l.includes('rear') || l.includes('environment');
        const isWide = !l.includes('tele') && !l.includes('ultra') && !l.includes('depth');
        return isBack && isWide;
      });
      const anyBack = cameras.find((c) => {
        const l = (c.label || '').toLowerCase();
        return l.includes('back') || l.includes('rear') || l.includes('environment');
      });
      chosenId = (wideBack || anyBack || cameras[0]).id;
    }
  } finally {
    // 3. Free the temporary stream
    permissionStream?.getTracks().forEach((t) => t.stop());
  }

  // 4. Give the OS a moment to actually release the camera. On Android Chrome
  //    and Samsung Internet, calling getUserMedia again immediately after a
  //    track.stop() can fail with NotReadableError ("Could not start video
  //    source"). 250 ms is enough on every device we've tested.
  await new Promise<void>((resolve) => setTimeout(resolve, 250));

  return chosenId;
}

/**
 * Start an Html5Qrcode scanner with automatic retry on NotReadableError.
 * Some browsers (Android Chrome, Samsung Internet, occasionally iOS Safari
 * after a permission grant) fail the first start() call with "Could not
 * start video source" because the camera isn't yet released. One retry
 * after 600 ms reliably succeeds.
 */
export async function startScannerWithRetry(
  scanner: Html5Qrcode,
  cameraId: string,
  config: any,
  onSuccess: (decoded: string) => void,
  onError?: (msg: string) => void,
): Promise<void> {
  const _onError = onError ?? (() => { /* per-frame decode failures — ignore */ });
  try {
    await scanner.start(cameraId, config, onSuccess, _onError);
  } catch (err: any) {
    const msg = (err?.message || err?.name || '').toLowerCase();
    const isReadable =
      msg.includes('could not start video source') ||
      msg.includes('notreadableerror') ||
      err?.name === 'NotReadableError';
    if (!isReadable) throw err;

    // Retry once after a longer delay
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    await scanner.start(cameraId, config, onSuccess, _onError);
  }
}

/** Default html5-qrcode config tuned for new iPhones. */
export const DEFAULT_QR_CONFIG = {
  fps: 10,
  qrbox: { width: 280, height: 280 },
  aspectRatio: 1.0,
} as const;
