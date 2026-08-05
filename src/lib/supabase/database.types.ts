// Hand-written (profiles, catalog, price versions). Once the Supabase CLI is
// available, regenerate with:
//   supabase gen types typescript --linked > src/lib/supabase/database.types.ts
// and delete this comment.

export type Role = "admin" | "packer" | "delivery";
export type UnitType = "weight" | "count";
export type CustomerZone =
  | "DLF Phase 2"
  | "Sushant Lok"
  | "Near Hamilton Court"
  | "DLF Phase 1"
  | "Phase 3"
  | "Phase 4"
  | "Phase 5"
  | "Outside Gurgaon"
  | "Unassigned";
export type OrderStatus =
  | "recorded"
  | "packed"
  | "dispatched"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";
export type LineStatus = "pending" | "packed" | "unavailable";
export type ParseConfidence = "clean" | "flagged";
export type LedgerEntryType = "debit" | "credit";
export type LedgerMode = "cash" | "upi" | "other";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          phone: string | null;
          role: Role | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          phone?: string | null;
          role?: Role | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          phone?: string | null;
          role?: Role | null;
          created_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          name: string;
          unit_type: UnitType;
          unit_label: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          unit_type: UnitType;
          unit_label?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          unit_type?: UnitType;
          unit_label?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      product_aliases: {
        Row: {
          id: string;
          product_id: string;
          alias: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          alias: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          alias?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      price_versions: {
        Row: {
          id: string;
          effective_from: string;
          published_by: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          effective_from: string;
          published_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          effective_from?: string;
          published_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      price_items: {
        Row: {
          id: string;
          version_id: string;
          product_id: string;
          price_per_unit: number;
        };
        Insert: {
          id?: string;
          version_id: string;
          product_id: string;
          price_per_unit: number;
        };
        Update: {
          id?: string;
          version_id?: string;
          product_id?: string;
          price_per_unit?: number;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          display_name: string;
          phone: string | null;
          address: string;
          zone: CustomerZone;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          display_name: string;
          phone?: string | null;
          address: string;
          zone: CustomerZone;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          phone?: string | null;
          address?: string;
          zone?: CustomerZone;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          customer_id: string;
          placed_at: string;
          delivery_date: string;
          status: OrderStatus;
          status_timestamps: Record<string, string>;
          raw_paste: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          is_historical: boolean;
        };
        Insert: {
          id?: string;
          customer_id: string;
          placed_at: string;
          delivery_date: string;
          status?: OrderStatus;
          status_timestamps?: Record<string, string>;
          raw_paste?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          is_historical?: boolean;
        };
        Update: {
          id?: string;
          customer_id?: string;
          placed_at?: string;
          delivery_date?: string;
          status?: OrderStatus;
          status_timestamps?: Record<string, string>;
          raw_paste?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          is_historical?: boolean;
        };
        Relationships: [];
      };
      order_lines: {
        Row: {
          id: string;
          order_id: string;
          product_id: string | null;
          ordered_qty: number | null;
          ordered_unit: string | null;
          locked_price_per_unit: number | null;
          locked_cogs_per_unit: number | null;
          actual_qty: number | null;
          line_status: LineStatus;
          is_substitution: boolean;
          substituted_for_line_id: string | null;
          parse_confidence: ParseConfidence | null;
          parse_note: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id?: string | null;
          ordered_qty?: number | null;
          ordered_unit?: string | null;
          locked_price_per_unit?: number | null;
          locked_cogs_per_unit?: number | null;
          actual_qty?: number | null;
          line_status?: LineStatus;
          is_substitution?: boolean;
          substituted_for_line_id?: string | null;
          parse_confidence?: ParseConfidence | null;
          parse_note?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          product_id?: string | null;
          ordered_qty?: number | null;
          ordered_unit?: string | null;
          locked_price_per_unit?: number | null;
          locked_cogs_per_unit?: number | null;
          actual_qty?: number | null;
          line_status?: LineStatus;
          is_substitution?: boolean;
          substituted_for_line_id?: string | null;
          parse_confidence?: ParseConfidence | null;
          parse_note?: string | null;
        };
        Relationships: [];
      };
      procurement_marks: {
        Row: {
          id: string;
          delivery_date: string;
          list_sent_at: string;
          sent_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          delivery_date: string;
          list_sent_at: string;
          sent_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          delivery_date?: string;
          list_sent_at?: string;
          sent_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      procurement_item_checks: {
        Row: {
          id: string;
          delivery_date: string;
          product_id: string;
          checked_qty: number;
          checked_by: string | null;
          checked_at: string;
        };
        Insert: {
          id?: string;
          delivery_date: string;
          product_id: string;
          checked_qty: number;
          checked_by?: string | null;
          checked_at?: string;
        };
        Update: {
          id?: string;
          delivery_date?: string;
          product_id?: string;
          checked_qty?: number;
          checked_by?: string | null;
          checked_at?: string;
        };
        Relationships: [];
      };
      bills: {
        Row: {
          id: string;
          order_id: string;
          total: number;
          prev_balance: number;
          net_due: number;
          message_text: string | null;
          finalized_at: string | null;
          finalized_by: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          total: number;
          prev_balance: number;
          net_due: number;
          message_text?: string | null;
          finalized_at?: string | null;
          finalized_by?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          total?: number;
          prev_balance?: number;
          net_due?: number;
          message_text?: string | null;
          finalized_at?: string | null;
          finalized_by?: string | null;
        };
        Relationships: [];
      };
      ledger_entries: {
        Row: {
          id: string;
          customer_id: string;
          entry_type: LedgerEntryType;
          amount: number;
          mode: LedgerMode | null;
          order_id: string | null;
          note: string | null;
          entered_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          entry_type: LedgerEntryType;
          amount: number;
          mode?: LedgerMode | null;
          order_id?: string | null;
          note?: string | null;
          entered_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          entry_type?: LedgerEntryType;
          amount?: number;
          mode?: LedgerMode | null;
          order_id?: string | null;
          note?: string | null;
          entered_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      payment_allocations: {
        Row: {
          id: string;
          ledger_entry_id: string;
          order_id: string;
          amount: number;
        };
        Insert: {
          id?: string;
          ledger_entry_id: string;
          order_id: string;
          amount: number;
        };
        Update: {
          id?: string;
          ledger_entry_id?: string;
          order_id?: string;
          amount?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      publish_price_version: {
        Args: {
          p_effective_from: string;
          p_note: string | null;
          p_items: { product_id: string; price_per_unit: number }[];
          p_new_aliases: { product_id: string; alias: string }[];
        };
        Returns: string;
      };
    };
  };
}
