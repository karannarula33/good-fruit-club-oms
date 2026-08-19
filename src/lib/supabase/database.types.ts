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
export type NudgeRecommendedAction = "message" | "call" | "skip_no_phone";
export type NudgeStatus = "pending" | "approved" | "edited" | "relayed" | "skipped" | "snoozed" | "expired";
export type SuppressionReason = "complaint" | "requested_no_contact" | "two_unanswered";

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
      price_tiers: {
        Row: {
          id: string;
          price_item_id: string;
          min_qty: number;
          price_per_unit: number;
        };
        Insert: {
          id?: string;
          price_item_id: string;
          min_qty: number;
          price_per_unit: number;
        };
        Update: {
          id?: string;
          price_item_id?: string;
          min_qty?: number;
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
      price_overrides: {
        Row: {
          id: string;
          order_line_id: string;
          previous_price: number | null;
          new_price: number;
          reason: string;
          overridden_by: string | null;
          overridden_at: string;
        };
        Insert: {
          id?: string;
          order_line_id: string;
          previous_price?: number | null;
          new_price: number;
          reason: string;
          overridden_by?: string | null;
          overridden_at?: string;
        };
        Update: {
          id?: string;
          order_line_id?: string;
          previous_price?: number | null;
          new_price?: number;
          reason?: string;
          overridden_by?: string | null;
          overridden_at?: string;
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
      eng_customer_state: {
        Row: {
          customer_id: string;
          computed_at: string;
          order_count: number;
          first_order_at: string | null;
          last_order_at: string | null;
          days_since_last: number | null;
          expected_gap_days: number | null;
          severity_ratio: number | null;
          revenue: number | null;
          revenue_percentile: number | null;
          is_vip: boolean | null;
          aov: number | null;
          favourite_products: string[] | null;
          last_order_products: string[] | null;
          state: string;
          previous_state: string | null;
          state_changed_at: string | null;
        };
        Insert: {
          customer_id: string;
          computed_at: string;
          order_count: number;
          first_order_at?: string | null;
          last_order_at?: string | null;
          days_since_last?: number | null;
          expected_gap_days?: number | null;
          severity_ratio?: number | null;
          revenue?: number | null;
          revenue_percentile?: number | null;
          is_vip?: boolean | null;
          aov?: number | null;
          favourite_products?: string[] | null;
          last_order_products?: string[] | null;
          state: string;
          previous_state?: string | null;
          state_changed_at?: string | null;
        };
        Update: {
          customer_id?: string;
          computed_at?: string;
          order_count?: number;
          first_order_at?: string | null;
          last_order_at?: string | null;
          days_since_last?: number | null;
          expected_gap_days?: number | null;
          severity_ratio?: number | null;
          revenue?: number | null;
          revenue_percentile?: number | null;
          is_vip?: boolean | null;
          aov?: number | null;
          favourite_products?: string[] | null;
          last_order_products?: string[] | null;
          state?: string;
          previous_state?: string | null;
          state_changed_at?: string | null;
        };
        Relationships: [];
      };
      eng_nudge_queue: {
        Row: {
          id: string;
          run_date: string;
          customer_id: string;
          trigger_type: string;
          recommended_action: NudgeRecommendedAction;
          priority_score: number;
          rationale: string;
          draft_message: string | null;
          draft_rationale: string | null;
          status: NudgeStatus;
          final_message: string | null;
          snooze_until: string | null;
          created_at: string;
          reviewed_at: string | null;
          relayed_at: string | null;
        };
        Insert: {
          id?: string;
          run_date: string;
          customer_id: string;
          trigger_type: string;
          recommended_action: NudgeRecommendedAction;
          priority_score: number;
          rationale: string;
          draft_message?: string | null;
          draft_rationale?: string | null;
          status?: NudgeStatus;
          final_message?: string | null;
          snooze_until?: string | null;
          created_at?: string;
          reviewed_at?: string | null;
          relayed_at?: string | null;
        };
        Update: {
          id?: string;
          run_date?: string;
          customer_id?: string;
          trigger_type?: string;
          recommended_action?: NudgeRecommendedAction;
          priority_score?: number;
          rationale?: string;
          draft_message?: string | null;
          draft_rationale?: string | null;
          status?: NudgeStatus;
          final_message?: string | null;
          snooze_until?: string | null;
          created_at?: string;
          reviewed_at?: string | null;
          relayed_at?: string | null;
        };
        Relationships: [];
      };
      eng_nudge_outcomes: {
        Row: {
          nudge_id: string;
          relayed_at: string | null;
          reordered_within_7d: boolean | null;
          reordered_within_14d: boolean | null;
          reorder_order_id: string | null;
          days_to_reorder: number | null;
          evaluated_at: string | null;
        };
        Insert: {
          nudge_id: string;
          relayed_at?: string | null;
          reordered_within_7d?: boolean | null;
          reordered_within_14d?: boolean | null;
          reorder_order_id?: string | null;
          days_to_reorder?: number | null;
          evaluated_at?: string | null;
        };
        Update: {
          nudge_id?: string;
          relayed_at?: string | null;
          reordered_within_7d?: boolean | null;
          reordered_within_14d?: boolean | null;
          reorder_order_id?: string | null;
          days_to_reorder?: number | null;
          evaluated_at?: string | null;
        };
        Relationships: [];
      };
      eng_suppression: {
        Row: {
          customer_id: string;
          reason: SuppressionReason;
          added_at: string | null;
          expires_at: string | null;
        };
        Insert: {
          customer_id: string;
          reason: SuppressionReason;
          added_at?: string | null;
          expires_at?: string | null;
        };
        Update: {
          customer_id?: string;
          reason?: SuppressionReason;
          added_at?: string | null;
          expires_at?: string | null;
        };
        Relationships: [];
      };
      eng_config: {
        Row: {
          key: string;
          value: number;
          updated_at: string | null;
        };
        Insert: {
          key: string;
          value: number;
          updated_at?: string | null;
        };
        Update: {
          key?: string;
          value?: number;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      eng_settings: {
        Row: {
          id: number;
          seasonal_note: string | null;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: number;
          seasonal_note?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          id?: number;
          seasonal_note?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
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
          p_items: {
            product_id: string;
            price_per_unit: number;
            tiers?: { min_qty: number; price_per_unit: number }[];
            replace_tiers?: boolean;
          }[];
          p_new_aliases: { product_id: string; alias: string }[];
        };
        Returns: string;
      };
    };
  };
}
