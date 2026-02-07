/**
 * API Client Adaptor - Drop-in replacement for @supabase/supabase-js
 *
 * This module mimics the Supabase client API so that all 66+ frontend files
 * that import { supabase } from "@/integrations/supabase/client" continue
 * to work WITHOUT any changes.
 *
 * Instead of Supabase, calls go to our Express.js backend.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================
// Query Builder - mimics supabase.from(table)
// =============================================

class QueryBuilder {
  private table: string;
  private method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET';
  private params: URLSearchParams = new URLSearchParams();
  private body: any = null;
  private isSingle = false;
  private isMaybeSingle = false;
  private isUpsert = false;
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private isCount = false;
  private selectColumns = '*';

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string) {
    this.method = 'GET';
    if (columns && columns !== '*') {
      this.selectColumns = columns;
      this.params.set('select', columns);
    }
    return this;
  }

  insert(data: any | any[]) {
    this.method = 'POST';
    this.body = data;
    return this;
  }

  upsert(data: any | any[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.method = 'POST';
    this.body = data;
    this.isUpsert = true;
    this.upsertOptions = options || {};
    return this;
  }

  update(data: any) {
    this.method = 'PATCH';
    this.body = data;
    return this;
  }

  delete() {
    this.method = 'DELETE';
    return this;
  }

  // Filter methods
  eq(column: string, value: any) {
    this.params.set(column, `eq.${value}`);
    return this;
  }

  neq(column: string, value: any) {
    this.params.set(column, `neq.${value}`);
    return this;
  }

  gt(column: string, value: any) {
    this.params.set(column, `gt.${value}`);
    return this;
  }

  gte(column: string, value: any) {
    this.params.set(column, `gte.${value}`);
    return this;
  }

  lt(column: string, value: any) {
    this.params.set(column, `lt.${value}`);
    return this;
  }

  lte(column: string, value: any) {
    this.params.set(column, `lte.${value}`);
    return this;
  }

  like(column: string, value: string) {
    this.params.set(column, `like.${value}`);
    return this;
  }

  ilike(column: string, value: string) {
    this.params.set(column, `ilike.${value}`);
    return this;
  }

  is(column: string, value: any) {
    this.params.set(column, `is.${value}`);
    return this;
  }

  in(column: string, values: any[]) {
    this.params.set(column, `in.(${values.join(',')})`);
    return this;
  }

  // Ordering and limiting
  order(column: string, options?: { ascending?: boolean }) {
    const dir = options?.ascending === false ? 'desc' : 'asc';
    const existing = this.params.get('order');
    if (existing) {
      this.params.set('order', `${existing},${column}.${dir}`);
    } else {
      this.params.set('order', `${column}.${dir}`);
    }
    return this;
  }

  limit(count: number) {
    this.params.set('limit', String(count));
    return this;
  }

  // Result mode
  single() {
    this.isSingle = true;
    this.params.set('single', 'true');
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    this.params.set('maybeSingle', 'true');
    return this;
  }

  // Execute the query
  async then(resolve: (value: any) => void, reject?: (reason: any) => void) {
    try {
      const result = await this.execute();
      resolve(result);
    } catch (error) {
      if (reject) reject(error);
      else resolve({ data: null, error });
    }
  }

  private async execute(): Promise<{ data: any; error: any; count?: number }> {
    try {
      let url = `${API_URL}/api/db/${this.table}`;

      // Add upsert params
      if (this.isUpsert) {
        if (this.upsertOptions.onConflict) {
          this.params.set('onConflict', this.upsertOptions.onConflict);
        }
        if (this.upsertOptions.ignoreDuplicates) {
          this.params.set('ignoreDuplicates', 'true');
        }
        this.params.set('upsert', 'true');
      }

      const queryString = this.params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }

      const options: RequestInit = {
        method: this.method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (this.body !== null && (this.method === 'POST' || this.method === 'PATCH')) {
        options.body = JSON.stringify(this.body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));

        // Handle single() with no results like Supabase does
        if (this.isSingle && response.status === 406) {
          return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
        }

        return { data: null, error: errorData };
      }

      const data = await response.json();

      // Handle count mode
      if (this.isCount) {
        return { data: data.data || data, error: null, count: data.count };
      }

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error: { message: error.message } };
    }
  }
}

// =============================================
// Storage Client - mimics supabase.storage
// =============================================

class StorageBucketClient {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  async upload(filePath: string, file: File | Blob | ArrayBuffer, options?: any): Promise<{ data: any; error: any }> {
    try {
      const formData = new FormData();

      if (file instanceof File) {
        formData.append('file', file);
      } else if (file instanceof Blob) {
        formData.append('file', file, filePath);
      } else if (file instanceof ArrayBuffer) {
        formData.append('file', new Blob([file]), filePath);
      }

      formData.append('path', filePath);

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

  async remove(paths: string[]): Promise<{ data: any; error: any }> {
    try {
      for (const p of paths) {
        await fetch(`${API_URL}/api/storage/${this.bucket}/${p}`, {
          method: 'DELETE',
        });
      }
      return { data: { message: 'Files deleted' }, error: null };
    } catch (error: any) {
      return { data: null, error: { message: error.message } };
    }
  }
}

class StorageClient {
  from(bucket: string): StorageBucketClient {
    return new StorageBucketClient(bucket);
  }
}

// =============================================
// Functions Client - mimics supabase.functions
// =============================================

class FunctionsClient {
  async invoke(functionName: string, options?: { body?: any }): Promise<{ data: any; error: any }> {
    try {
      const response = await fetch(`${API_URL}/api/functions/${functionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        return { data: null, error: { message: errorData.error || response.statusText } };
      }

      const data = await response.json();
      return { data, error: null };
    } catch (error: any) {
      return { data: null, error: { message: error.message } };
    }
  }
}

// =============================================
// Channel / Realtime - mimics supabase.channel()
// =============================================

type RealtimeCallback = (payload: any) => void;

class RealtimeChannel {
  private channelName: string;
  private listeners: Array<{ event: string; schema: string; table: string; filter?: string; callback: RealtimeCallback }> = [];
  private eventSource: EventSource | null = null;

  constructor(name: string) {
    this.channelName = name;
  }

  on(event: string, config: { event: string; schema: string; table: string; filter?: string }, callback: RealtimeCallback): RealtimeChannel {
    this.listeners.push({
      event: config.event,
      schema: config.schema,
      table: config.table,
      filter: config.filter,
      callback
    });
    return this;
  }

  subscribe(): RealtimeChannel {
    // Find dm_read_status listener to extract user filter
    const dmListener = this.listeners.find(l => l.table === 'dm_read_status');
    if (dmListener && dmListener.filter) {
      // Extract user_nostr_id from filter like "user_nostr_id=eq.abc123"
      const match = dmListener.filter.match(/user_nostr_id=eq\.(.+)/);
      if (match) {
        const userId = match[1];
        const url = `${API_URL}/api/sse/dm-read-status?user=${userId}`;

        this.eventSource = new EventSource(url);

        this.eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'dm_read_status_update') {
              for (const listener of this.listeners) {
                if (listener.table === 'dm_read_status') {
                  listener.callback({
                    eventType: data.eventType,
                    new: data.new,
                    old: {},
                    schema: 'public',
                    table: 'dm_read_status'
                  });
                }
              }
            }
          } catch {}
        };

        this.eventSource.onerror = () => {
          console.warn('SSE connection error, will retry...');
        };
      }
    }
    return this;
  }

  unsubscribe(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// =============================================
// Main Client - mimics createClient() result
// =============================================

class ApiClient {
  storage = new StorageClient();
  functions = new FunctionsClient();
  private channels = new Map<string, RealtimeChannel>();

  from(table: string): QueryBuilder {
    return new QueryBuilder(table);
  }

  channel(name: string): RealtimeChannel {
    const ch = new RealtimeChannel(name);
    this.channels.set(name, ch);
    return ch;
  }

  removeChannel(channel: RealtimeChannel): void {
    channel.unsubscribe();
    // Remove from map
    for (const [name, ch] of this.channels) {
      if (ch === channel) {
        this.channels.delete(name);
        break;
      }
    }
  }

  // Auth stub - not used (Nostr key-based auth)
  auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    signInWithPassword: async () => ({ data: null, error: { message: 'Use Nostr auth' } }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: (callback: any) => {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
  };
}

// Export singleton instance (same as Supabase pattern)
export const supabase = new ApiClient();
