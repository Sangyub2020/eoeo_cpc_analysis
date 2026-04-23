"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/reports";
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input
        type="password"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        placeholder="공용 패스코드"
        className="w-full rounded-lg border border-purple-500/30 bg-slate-800 px-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
        autoFocus
      />
      <button
        type="submit"
        disabled={loading || !passcode}
        className="w-full inline-flex items-center justify-center h-10 rounded-md font-medium bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/50 transition-colors disabled:pointer-events-none disabled:opacity-50"
      >
        {loading ? "확인 중..." : "들어가기"}
      </button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </form>
  );
}
