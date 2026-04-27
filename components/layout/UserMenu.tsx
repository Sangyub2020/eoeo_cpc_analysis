"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Header user menu. Shows the signed-in Google user's email (or just an
 * anonymous "passcode 로그인" indicator when the legacy gate is in use)
 * with a sign-out button. Sign-out clears both the Supabase session and
 * the legacy passcode cookie via /api/auth DELETE.
 */
export default function UserMenu() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!cancelled) setEmail(user?.email ?? null);
      } catch {
        // env vars missing or transient error — show anonymous label
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    // Best-effort client-side sign-out so the next page load doesn't
    // briefly see the old session before the server cookie clears.
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="inline-flex items-center gap-2">
      {email && (
        <span
          className="text-xs text-cyan-300 font-medium max-w-[220px] truncate"
          title={email}
        >
          {email}
        </span>
      )}
      <button
        onClick={signOut}
        disabled={signingOut}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400 hover:text-rose-300 hover:bg-white/5 disabled:opacity-50"
        title="로그아웃"
      >
        <LogOut size={13} />
        <span className="hidden md:inline">로그아웃</span>
      </button>
    </div>
  );
}
