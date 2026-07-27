import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";

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
      <h1 className="text-xl font-semibold">Good Fruit Club</h1>
      <p className="text-neutral-600">
        Signed in as {profile?.phone ?? user.phone}
      </p>
      <p className="text-sm text-neutral-500">
        Role: {profile?.role ?? "not yet assigned - ask an admin"}
      </p>
      {profile?.role && ROLE_HOME[profile.role] && (
        <Link
          href={ROLE_HOME[profile.role]}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
        >
          Go to your workspace
        </Link>
      )}
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
