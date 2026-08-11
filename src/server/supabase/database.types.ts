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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      bot_users: {
        Row: {
          created_at: string
          id: string
          is_admin: boolean
          is_allowed: boolean
          last_seen_at: string | null
          telegram_chat_id: number | null
          telegram_user_id: number
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_admin?: boolean
          is_allowed?: boolean
          last_seen_at?: string | null
          telegram_chat_id?: number | null
          telegram_user_id: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_admin?: boolean
          is_allowed?: boolean
          last_seen_at?: string | null
          telegram_chat_id?: number | null
          telegram_user_id?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      callback_events: {
        Row: {
          action: string
          callback_query_id: string
          id: string
          processed_at: string | null
          prompt_session_id: string | null
          received_at: string
          telegram_user_id: number
        }
        Insert: {
          action: string
          callback_query_id: string
          id?: string
          processed_at?: string | null
          prompt_session_id?: string | null
          received_at?: string
          telegram_user_id: number
        }
        Update: {
          action?: string
          callback_query_id?: string
          id?: string
          processed_at?: string | null
          prompt_session_id?: string | null
          received_at?: string
          telegram_user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "callback_events_session_fkey"
            columns: ["prompt_session_id"]
            isOneToOne: false
            referencedRelation: "prompt_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_attempts: {
        Row: {
          attempt_number: number
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message_redacted: string | null
          id: string
          image_provider_config_id: string | null
          parameters: Json
          provider_request_id: string | null
          revision_id: string
          session_id: string
          started_at: string | null
          status: string
          telegram_message_id: number | null
        }
        Insert: {
          attempt_number: number
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message_redacted?: string | null
          id?: string
          image_provider_config_id?: string | null
          parameters?: Json
          provider_request_id?: string | null
          revision_id: string
          session_id: string
          started_at?: string | null
          status?: string
          telegram_message_id?: number | null
        }
        Update: {
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message_redacted?: string | null
          id?: string
          image_provider_config_id?: string | null
          parameters?: Json
          provider_request_id?: string | null
          revision_id?: string
          session_id?: string
          started_at?: string | null
          status?: string
          telegram_message_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_attempts_image_config_fkey"
            columns: ["image_provider_config_id"]
            isOneToOne: false
            referencedRelation: "provider_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_attempts_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "prompt_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "prompt_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_attempts_session_revision_fkey"
            columns: ["session_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "prompt_revisions"
            referencedColumns: ["session_id", "id"]
          },
        ]
      }
      job_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          job_id: string | null
          payload: Json
          prompt_session_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          job_id?: string | null
          payload?: Json
          prompt_session_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          job_id?: string | null
          payload?: Json
          prompt_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_events_job_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_session_fkey"
            columns: ["prompt_session_id"]
            isOneToOne: false
            referencedRelation: "prompt_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          generation_attempt_id: string | null
          id: string
          job_type: string
          last_error_code: string | null
          last_error_message_redacted: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          prompt_revision_id: string | null
          prompt_session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          generation_attempt_id?: string | null
          id?: string
          job_type: string
          last_error_code?: string | null
          last_error_message_redacted?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          prompt_revision_id?: string | null
          prompt_session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          generation_attempt_id?: string | null
          id?: string
          job_type?: string
          last_error_code?: string | null
          last_error_message_redacted?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          prompt_revision_id?: string | null
          prompt_session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_generation_attempt_fkey"
            columns: ["generation_attempt_id"]
            isOneToOne: false
            referencedRelation: "generation_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_prompt_revision_fkey"
            columns: ["prompt_revision_id"]
            isOneToOne: false
            referencedRelation: "prompt_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_prompt_session_fkey"
            columns: ["prompt_session_id"]
            isOneToOne: false
            referencedRelation: "prompt_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_session_generation_attempt_fkey"
            columns: ["prompt_session_id", "generation_attempt_id"]
            isOneToOne: false
            referencedRelation: "generation_attempts"
            referencedColumns: ["session_id", "id"]
          },
          {
            foreignKeyName: "jobs_session_revision_attempt_fkey"
            columns: [
              "prompt_session_id",
              "prompt_revision_id",
              "generation_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "generation_attempts"
            referencedColumns: ["session_id", "revision_id", "id"]
          },
          {
            foreignKeyName: "jobs_session_revision_fkey"
            columns: ["prompt_session_id", "prompt_revision_id"]
            isOneToOne: false
            referencedRelation: "prompt_revisions"
            referencedColumns: ["session_id", "id"]
          },
        ]
      }
      prompt_revisions: {
        Row: {
          aspect_ratio: string | null
          completed_at: string | null
          created_at: string
          enhanced_prompt: string | null
          id: string
          negative_prompt: string | null
          previous_prompt: string | null
          reasoning_provider_config_id: string | null
          revision_instruction: string | null
          revision_number: number
          session_id: string
          source_prompt: string
          status: string
        }
        Insert: {
          aspect_ratio?: string | null
          completed_at?: string | null
          created_at?: string
          enhanced_prompt?: string | null
          id?: string
          negative_prompt?: string | null
          previous_prompt?: string | null
          reasoning_provider_config_id?: string | null
          revision_instruction?: string | null
          revision_number: number
          session_id: string
          source_prompt: string
          status?: string
        }
        Update: {
          aspect_ratio?: string | null
          completed_at?: string | null
          created_at?: string
          enhanced_prompt?: string | null
          id?: string
          negative_prompt?: string | null
          previous_prompt?: string | null
          reasoning_provider_config_id?: string | null
          revision_instruction?: string | null
          revision_number?: number
          session_id?: string
          source_prompt?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_revisions_reasoning_config_fkey"
            columns: ["reasoning_provider_config_id"]
            isOneToOne: false
            referencedRelation: "provider_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_revisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "prompt_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_sessions: {
        Row: {
          active_generation_attempt_id: string | null
          active_revision_id: string | null
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          status: string
          telegram_chat_id: number
          telegram_status_message_id: number | null
          telegram_user_id: number
          updated_at: string
        }
        Insert: {
          active_generation_attempt_id?: string | null
          active_revision_id?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          status?: string
          telegram_chat_id: number
          telegram_status_message_id?: number | null
          telegram_user_id: number
          updated_at?: string
        }
        Update: {
          active_generation_attempt_id?: string | null
          active_revision_id?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          status?: string
          telegram_chat_id?: number
          telegram_status_message_id?: number | null
          telegram_user_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_sessions_active_attempt_session_fkey"
            columns: ["id", "active_generation_attempt_id"]
            isOneToOne: false
            referencedRelation: "generation_attempts"
            referencedColumns: ["session_id", "id"]
          },
          {
            foreignKeyName: "prompt_sessions_active_generation_attempt_fkey"
            columns: ["active_generation_attempt_id"]
            isOneToOne: false
            referencedRelation: "generation_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_sessions_active_revision_fkey"
            columns: ["active_revision_id"]
            isOneToOne: false
            referencedRelation: "prompt_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_sessions_active_revision_session_fkey"
            columns: ["id", "active_revision_id"]
            isOneToOne: false
            referencedRelation: "prompt_revisions"
            referencedColumns: ["session_id", "id"]
          },
        ]
      }
      provider_configs: {
        Row: {
          activated_at: string | null
          adapter_type: string
          base_url: string
          capability: string
          config_version: number
          created_at: string
          id: string
          is_active: boolean
          model: string | null
          name: string
          priority: number
          selection_strategy: string
          settings: Json
          updated_at: string
          weight: number
        }
        Insert: {
          activated_at?: string | null
          adapter_type: string
          base_url: string
          capability: string
          config_version?: number
          created_at?: string
          id?: string
          is_active?: boolean
          model?: string | null
          name: string
          priority?: number
          selection_strategy?: string
          settings?: Json
          updated_at?: string
          weight?: number
        }
        Update: {
          activated_at?: string | null
          adapter_type?: string
          base_url?: string
          capability?: string
          config_version?: number
          created_at?: string
          id?: string
          is_active?: boolean
          model?: string | null
          name?: string
          priority?: number
          selection_strategy?: string
          settings?: Json
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      provider_keys: {
        Row: {
          cooldown_until: string | null
          created_at: string
          failure_count: number
          id: string
          is_active: boolean
          key_auth_tag: string
          key_ciphertext: string
          key_fingerprint: string
          key_iv: string
          label: string | null
          last_used_at: string | null
          provider_config_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          cooldown_until?: string | null
          created_at?: string
          failure_count?: number
          id?: string
          is_active?: boolean
          key_auth_tag: string
          key_ciphertext: string
          key_fingerprint: string
          key_iv: string
          label?: string | null
          last_used_at?: string | null
          provider_config_id: string
          updated_at?: string
          weight?: number
        }
        Update: {
          cooldown_until?: string | null
          created_at?: string
          failure_count?: number
          id?: string
          is_active?: boolean
          key_auth_tag?: string
          key_ciphertext?: string
          key_fingerprint?: string
          key_iv?: string
          label?: string | null
          last_used_at?: string | null
          provider_config_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_keys_provider_config_id_fkey"
            columns: ["provider_config_id"]
            isOneToOne: false
            referencedRelation: "provider_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_requests: {
        Row: {
          capability: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message_redacted: string | null
          http_status: number | null
          id: string
          job_id: string | null
          latency_ms: number | null
          provider_config_id: string
          provider_key_id: string | null
          provider_request_id: string | null
          status: string
        }
        Insert: {
          capability: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message_redacted?: string | null
          http_status?: number | null
          id?: string
          job_id?: string | null
          latency_ms?: number | null
          provider_config_id: string
          provider_key_id?: string | null
          provider_request_id?: string | null
          status: string
        }
        Update: {
          capability?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message_redacted?: string | null
          http_status?: number | null
          id?: string
          job_id?: string | null
          latency_ms?: number | null
          provider_config_id?: string
          provider_key_id?: string | null
          provider_request_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_requests_config_fkey"
            columns: ["provider_config_id"]
            isOneToOne: false
            referencedRelation: "provider_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_requests_config_key_fkey"
            columns: ["provider_config_id", "provider_key_id"]
            isOneToOne: false
            referencedRelation: "provider_keys"
            referencedColumns: ["provider_config_id", "id"]
          },
          {
            foreignKeyName: "provider_requests_job_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_requests_key_fkey"
            columns: ["provider_key_id"]
            isOneToOne: false
            referencedRelation: "provider_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_updates: {
        Row: {
          id: string
          processed_at: string | null
          received_at: string
          telegram_chat_id: number | null
          telegram_user_id: number | null
          update_id: number
          update_type: string
        }
        Insert: {
          id?: string
          processed_at?: string | null
          received_at?: string
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          update_id: number
          update_type: string
        }
        Update: {
          id?: string
          processed_at?: string | null
          received_at?: string
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          update_id?: number
          update_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_job: {
        Args: { p_lease_seconds?: number; p_worker_id: string }
        Returns: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          generation_attempt_id: string | null
          id: string
          job_type: string
          last_error_code: string | null
          last_error_message_redacted: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          prompt_revision_id: string | null
          prompt_session_id: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_initial_session: {
        Args: {
          p_job_type?: string
          p_source_prompt: string
          p_telegram_chat_id: number
          p_telegram_user_id: number
          p_update_id: number
        }
        Returns: {
          job_id: string
          revision_id: string
          session_id: string
        }[]
      }
      increment_provider_key_failure: {
        Args: {
          p_key_id: string
          p_provider_config_id: string
          p_threshold: number
        }
        Returns: {
          cooldown_until: string | null
          created_at: string
          failure_count: number
          id: string
          is_active: boolean
          key_auth_tag: string
          key_ciphertext: string
          key_fingerprint: string
          key_iv: string
          label: string | null
          last_used_at: string | null
          provider_config_id: string
          updated_at: string
          weight: number
        }[]
        SetofOptions: {
          from: "*"
          to: "provider_keys"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      transition_prompt_session: {
        Args: {
          p_active_generation_attempt_id?: string
          p_active_revision_id?: string
          p_expected_status: string
          p_new_status: string
          p_session_id: string
        }
        Returns: {
          active_generation_attempt_id: string | null
          active_revision_id: string | null
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          status: string
          telegram_chat_id: number
          telegram_status_message_id: number | null
          telegram_user_id: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "prompt_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
