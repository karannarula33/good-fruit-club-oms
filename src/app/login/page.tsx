"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Apple } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toE164 } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Apple className="size-6 text-brand" aria-hidden="true" />
          Good Fruit Club
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Phone number</span>
            <Input
              type="tel"
              inputMode="tel"
              required
              autoFocus
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full text-base"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Password</span>
            <Input
              type="password"
              required
              placeholder="••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full text-base"
            />
          </label>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" fullWidth pending={pending} pendingText="Signing in…">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
