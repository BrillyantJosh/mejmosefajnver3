/**
 * Robust camera setup for html5-qrcode across iOS Safari and Android Chrome.
 *
 * Three failure modes we have to dance around:
 *  1. iOS Pro iPhones expose wide+ultrawide+telephoto trio. Telephoto can't
 *     focus on close QR codes, so we must avoid it.
 *  2. Camera labels are empty until permission is granted, so we can't pick
 *     the wide camera by name without first calling getUserMedia.
 *  3. Calling getUserMedia twice in a row (once for permission, once for
 *     html5-qrcode) sometimes fails the second call with NotReadableError
 *     ("Could not start video source") on Android Chrome / Samsung Internet
 *     because the OS hasn't released the camera between calls.
 *
 * Strategy in `startQRScanner` (preferred entry point):
 *   1. First try html5-qrcode's `start({ facingMode: 'environment' })` —
 *      ONE getUserMedia call, no race. Works everywhere except iPhone Pro
 *      where the OS may pick telephoto.
 *   2. If that fails OR the picked stream is telephoto, fall back to
 *      `pickBackCameraId()` (label-based wide-camera selection) and retry
 *      with explicit deviceId.
 *   3. On NotReadableError at any step, retry once after 600 ms.
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

/** Default html5-qrcode config tuned for new iPhones. */
export const DEFAULT_QR_CONFIG = {
  fps: 10,
  qrbox: { width: 280, height: 280 },
  aspectRatio: 1.0,
} as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Map low-level browser errors to user-facing messages + a stable error code. */
function classifyError(err: any): QRCameraError {
  const name = err?.name || '';
  const msg = (err?.message || '').toLowerCase();

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.includes('permission')) {
    return new QRCameraError(
      'Camera permission denied. Open browser settings → Site permissions → Camera → Allow.',
      'permission-denied',
    );
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || msg.includes('not found')) {
    return new QRCameraError('No camera found on this device.', 'no-camera');
  }
  if (
    name === 'NotReadableError' ||
    msg.includes('could not start video source') ||
    msg.includes('notreadableerror') ||
    msg.includes('in use')
  ) {
    return new QRCameraError(
      'Camera is busy. Close any other tab or app that may be using the camera, then try again.',
      'camera-busy',
    );
  }
  return new QRCameraError(
    `Camera error: ${err?.message || err?.name || 'Please check permissions.'}`,
    'unknown',
  );
}

/**
 * Enumerate cameras and pick the standard wide back camera.
 * Caller has already obtained permission so labels are populated.
 */
async function pickWideBackCameraId(): Promise<string | null> {
  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) return null;
    if (cameras.length === 1) return cameras[0].id;

    const wideBack = cameras.find((c) => {
      const l = (c.label || '').toLowerCase();
      const isBack = l.includes('back') || l.includes('rear') || l.includes('environment');
      const isWide = !l.includes('tele') && !l.includes('ultra') && !l.includes('depth');
      return isBack && isWide;
    });
    if (wideBack) return wideBack.id;

    const anyBack = cameras.find((c) => {
      const l = (c.label || '').toLowerCase();
      return l.includes('back') || l.includes('rear') || l.includes('environment');
    });
    return (anyBack || cameras[0]).id;
  } catch {
    return null;
  }
}

/**
 * High-level scanner starter. Returns when the scanner is running.
 * Throws QRCameraError on permanent failure.
 *
 * Strategy (in order):
 *  A. start with `{ facingMode: { ideal: 'environment' } }` — one getUserMedia,
 *     no race. Works on most Androids out of the box.
 *  B. If A fails OR returns telephoto on iPhone, stop & retry with explicit
 *     deviceId of the wide back camera.
 *  C. If B fails with NotReadableError, sleep 600 ms and retry once more.
 */
export async function startQRScanner(
  scanner: Html5Qrcode,
  config: any,
  onSuccess: (decoded: string) => void,
  onError?: (msg: string) => void,
): Promise<void> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new QRCameraError('Camera not available in this browser.', 'no-mediadevices');
  }

  const _onError = onError ?? (() => { /* per-frame decode failures — ignore */ });

  // ── Path A: simple facingMode constraint ──────────────────────────────
  try {
    await scanner.start(
      { facingMode: { ideal: 'environment' } } as any,
      config,
      onSuccess,
      _onError,
    );

    // If the actual track is telephoto (iPhone Pro), tear down and pick wide.
    // Heuristic: read the active video track label.
    const stream = (scanner as any).getRunningTrackCameraCapabilities?.()?.aspectRatio
      ? null
      : null; // capabilities API isn't reliable across browsers
    const label = (scanner as any)._localMediaStream?.getVideoTracks?.()?.[0]?.label || '';
    const looksTelephoto = /tele/i.test(label);
    if (!looksTelephoto) return; // success on path A

    // Telephoto picked → switch to wide back via path B
    try { await scanner.stop(); } catch { /* ignore */ }
    await sleep(300);
  } catch (errA: any) {
    const classified = classifyError(errA);
    // Permission denied is final — never recoverable on path B
    if (classified.code === 'permission-denied') throw classified;
    // Otherwise fall through to path B
    console.warn('[qr-camera] facingMode start failed, falling back to enumerated:', errA);
  }

  // ── Path B: label-based wide back camera ──────────────────────────────
  const wideId = await pickWideBackCameraId();
  if (!wideId) {
    throw new QRCameraError('No camera found on this device.', 'no-camera');
  }

  try {
    await scanner.start(wideId, config, onSuccess, _onError);
    return;
  } catch (errB: any) {
    const classified = classifyError(errB);

    // ── Path C: retry once on camera-busy ────────────────────────────────
    if (classified.code === 'camera-busy') {
      console.warn('[qr-camera] camera busy, retrying after 600 ms…');
      await sleep(600);
      try {
        await scanner.start(wideId, config, onSuccess, _onError);
        return;
      } catch (errC: any) {
        throw classifyError(errC);
      }
    }

    throw classified;
  }
}

/**
 * @deprecated Prefer `startQRScanner` which handles all failure modes.
 * Kept for backwards compatibility with existing call-sites.
 */
export async function pickBackCameraId(): Promise<string> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new QRCameraError('Camera not available in this browser.', 'no-mediadevices');
  }

  let permissionStream: MediaStream | null = null;
  try {
    permissionStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    throw classifyError(err);
  }

  try {
    const id = await pickWideBackCameraId();
    if (!id) throw new QRCameraError('No camera found on this device.', 'no-camera');
    return id;
  } finally {
    permissionStream?.getTracks().forEach((t) => t.stop());
    await sleep(250);
  }
}

/**
 * @deprecated Prefer `startQRScanner` which handles facingMode + retry as a unit.
 */
export async function startScannerWithRetry(
  scanner: Html5Qrcode,
  cameraId: string,
  config: any,
  onSuccess: (decoded: string) => void,
  onError?: (msg: string) => void,
): Promise<void> {
  const _onError = onError ?? (() => {});
  try {
    await scanner.start(cameraId, config, onSuccess, _onError);
  } catch (err: any) {
    const classified = classifyError(err);
    if (classified.code !== 'camera-busy') throw classified;
    await sleep(600);
    try {
      await scanner.start(cameraId, config, onSuccess, _onError);
    } catch (err2: any) {
      throw classifyError(err2);
    }
  }
}
