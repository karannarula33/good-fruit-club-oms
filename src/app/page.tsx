import { redirect } from "next/navigation";
import { Apple } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

const ROLE_HOME: Record<string, string> = {
  admin: "/admin",
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Apple className="size-6 text-brand" aria-hidden="true" />
        Good Fruit Club
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400">Signed in as {profile?.phone ?? user.phone}</p>
      <p className="text-sm text-neutral-500">Role: {profile?.role ?? "not yet assigned - ask an admin"}</p>
      {profile?.role && ROLE_HOME[profile.role] && (
        <Button href={ROLE_HOME[profile.role]}>Go to your workspace</Button>
      )}
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}
