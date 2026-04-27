"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/reports";
  const oauthError = params.get("oauth_error");
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function signInWithGoogle() {
    setGoogleLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
          : "/auth/callback";
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (oauthErr) {
        setError(`Google 로그인 실패: ${oauthErr.message}`);
        setGoogleLoading(false);
      }
      // On success the browser navigates to Google; this component unmounts.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google 로그인 실패");
      setGoogleLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {oauthError && (
        <div className="p-3 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          OAuth 오류: {oauthError}
        </div>
      )}

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={googleLoading}
        className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-md font-medium bg-white text-slate-900 hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50 transition-colors"
      >
        {googleLoading ? (
          <span className="text-sm">Google로 이동 중...</span>
        ) : (
          <>
            <GoogleIcon />
            <span className="text-sm">Google로 로그인</span>
          </>
        )}
      </button>

      {error && <p className="text-sm text-rose-400">{error}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
