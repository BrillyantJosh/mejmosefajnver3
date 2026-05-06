/**
 * Shared QR scanning primitives — adopted from mobile.lanapays.us where this
 * approach has proven reliable across iOS Safari, Android Chrome, Samsung
 * Internet, Brave, etc.
 *
 * Key design decisions:
 *   • One getUserMedia call with `facingMode: 'environment'`. The OS picks
 *     the back camera and we never enumerate, so there's no second-call
 *     race that previously produced "Could not start video source".
 *   • Pure jsQR decode on a hidden <canvas>. No html5-qrcode DOM injection
 *     fighting React's lifecycle.
 *   • Adaptive thresholding (17×17 local mean via integral image) decodes
 *     QR codes printed on metal, dark plastic, screens, paper — anything.
 *
 * The high-level <QRScanner> dialog component lives in `components/QRScanner.tsx`
 * and uses these primitives directly. Inline scanners (Send / Pay / Sell flows
 * that show the camera feed in the page rather than a dialog) build their own
 * UI but share `useJsQRScanner` here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// Process at half resolution — enough pixels for jsQR at any reasonable
// distance, while keeping the adaptive threshold fast on mobile CPUs.
export const SCAN_WIDTH = 640;
export const SCAN_HEIGHT = 360;

export const DEFAULT_QR_CONFIG = {
  fps: 10,
  qrbox: { width: 280, height: 280 },
  aspectRatio: 1.0,
} as const;

// Kept for backwards compatibility with old call-sites that import these names.
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

/**
 * Adaptive 17×17 local-mean threshold. Mutates `imageData.data` in place.
 *
 * Operates against pre-allocated typed arrays (Uint8Array gray, Int32Array
 * integral) supplied by the caller — keeps GC pressure to zero across the
 * scan loop.
 */
export function adaptiveThreshold(
  imageData: ImageData,
  gray: Uint8Array,
  integral: Int32Array,
): void {
  const { data, width, height } = imageData;
  const S = 8;        // half-window → 17×17 neighbourhood
  const T = 0.85;     // pixel is "dark" if < T × local mean
  const w1 = width + 1;

  // Step 1 — luminance-weighted grayscale
  for (let i = 0, j = 0; j < data.length; i++, j += 4) {
    gray[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) | 0;
  }

  // Step 2 — build summed-area table (integral image)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      integral[(y + 1) * w1 + (x + 1)] =
        gray[y * width + x]
        + integral[y * w1 + (x + 1)]
        + integral[(y + 1) * w1 + x]
        - integral[y * w1 + x];
    }
  }

  // Step 3 — threshold each pixel against its local mean
  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - S);
    const y2 = Math.min(height - 1, y + S);
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - S);
      const x2 = Math.min(width - 1, x + S);
      const cnt = (y2 - y1 + 1) * (x2 - x1 + 1);
      const sum =
          integral[(y2 + 1) * w1 + (x2 + 1)]
        - integral[y1 * w1 + (x2 + 1)]
        - integral[(y2 + 1) * w1 + x1]
        + integral[y1 * w1 + x1];
      const val = gray[y * width + x] < (sum / cnt) * T ? 0 : 255;
      const j = (y * width + x) * 4;
      data[j] = data[j + 1] = data[j + 2] = val;
    }
  }
}

/** Map low-level browser errors to user-facing messages. */
export function describeCameraError(err: any): string {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission denied. Allow camera access in browser settings.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'Camera is in use by another app or tab.';
  }
  return `Camera error: ${err?.message || name || 'Failed to start camera'}`;
}

/**
 * React hook driving an inline QR scanner. Hand it the active <video> and
 * <canvas> refs, plus an `enabled` flag; it manages camera lifecycle and
 * calls `onScan` exactly once when a code is decoded.
 */
export function useJsQRScanner(opts: {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onScan: (data: string) => void;
}) {
  const { enabled, videoRef, canvasRef, onScan } = opts;
  const animRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const grayRef = useRef(new Uint8Array(SCAN_WIDTH * SCAN_HEIGHT));
  const integralRef = useRef(new Int32Array((SCAN_WIDTH + 1) * (SCAN_HEIGHT + 1)));

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || doneRef.current) {
      animRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      animRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    canvas.width = SCAN_WIDTH;
    canvas.height = SCAN_HEIGHT;
    ctx.drawImage(video, 0, 0, SCAN_WIDTH, SCAN_HEIGHT);

    const imageData = ctx.getImageData(0, 0, SCAN_WIDTH, SCAN_HEIGHT);
    adaptiveThreshold(imageData, grayRef.current, integralRef.current);

    const code = jsQR(imageData.data, SCAN_WIDTH, SCAN_HEIGHT, {
      inversionAttempts: 'attemptBoth',
    });

    if (code && !doneRef.current) {
      doneRef.current = true;
      cleanup();
      onScan(code.data);
      return;
    }

    animRef.current = requestAnimationFrame(scanFrame);
  }, [videoRef, canvasRef, onScan, cleanup]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsScanning(true);
        setError(null);
        animRef.current = requestAnimationFrame(scanFrame);
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      setError(describeCameraError(err));
    }
  }, [videoRef, scanFrame]);

  // Auto-start when enabled, auto-cleanup on disable / unmount.
  useEffect(() => {
    if (!enabled) return;
    doneRef.current = false;
    setError(null);
    const timer = setTimeout(() => start(), 150);
    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [enabled, start, cleanup]);

  return { isScanning, error, stop: cleanup };
}
