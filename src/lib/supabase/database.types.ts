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
