"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { changePassword } from "@/app/actions/account";

export function PasswordForm() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const field = "w-full rounded-xl border border-[#ECEAE3] bg-white px-3 py-3 font-sans text-base";

  if (done) {
    return (
      <Card elevated className="space-y-3 p-4">
        <p className="font-sans text-[15px] font-semibold text-success-text">Password changed. Use it next time you log in.</p>
        <Button variant="dark" fullWidth onClick={() => router.push("/")}>
          Continue
        </Button>
      </Card>
    );
  }

  return (
    <Card elevated className="space-y-3 p-4">
      <label className="block font-sans text-[12px] font-bold text-muted">
        New password
        <input type="password" autoComplete="new-password" className={`${field} mt-1`} value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="block font-sans text-[12px] font-bold text-muted">
        Type it again
        <input type="password" autoComplete="new-password" className={`${field} mt-1`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <p className="font-sans text-[12px] text-tertiary">At least 8 characters.</p>
      {error && <FormError>{error}</FormError>}
      <Button
        variant="primary"
        fullWidth
        disabled={!pw || !confirm}
        pending={pending}
        pendingText="Saving…"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await changePassword(pw, confirm);
            if (!r.ok) setError(r.error);
            else {
              setDone(true);
              router.refresh();
            }
          })
        }
      >
        Change password
      </Button>
    </Card>
  );
}
