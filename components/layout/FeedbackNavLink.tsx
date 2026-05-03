"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";

const STORAGE_KEY = "feedback:lastSeenAt";
const POLL_INTERVAL_MS = 60_000;

/**
 * Nav-bar link to /feedback with an unread badge. "Unread" = posts +
 * comments created after the user last visited /feedback (recorded in
 * localStorage). On first ever load, the timestamp is seeded to the
 * latest existing activity so historical content doesn't appear unread.
 */
export default function FeedbackNavLink() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function ensureSeed(): Promise<string> {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing) return existing;
      try {
        const r = await fetch("/api/feedback/unread");
        const j = await r.json();
        // Seed to the latest existing activity (or now() if there's nothing
        // yet) so the badge starts at 0 instead of counting all history.
        const seed = j.lastActivityAt ?? new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, seed);
        return seed;
      } catch {
        const fallback = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, fallback);
        return fallback;
      }
    }

    async function refresh() {
      try {
        const since = await ensureSeed();
        const r = await fetch(`/api/feedback/unread?since=${encodeURIComponent(since)}`);
        const j = await r.json();
        if (!cancelled) setUnread(Number(j.total ?? 0));
      } catch {
        // network hiccup — leave the prior count visible
      }
    }

    void refresh();
    timer = setInterval(refresh, POLL_INTERVAL_MS);

    function onFocus() {
      void refresh();
    }
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Visiting /feedback marks everything up to "now" as seen.
  useEffect(() => {
    if (pathname !== "/feedback") return;
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setUnread(0);
  }, [pathname]);

  return (
    <Link
      href="/feedback"
      className="relative inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 text-gray-300 hover:bg-white/5 hover:text-cyan-300"
    >
      <MessageSquare className="h-4 w-4" />
      건의 · 피드백
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none border border-slate-900 shadow-md">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
