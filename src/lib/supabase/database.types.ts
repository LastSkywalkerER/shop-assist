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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      expense_attachments_sync: {
        Row: {
          _deleted: boolean | null
          created_at: string
          data_url: string
          file_name: string
          id: string
          mime_type: string
          receipt_id: string
          room_id: string
          size: number
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          _deleted?: boolean | null
          created_at: string
          data_url: string
          file_name: string
          id: string
          mime_type: string
          receipt_id: string
          room_id: string
          size: number
          storage_path?: string | null
          updated_at: string
        }
        Update: {
          _deleted?: boolean | null
          created_at?: string
          data_url?: string
          file_name?: string
          id?: string
          mime_type?: string
          receipt_id?: string
          room_id?: string
          size?: number
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_attachments_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories_sync: {
        Row: {
          _deleted: boolean | null
          created_at: string
          id: string
          name: string
          room_id: string
          updated_at: string
        }
        Insert: {
          _deleted?: boolean | null
          created_at: string
          id: string
          name: string
          room_id: string
          updated_at: string
        }
        Update: {
          _deleted?: boolean | null
          created_at?: string
          id?: string
          name?: string
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses_sync: {
        Row: {
          _deleted: boolean | null
          amount: number
          category_id: string | null
          created_at: string
          creator_name: string | null
          currency: string
          date: string
          id: string
          name: string | null
          notes: string | null
          room_id: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          _deleted?: boolean | null
          amount: number
          category_id?: string | null
          created_at: string
          creator_name?: string | null
          currency?: string
          date: string
          id: string
          name?: string | null
          notes?: string | null
          room_id: string
          store_id?: string | null
          updated_at: string
        }
        Update: {
          _deleted?: boolean | null
          amount?: number
          category_id?: string | null
          created_at?: string
          creator_name?: string | null
          currency?: string
          date?: string
          id?: string
          name?: string | null
          notes?: string | null
          room_id?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_queue: {
        Row: {
          created_at: string
          id: string
          immediate_sent: boolean
          items: Json
          last_updated_at: string
          room_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          immediate_sent?: boolean
          items?: Json
          last_updated_at?: string
          room_id: string
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          immediate_sent?: boolean
          items?: Json
          last_updated_at?: string
          room_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      products_sync: {
        Row: {
          _deleted: boolean | null
          barcode: string | null
          category: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          room_id: string
          updated_at: string
        }
        Insert: {
          _deleted?: boolean | null
          barcode?: string | null
          category?: string | null
          created_at: string
          id: string
          name: string
          notes?: string | null
          room_id: string
          updated_at: string
        }
        Update: {
          _deleted?: boolean | null
          barcode?: string | null
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_attachments_sync: {
        Row: {
          _deleted: boolean | null
          created_at: string
          data_url: string
          file_name: string | null
          id: string
          mime_type: string | null
          purchase_id: string
          room_id: string
          size: number | null
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          _deleted?: boolean | null
          created_at: string
          data_url: string
          file_name?: string | null
          id: string
          mime_type?: string | null
          purchase_id: string
          room_id: string
          size?: number | null
          storage_path?: string | null
          updated_at: string
        }
        Update: {
          _deleted?: boolean | null
          created_at?: string
          data_url?: string
          file_name?: string | null
          id?: string
          mime_type?: string | null
          purchase_id?: string
          room_id?: string
          size?: number | null
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_attachments_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases_sync: {
        Row: {
          _deleted: boolean | null
          created_at: string
          currency: string
          id: string
          manufacturer: string | null
          notes: string | null
          package_volume: string | null
          price: number
          product_id: string
          purchase_date: string
          quality_rating: number | null
          room_id: string
          store_id: string
          updated_at: string
          variety: string | null
        }
        Insert: {
          _deleted?: boolean | null
          created_at: string
          currency?: string
          id: string
          manufacturer?: string | null
          notes?: string | null
          package_volume?: string | null
          price: number
          product_id: string
          purchase_date: string
          quality_rating?: number | null
          room_id: string
          store_id: string
          updated_at: string
          variety?: string | null
        }
        Update: {
          _deleted?: boolean | null
          created_at?: string
          currency?: string
          id?: string
          manufacturer?: string | null
          notes?: string | null
          package_volume?: string | null
          price?: number
          product_id?: string
          purchase_date?: string
          quality_rating?: number | null
          room_id?: string
          store_id?: string
          updated_at?: string
          variety?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_items_sync: {
        Row: {
          _deleted: boolean | null
          amount: number
          category: string | null
          converted_to_purchase_id: string | null
          created_at: string
          currency: string
          id: string
          manufacturer: string | null
          name: string
          notes: string | null
          package_volume: string | null
          quality_rating: number | null
          receipt_id: string
          room_id: string
          updated_at: string
          variety: string | null
        }
        Insert: {
          _deleted?: boolean | null
          amount: number
          category?: string | null
          converted_to_purchase_id?: string | null
          created_at: string
          currency?: string
          id: string
          manufacturer?: string | null
          name: string
          notes?: string | null
          package_volume?: string | null
          quality_rating?: number | null
          receipt_id: string
          room_id: string
          updated_at: string
          variety?: string | null
        }
        Update: {
          _deleted?: boolean | null
          amount?: number
          category?: string | null
          converted_to_purchase_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          manufacturer?: string | null
          name?: string
          notes?: string | null
          package_volume?: string | null
          quality_rating?: number | null
          receipt_id?: string
          room_id?: string
          updated_at?: string
          variety?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_items_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts_sync: {
        Row: {
          _deleted: boolean | null
          created_at: string
          expense_id: string
          id: string
          room_id: string
          updated_at: string
        }
        Insert: {
          _deleted?: boolean | null
          created_at: string
          expense_id: string
          id: string
          room_id: string
          updated_at: string
        }
        Update: {
          _deleted?: boolean | null
          created_at?: string
          expense_id?: string
          id?: string
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_custom_names: {
        Row: {
          created_at: string
          id: string
          name: string
          room_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          room_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_custom_names_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_invites: {
        Row: {
          created_at: string | null
          created_by: string
          expires_at: string | null
          id: string
          invite_code: string
          max_uses: number | null
          role: string
          room_id: string
          use_count: number | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          id?: string
          invite_code: string
          max_uses?: number | null
          role?: string
          room_id: string
          use_count?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          expires_at?: string | null
          id?: string
          invite_code?: string
          max_uses?: number | null
          role?: string
          room_id?: string
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "room_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_invites_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_memberships: {
        Row: {
          id: string
          joined_at: string | null
          role: string | null
          room_id: string | null
          user_id: string | null
        }
        Insert: {
          id?: string
          joined_at?: string | null
          role?: string | null
          room_id?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string
          joined_at?: string | null
          role?: string | null
          room_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_memberships_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string | null
          id: string
          is_personal: boolean | null
          name: string
          owner_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_personal?: boolean | null
          name: string
          owner_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_personal?: boolean | null
          name?: string
          owner_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_list_items_sync: {
        Row: {
          _deleted: boolean | null
          created_at: string
          creator_name: string | null
          done: boolean
          id: string
          link: string | null
          name: string
          room_id: string
          updated_at: string
        }
        Insert: {
          _deleted?: boolean | null
          created_at: string
          creator_name?: string | null
          done?: boolean
          id: string
          link?: string | null
          name: string
          room_id: string
          updated_at: string
        }
        Update: {
          _deleted?: boolean | null
          created_at?: string
          creator_name?: string | null
          done?: boolean
          id?: string
          link?: string | null
          name?: string
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_list_items_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      stores_sync: {
        Row: {
          _deleted: boolean | null
          address: string | null
          chain: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          room_id: string
          type: string | null
          updated_at: string
        }
        Insert: {
          _deleted?: boolean | null
          address?: string | null
          chain?: string | null
          created_at: string
          id: string
          name: string
          notes?: string | null
          room_id: string
          type?: string | null
          updated_at: string
        }
        Update: {
          _deleted?: boolean | null
          address?: string | null
          chain?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          room_id?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_sync_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      test_user_db_id: {
        Row: {
          created_at: string | null
          id: string
          user_db_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          user_db_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          user_db_id?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          auth_date: number
          auth_user_id: string | null
          created_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          photo_url: string | null
          telegram_id: number
          updated_at: string | null
          username: string | null
        }
        Insert: {
          auth_date: number
          auth_user_id?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          photo_url?: string | null
          telegram_id: number
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          auth_date?: number
          auth_user_id?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          photo_url?: string | null
          telegram_id?: number
          updated_at?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_room_ids: { Args: never; Returns: string[] }
      get_user_db_id: { Args: never; Returns: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
