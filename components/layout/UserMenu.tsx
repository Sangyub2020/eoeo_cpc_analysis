"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

/** Simple logout button for the shared-passcode gate. No per-user identity,
 *  so we just clear the auth cookie and bounce to /login. */
export default function UserMenu() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={signingOut}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400 hover:text-rose-300 hover:bg-white/5 disabled:opacity-50"
      title="로그아웃"
    >
      <LogOut size={13} />
      <span className="hidden md:inline">로그아웃</span>
    </button>
  );
}
