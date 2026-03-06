/**
 * OWN Audio Storage Client
 * Previously used a separate Supabase project for OWN case audio.
 * Now uses the same Express.js backend with dm-audio bucket.
 */

const API_URL = import.meta.env.VITE_API_URL ?? '';

class OwnStorageBucketClient {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  async upload(filePath: string, file: File | Blob | ArrayBuffer, options?: any): Promise<{ data: any; error: any }> {
    try {
      const formData = new FormData();

      // IMPORTANT: path MUST be appended BEFORE the file field.
      // Multer's diskStorage filename callback runs during file processing,
      // so body fields added after the file won't be available yet.
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

      // Use generous timeout for large audio files (2 min for files > 1MB, 60s otherwise)
      const timeoutMs = blob.size > 1_000_000 ? 120_000 : 60_000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      console.log(`📤 Upload starting: ${filePath} (${(blob.size / 1024).toFixed(0)} KB, timeout ${timeoutMs / 1000}s)`);

      const response = await fetch(`${API_URL}/api/storage/${this.bucket}/upload`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        console.error('❌ Upload server error:', errorData);
        return { data: null, error: errorData };
      }

      const data = await response.json();
      console.log('✅ Upload success:', filePath);
      return { data: data.data, error: null };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('❌ Upload timed out:', filePath);
        return { data: null, error: { message: 'Upload timed out — please check your connection and try again' } };
      }
      console.error('❌ Upload network error:', error.message);
      return { data: null, error: { message: error.message } };
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
