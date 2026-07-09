/**
 * OWN Audio Storage Client
 * Uploads to the Express.js backend (dm-audio bucket).
 *
 * Uses XMLHttpRequest (NOT fetch) because on iOS Safari a large multipart fetch()
 * fails opaquely with TypeError("Load failed") on weak/changing links and gives no
 * timeout or upload progress. XHR gives us a real timeout, an upload-progress stall
 * watchdog, and classifiable events — the control surface needed to detect a frozen
 * connection and retry it. Every upload is retried with jittered exponential backoff.
 */

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface UploadError extends Error {
  code?: string;
  status?: number;
  retryable?: boolean;
}

function makeErr(message: string, code: string, retryable: boolean, status?: number): UploadError {
  const e = new Error(message) as UploadError;
  e.code = code;
  e.retryable = retryable;
  e.status = status;
  return e;
}

/**
 * One upload attempt via XHR. Resolves with the parsed JSON body on 2xx, rejects with a
 * classified UploadError otherwise. A bytes-based stall watchdog aborts (retryable) when
 * no upload progress happens for `stallMs` — catches Safari's frozen keep-alive reuse
 * that a whole-request timeout is too slow to notice.
 */
function xhrUploadOnce(
  url: string,
  formData: FormData,
  { timeoutMs, stallMs, idempotencyKey }: { timeoutMs: number; stallMs: number; idempotencyKey?: string },
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastLoaded = 0;
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStall = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };
    const armStall = () => {
      clearStall();
      stallTimer = setTimeout(() => {
        stalled = true; // onabort will reject as a retryable STALL
        try { xhr.abort(); } catch { /* ignore */ }
      }, stallMs);
    };

    xhr.open('POST', url, true);
    xhr.timeout = timeoutMs; // real timeout → ontimeout (fetch has none)
    if (idempotencyKey) {
      try { xhr.setRequestHeader('Idempotency-Key', idempotencyKey); } catch { /* ignore */ }
    }
    // IMPORTANT: never setRequestHeader('Content-Type', …) — let the browser generate the
    // multipart boundary (a manual Content-Type produces malformed file parts on Safari).

    xhr.upload.onloadstart = armStall;
    xhr.upload.onprogress = (e) => {
      if (e.loaded > lastLoaded) {
        lastLoaded = e.loaded;
        armStall(); // progress resets the watchdog
      }
    };
    // Body fully sent → disarm the stall watchdog and let xhr.timeout govern the
    // response phase. Otherwise a slow server response (> stallMs) would abort a
    // fully-uploaded (already-stored) request and force a needless re-upload.
    xhr.upload.onloadend = clearStall;
    xhr.onload = () => {
      clearStall();
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(null); }
        return;
      }
      let msg = `HTTP ${xhr.status}`;
      try {
        const j = JSON.parse(xhr.responseText);
        msg = j?.error?.message || j?.error || j?.message || msg;
      } catch { /* keep default */ }
      const retryable = xhr.status >= 500 || xhr.status === 429; // 4xx (except 429) is terminal
      reject(makeErr(msg, 'HTTP', retryable, xhr.status));
    };
    xhr.onerror = () => { clearStall(); reject(makeErr('Network error', 'NETWORK', true)); };
    xhr.ontimeout = () => { clearStall(); reject(makeErr('Upload timed out — check your connection', 'TIMEOUT', true)); };
    xhr.onabort = () => {
      clearStall();
      if (stalled) reject(makeErr('Connection stalled — retrying', 'STALL', true));
      else reject(makeErr('Upload aborted', 'ABORT', false));
    };

    xhr.send(formData); // re-sending the same FormData re-reads the Blob, so retries are safe
  });
}

class OwnStorageBucketClient {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  async upload(filePath: string, file: File | Blob | ArrayBuffer, _options?: any): Promise<{ data: any; error: any }> {
    const formData = new FormData();
    // IMPORTANT: path MUST be appended BEFORE the file field (multer's diskStorage
    // filename callback runs during file processing).
    formData.append('path', filePath);

    let blob: Blob;
    if (file instanceof File) {
      blob = file;
      formData.append('file', file);
    } else if (file instanceof Blob) {
      blob = file;
      formData.append('file', file, filePath);
    } else if (file instanceof ArrayBuffer) {
      blob = new Blob([file]);
      formData.append('file', blob, filePath);
    } else {
      blob = new Blob();
      formData.append('file', blob, filePath);
    }

    const url = `${API_URL}/api/storage/${this.bucket}/upload`;
    const timeoutMs = blob.size > 1_000_000 ? 120_000 : 60_000;
    const stallMs = 20_000; // no bytes moved for 20s → treat the connection as dead + retry
    const RETRIES = 3;

    console.log(`📤 Upload starting: ${filePath} (${(blob.size / 1024).toFixed(0)} KB) via XHR, up to ${RETRIES + 1} tries`);

    for (let attempt = 1; ; attempt++) {
      try {
        // Same filePath across retries → the disk write is an idempotent overwrite (no dup files).
        const data = await xhrUploadOnce(url, formData, { timeoutMs, stallMs, idempotencyKey: filePath });
        console.log(`✅ Upload success: ${filePath}`);
        return { data: data?.data ?? data, error: null };
      } catch (err) {
        const e = err as UploadError;
        if (!e.retryable || attempt > RETRIES) {
          console.error(`❌ Upload failed (${e.code}) after ${attempt} attempt(s):`, e.message);
          return { data: null, error: { message: e.message, code: e.code, status: e.status } };
        }
        const cap = Math.min(15_000, 1000 * 2 ** (attempt - 1));
        const delay = Math.random() * cap; // full jitter
        console.warn(`↻ Upload attempt ${attempt} failed (${e.code}); retrying in ${Math.round(delay)}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  getPublicUrl(filePath: string): { data: { publicUrl: string } } {
    const publicUrl = `${API_URL}/api/storage/${this.bucket}/${filePath}`;
    return { data: { publicUrl } };
  }
}

class OwnStorageClient {
  from(bucket: string): OwnStorageBucketClient {
    return new OwnStorageBucketClient(bucket);
  }
}

class OwnClient {
  storage = new OwnStorageClient();
}

export const ownSupabase = new OwnClient();
export const OWN_PROJECT_ID = 'local';
