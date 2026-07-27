// Hand-written for slice 1 (profiles only). Once the project is linked to a
// real Supabase project, regenerate with:
//   supabase gen types typescript --linked > src/lib/supabase/database.types.ts
// and delete this comment.

export type Role = "admin" | "packer" | "delivery";

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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
