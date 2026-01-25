export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string | null
          id: string
          last_seen_at: string | null
          nostr_hex_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_seen_at?: string | null
          nostr_hex_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          last_seen_at?: string | null
          nostr_hex_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_knowledge: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          id: string
          keywords: string[] | null
          lang: string
          nostr_event_id: string | null
          revision: number
          slug: string
          status: string
          summary: string
          title: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          keywords?: string[] | null
          lang?: string
          nostr_event_id?: string | null
          revision?: number
          slug: string
          status?: string
          summary: string
          title: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          keywords?: string[] | null
          lang?: string
          nostr_event_id?: string | null
          revision?: number
          slug?: string
          status?: string
          summary?: string
          title?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_unsupported_prompts: {
        Row: {
          ai_response: string | null
          context_summary: string | null
          created_at: string
          id: string
          nostr_hex_id: string
          prompt: string
        }
        Insert: {
          ai_response?: string | null
          context_summary?: string | null
          created_at?: string
          id?: string
          nostr_hex_id: string
          prompt: string
        }
        Update: {
          ai_response?: string | null
          context_summary?: string | null
          created_at?: string
          id?: string
          nostr_hex_id?: string
          prompt?: string
        }
        Relationships: []
      }
      ai_usage_logs: {
        Row: {
          completion_tokens: number
          cost_lana: number | null
          cost_usd: number | null
          created_at: string
          id: string
          model: string
          nostr_hex_id: string
          prompt_tokens: number
          total_tokens: number
        }
        Insert: {
          completion_tokens?: number
          cost_lana?: number | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          model: string
          nostr_hex_id: string
          prompt_tokens?: number
          total_tokens?: number
        }
        Update: {
          completion_tokens?: number
          cost_lana?: number | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          model?: string
          nostr_hex_id?: string
          prompt_tokens?: number
          total_tokens?: number
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      direct_messages: {
        Row: {
          content: string
          created_at: string
          decrypted_content: string | null
          event_id: string
          id: string
          kind: number | null
          raw_event: Json | null
          received_at: string | null
          recipient_pubkey: string
          sender_pubkey: string
          tags: Json | null
        }
        Insert: {
          content: string
          created_at: string
          decrypted_content?: string | null
          event_id: string
          id?: string
          kind?: number | null
          raw_event?: Json | null
          received_at?: string | null
          recipient_pubkey: string
          sender_pubkey: string
          tags?: Json | null
        }
        Update: {
          content?: string
          created_at?: string
          decrypted_content?: string | null
          event_id?: string
          id?: string
          kind?: number | null
          raw_event?: Json | null
          received_at?: string | null
          recipient_pubkey?: string
          sender_pubkey?: string
          tags?: Json | null
        }
        Relationships: []
      }
      dm_lashes: {
        Row: {
          amount: string
          created_at: string
          expires_at: string | null
          id: string
          lash_event_id: string
          message_event_id: string
          recipient_pubkey: string
          sender_pubkey: string
        }
        Insert: {
          amount: string
          created_at?: string
          expires_at?: string | null
          id?: string
          lash_event_id: string
          message_event_id: string
          recipient_pubkey: string
          sender_pubkey: string
        }
        Update: {
          amount?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          lash_event_id?: string
          message_event_id?: string
          recipient_pubkey?: string
          sender_pubkey?: string
        }
        Relationships: []
      }
      dm_last_seen: {
        Row: {
          last_event_created_at: number
          nostr_hex_id: string
          updated_at: string | null
        }
        Insert: {
          last_event_created_at?: number
          nostr_hex_id: string
          updated_at?: string | null
        }
        Update: {
          last_event_created_at?: number
          nostr_hex_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      dm_read_status: {
        Row: {
          conversation_pubkey: string
          created_at: string | null
          id: string
          is_read: boolean
          message_event_id: string
          read_at: string | null
          sender_pubkey: string
          updated_at: string | null
          user_nostr_id: string
        }
        Insert: {
          conversation_pubkey: string
          created_at?: string | null
          id?: string
          is_read?: boolean
          message_event_id: string
          read_at?: string | null
          sender_pubkey: string
          updated_at?: string | null
          user_nostr_id: string
        }
        Update: {
          conversation_pubkey?: string
          created_at?: string | null
          id?: string
          is_read?: boolean
          message_event_id?: string
          read_at?: string | null
          sender_pubkey?: string
          updated_at?: string | null
          user_nostr_id?: string
        }
        Relationships: []
      }
      kind_38888: {
        Row: {
          created_at: number
          electrum_servers: Json
          event_id: string
          exchange_rates: Json
          fetched_at: string | null
          id: string
          pubkey: string
          raw_event: Json
          relays: Json
          split: string | null
          trusted_signers: Json | null
          valid_from: number | null
          version: string | null
        }
        Insert: {
          created_at: number
          electrum_servers: Json
          event_id: string
          exchange_rates: Json
          fetched_at?: string | null
          id?: string
          pubkey: string
          raw_event: Json
          relays: Json
          split?: string | null
          trusted_signers?: Json | null
          valid_from?: number | null
          version?: string | null
        }
        Update: {
          created_at?: number
          electrum_servers?: Json
          event_id?: string
          exchange_rates?: Json
          fetched_at?: string | null
          id?: string
          pubkey?: string
          raw_event?: Json
          relays?: Json
          split?: string | null
          trusted_signers?: Json | null
          valid_from?: number | null
          version?: string | null
        }
        Relationships: []
      }
      lash_users_history: {
        Row: {
          created_at: string | null
          event_id: string
          id: string
          nostr_hex_id: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          nostr_hex_id: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          id?: string
          nostr_hex_id?: string
        }
        Relationships: []
      }
      nostr_profiles: {
        Row: {
          about: string | null
          created_at: string
          display_name: string | null
          full_name: string | null
          lana_wallet_id: string | null
          last_fetched_at: string
          nostr_hex_id: string
          picture: string | null
          raw_metadata: Json | null
          updated_at: string
        }
        Insert: {
          about?: string | null
          created_at?: string
          display_name?: string | null
          full_name?: string | null
          lana_wallet_id?: string | null
          last_fetched_at?: string
          nostr_hex_id: string
          picture?: string | null
          raw_metadata?: Json | null
          updated_at?: string
        }
        Update: {
          about?: string | null
          created_at?: string
          display_name?: string | null
          full_name?: string | null
          lana_wallet_id?: string | null
          last_fetched_at?: string
          nostr_hex_id?: string
          picture?: string | null
          raw_metadata?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          nostr_hex_id: string
          p256dh: string
          updated_at: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          nostr_hex_id: string
          p256dh: string
          updated_at?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          nostr_hex_id?: string
          p256dh?: string
          updated_at?: string
        }
        Relationships: []
      }
      room_latest_posts: {
        Row: {
          author_pubkey: string
          content: string
          created_at: number
          fetched_at: string | null
          id: string
          image_url: string | null
          post_count: number | null
          post_event_id: string
          room_slug: string
          updated_at: string | null
        }
        Insert: {
          author_pubkey: string
          content: string
          created_at: number
          fetched_at?: string | null
          id?: string
          image_url?: string | null
          post_count?: number | null
          post_event_id: string
          room_slug: string
          updated_at?: string | null
        }
        Update: {
          author_pubkey?: string
          content?: string
          created_at?: number
          fetched_at?: string | null
          id?: string
          image_url?: string | null
          post_count?: number | null
          post_event_id?: string
          room_slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      transaction_history: {
        Row: {
          block_height: number
          block_time: number
          created_at: string
          id: string
          sender_pubkey: string
          txid: string
          used_utxos: string[]
        }
        Insert: {
          block_height: number
          block_time: number
          created_at?: string
          id?: string
          sender_pubkey: string
          txid: string
          used_utxos: string[]
        }
        Update: {
          block_height?: number
          block_time?: number
          created_at?: string
          id?: string
          sender_pubkey?: string
          txid?: string
          used_utxos?: string[]
        }
        Relationships: []
      }
      wallet_types: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_direct_messages: { Args: never; Returns: number }
      get_user_nostr_hex_id: { Args: { user_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
