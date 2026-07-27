"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Step = "phone" | "otp";

// India-only for phase 1 (Good Fruit Club serves Gurgaon).
function toE164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error } = await supabase.auth.signInWithOtp({
      phone: toE164(phone),
    });
    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("otp");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: toE164(phone),
      token: code,
      type: "sms",
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
        <h1 className="text-xl font-semibold">Good Fruit Club</h1>

        {step === "phone" && (
          <form onSubmit={sendCode} className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm text-neutral-600">Phone number</span>
              <input
                type="tel"
                inputMode="tel"
                required
                autoFocus
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
            >
              {pending ? "Sending..." : "Send code"}
            </button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={verifyCode} className="space-y-4">
            <p className="text-sm text-neutral-600">
              Enter the code sent to {toE164(phone)}
            </p>
            <input
              type="text"
              inputMode="numeric"
              required
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-base tracking-widest"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
            >
              {pending ? "Verifying..." : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => setStep("phone")}
              className="w-full text-sm text-neutral-500"
            >
              Change phone number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
