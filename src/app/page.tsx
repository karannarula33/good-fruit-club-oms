import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

const ROLE_HOME: Record<string, string> = {
  admin: "/admin/orders",
  packer: "/packer",
  delivery: "/delivery",
};

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, role")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-[18px] bg-foreground font-display text-[22px] font-extrabold text-white">
        GF
      </span>
      <span className="font-display text-[22px] font-bold text-foreground">Good Fruit Club</span>
      <p className="font-sans text-muted">Signed in as {profile?.phone ?? user.phone}</p>
      <p className="font-sans text-sm text-tertiary">Role: {profile?.role ?? "not yet assigned - ask an admin"}</p>
      {profile?.role && ROLE_HOME[profile.role] && (
        <Button href={ROLE_HOME[profile.role]} variant="dark">
          Go to your workspace
        </Button>
      )}
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}
