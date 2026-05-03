"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Save,
  Search,
  X,
} from "lucide-react";

export interface HistoryEntry {
  id: string;
  report_type_id: string | null;
  brand?: string | null;
  campaign_name?: string | null;
  entry_date: string;
  note: string;
  screenshots: string[];
  created_at: string;
  updated_at: string;
}

interface EntryFormProps {
  /** Base URL for history endpoints, e.g. `/api/brands/<brand>`. */
  baseUrl: string;
  campaigns: string[];
  nicknames?: Record<string, string>;
  initial?: HistoryEntry;
  initialCampaign?: string;
  lockCampaign?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

export function EntryForm({
  baseUrl,
  campaigns,
  nicknames,
  initial,
  initialCampaign,
  lockCampaign,
  onCancel,
  onSaved,
}: EntryFormProps) {
  const [campaign, setCampaign] = useState<string>(initialCampaign ?? initial?.campaign_name ?? "");
  const [date, setDate] = useState<string>(
    initial?.entry_date ?? new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState<string>(initial?.note ?? "");
  const [screenshots, setScreenshots] = useState<string[]>(initial?.screenshots ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setErr(null);
    const uploaded: string[] = [];
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`${baseUrl}/history/upload`, {
          method: "POST",
          body: form,
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `upload failed (${res.status})`);
        uploaded.push(j.url);
      }
      setScreenshots((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void uploadFiles(imageFiles);
    }
  }

  async function save() {
    setSaving(true);
    setErr(null);
    const body = {
      entry_date: date,
      note: note.trim(),
      screenshots,
      campaign_name: campaign || null,
    };
    const url = initial ? `${baseUrl}/history/${initial.id}` : `${baseUrl}/history`;
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? `저장 실패 (${res.status})`);
      return;
    }
    onSaved();
  }

  function removeScreenshot(url: string) {
    setScreenshots((prev) => prev.filter((u) => u !== url));
  }

  return (
    <div
      onPaste={handlePaste}
      className="p-4 rounded-lg border border-cyan-500/30 bg-slate-800/60 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <CampaignPicker
          value={campaign}
          onChange={setCampaign}
          campaigns={campaigns}
          nicknames={nicknames}
          disabled={!!lockCampaign}
        />
        <label className="text-xs text-gray-400">
          날짜{" "}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="ml-2 rounded-md border border-purple-500/30 bg-slate-900 text-gray-200 px-2 py-1 text-sm focus:border-cyan-500 focus:outline-none [color-scheme:dark]"
          />
        </label>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="변경 내용, 테스트 가설, 결과 관찰 등..."
        rows={4}
        className="w-full rounded-md border border-purple-500/30 bg-slate-900 text-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
      />

      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-purple-500/30 bg-slate-900 text-xs text-gray-300 cursor-pointer hover:border-cyan-500/50">
            <ImageIcon size={14} className="text-cyan-400" />
            스크린샷 추가
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-[11px] text-gray-500">
            또는{" "}
            <kbd className="px-1 py-0.5 rounded bg-slate-900 border border-purple-500/30 text-gray-300 font-mono text-[10px]">
              Ctrl
            </kbd>
            <span className="mx-0.5 text-gray-500">+</span>
            <kbd className="px-1 py-0.5 rounded bg-slate-900 border border-purple-500/30 text-gray-300 font-mono text-[10px]">
              V
            </kbd>{" "}
            로 붙여넣기
          </span>
          {uploading && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin text-cyan-400" /> 업로드 중
            </span>
          )}
        </div>

        {screenshots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {screenshots.map((url) => (
              <div key={url} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="h-24 w-auto rounded-md border border-purple-500/20"
                />
                <button
                  onClick={() => removeScreenshot(url)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-slate-900/80 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-rose-300 transition-opacity"
                  title="제거"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && (
        <div className="p-2 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">
          {err}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={saving || uploading}
          className="px-3 py-1.5 rounded-md border border-purple-500/30 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
        >
          취소
        </button>
        <button
          onClick={save}
          disabled={saving || uploading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-sm font-medium hover:from-cyan-600 hover:to-purple-600 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {initial ? "저장" : "추가"}
        </button>
      </div>
    </div>
  );
}

function CampaignPicker({
  value,
  onChange,
  campaigns,
  nicknames,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  campaigns: string[];
  nicknames?: Record<string, string>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return campaigns.slice(0, 200);
    return campaigns
      .filter(
        (c) =>
          c.toLowerCase().includes(q) ||
          (nicknames?.[c] ?? "").toLowerCase().includes(q),
      )
      .slice(0, 200);
  }, [campaigns, nicknames, query]);

  const nickname = value ? nicknames?.[value] : undefined;

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-xs text-gray-400 mb-1">캠페인</label>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`inline-flex items-center gap-2 min-w-[260px] max-w-[420px] rounded-md border bg-slate-900 text-gray-200 px-3 py-1.5 text-sm focus:outline-none ${
          disabled
            ? "border-purple-500/10 opacity-70 cursor-not-allowed"
            : "border-purple-500/30 hover:border-cyan-500/50"
        }`}
      >
        <span className="flex-1 text-left truncate" title={value}>
          {value ? (
            nickname ? (
              <>
                <span className="text-gray-100">{nickname}</span>
                <span className="text-gray-500 ml-1.5 font-mono text-xs">{value}</span>
              </>
            ) : (
              <span className="font-mono text-xs">{value}</span>
            )
          ) : (
            <span className="text-gray-500">캠페인 선택…</span>
          )}
        </span>
        {!disabled && <ChevronDown size={14} className="text-gray-500" />}
      </button>
      {open && !disabled && (
        <div className="absolute z-[9999] mt-1 w-[440px] rounded-lg border border-purple-500/30 bg-slate-800 shadow-xl">
          <div className="p-2 border-b border-purple-500/20">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                placeholder="캠페인 또는 닉네임 검색"
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-purple-500/30 bg-slate-900 text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-auto">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 ${
                value === "" ? "text-cyan-300" : "text-gray-400"
              }`}
            >
              <span className="italic">(미지정)</span>
            </button>
            {filtered.map((c) => {
              const nick = nicknames?.[c];
              const active = c === value;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 ${
                    active ? "bg-cyan-500/10" : ""
                  }`}
                >
                  {nick ? (
                    <>
                      <span className={active ? "text-cyan-300 font-medium" : "text-gray-100"}>
                        {nick}
                      </span>
                      <span className="text-gray-500 ml-1.5 font-mono text-[10px] truncate">
                        {c}
                      </span>
                    </>
                  ) : (
                    <span
                      className={`font-mono text-[10px] ${active ? "text-cyan-300" : "text-gray-300"}`}
                      title={c}
                    >
                      {c}
                    </span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="p-3 text-center text-gray-500 text-xs">
                일치하는 캠페인이 없습니다
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
