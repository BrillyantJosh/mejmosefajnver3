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

      if (file instanceof File) {
        formData.append('file', file);
      } else if (file instanceof Blob) {
        formData.append('file', file, filePath);
      } else if (file instanceof ArrayBuffer) {
        formData.append('file', new Blob([file]), filePath);
      }

      const response = await fetch(`${API_URL}/api/storage/${this.bucket}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        return { data: null, error: errorData };
      }

      const data = await response.json();
      return { data: data.data, error: null };
    } catch (error: any) {
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
