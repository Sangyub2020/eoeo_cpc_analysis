import type { Metadata } from "next";
import Link from "next/link";
import { Upload, BarChart3, Tags } from "lucide-react";
import UserMenu from "@/components/layout/UserMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "Amazon Advertising Dashboard",
  description: "Upload Amazon ad reports, view as tables and charts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body>
        <div className="min-h-screen bg-slate-900">
          <header className="border-b border-purple-500/20 bg-slate-800/40 backdrop-blur-xl sticky top-0 z-10">
            <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
              <Link
                href="/"
                className="font-bold text-lg bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent"
              >
                Amazon Ads
              </Link>
              <nav className="flex items-center gap-3 text-sm">
                <Link
                  href="/reports"
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 text-gray-300 hover:bg-white/5 hover:text-cyan-300"
                >
                  <BarChart3 className="h-4 w-4" />
                  레포트
                </Link>
                <Link
                  href="/brands/manage"
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 text-gray-300 hover:bg-white/5 hover:text-cyan-300"
                >
                  <Tags className="h-4 w-4" />
                  브랜드
                </Link>
                <Link
                  href="/upload"
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 text-gray-300 hover:bg-white/5 hover:text-cyan-300"
                >
                  <Upload className="h-4 w-4" />
                  업로드
                </Link>
                <UserMenu />
              </nav>
            </div>
          </header>
          <main className="max-w-[1600px] mx-auto px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
