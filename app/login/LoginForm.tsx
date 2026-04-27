"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/reports";
  const oauthError = params.get("oauth_error");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    setLoading(false);
    if (res.ok) {
      router.replace(next);
      router.refresh();
    } else {
      setError("패스코드가 올바르지 않습니다.");
    }
  }

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
      // On success the browser is navigated to Google; this component unmounts.
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
        disabled={googleLoading || loading}
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

      <div className="flex items-center gap-3 text-[11px] text-gray-500">
        <span className="flex-1 h-px bg-gray-700" />
        <span>또는 공용 패스코드</span>
        <span className="flex-1 h-px bg-gray-700" />
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="공용 패스코드"
          className="w-full rounded-lg border border-purple-500/30 bg-slate-800 px-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !passcode}
          className="w-full inline-flex items-center justify-center h-10 rounded-md font-medium bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/50 transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "확인 중..." : "들어가기"}
        </button>
      </form>

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
