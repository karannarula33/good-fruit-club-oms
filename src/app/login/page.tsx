"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toE164 } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error } = await supabase.auth.signInWithPassword({
      phone: toE164(phone),
      password,
    });
    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-7 py-8">
      <div className="flex flex-col items-center gap-1.5">
        <span className="flex size-14 items-center justify-center rounded-[18px] bg-foreground font-display text-[22px] font-extrabold text-white">
          GF
        </span>
        <span className="mt-1.5 font-display text-[22px] font-bold text-foreground">Good Fruit Club</span>
        <span className="font-sans text-[12.5px] font-medium text-muted">Internal OMS</span>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3.5">
        <input
          type="tel"
          inputMode="tel"
          required
          autoFocus
          placeholder="Phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-2xl border-[1.5px] border-[#ECEAE3] bg-[#F7F7F5] px-4 py-[15px] text-center font-sans text-[15px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-2xl border-[1.5px] border-[#ECEAE3] bg-[#F7F7F5] px-4 py-[15px] text-center font-sans text-[15px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
        />
        {error && <FormError>{error}</FormError>}
        <Button type="submit" variant="dark" fullWidth pending={pending} pendingText="Signing in…">
          Log In
        </Button>
      </form>
    </div>
  );
}
