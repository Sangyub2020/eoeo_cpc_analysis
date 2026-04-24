"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  Plus,
  Trash2,
  Image as ImageIcon,
  X,
  Pencil,
  Save,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FileText,
} from "lucide-react";

interface HistoryEntry {
  id: string;
  report_type_id: string | null;
  brand?: string | null;
  campaign_name?: string | null;
  entry_date: string; // YYYY-MM-DD
  note: string;
  screenshots: string[];
  created_at: string;
  updated_at: string;
}

interface Props {
  /** Base URL for history endpoints, e.g. `/api/brands/<brand>`. */
  baseUrl: string;
  /** Brand this log belongs to (shown in UI only). */
  brand: string;
  /** A report slug whose distinct campaign_name we can read from. */
  primarySlug: string;
  /** Map of campaign_name → nickname, so the list shows friendly labels. */
  nicknames?: Record<string, string>;
}

const UNCATEGORIZED_KEY = "__none__";

/**
 * Campaign-grouped change log: each campaign collapses to its own thread of
 * dated entries (note + screenshots). Entries without a campaign (legacy)
 * live under a "미지정" bucket.
 */
export default function CampaignLogTab({ baseUrl, brand, primarySlug, nicknames }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [showTopAdd, setShowTopAdd] = useState(false);
  const [filterCampaign, setFilterCampaign] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  /** Empty campaigns (no entries yet) are hidden by default — new entries go
   *  through the top "새 기록 추가" button which exposes all campaigns in the
   *  picker. Toggle this on to see them all inline. */
  const [showEmpty, setShowEmpty] = useState(false);

  // Load entries (brand-scoped) + campaigns list (from primary report)
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${baseUrl}/history`, { signal: abort.signal }).then((r) => r.json()),
      fetch(`/api/reports/${primarySlug}/distinct`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ column: "campaign_name", limit: 2000 }),
        signal: abort.signal,
      }).then((r) => r.json()),
    ])
      .then(([entriesJson, distJson]) => {
        if (entriesJson.error) throw new Error(entriesJson.error);
        setEntries(entriesJson.entries ?? []);
        const names = ((distJson.values ?? []) as { value: string | null }[])
          .map((v) => v.value)
          .filter((v): v is string => !!v);
        setCampaigns(names);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "로드 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [baseUrl, primarySlug, refreshKey]);

  /** Group entries by campaign_name. Each campaign is sorted newest-first. */
  const groups = useMemo(() => {
    const m = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const key = e.campaign_name ?? UNCATEGORIZED_KEY;
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        // entry_date desc, then created_at desc
        if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? 1 : -1;
        return a.created_at < b.created_at ? 1 : -1;
      });
    }
    return m;
  }, [entries]);

  /** Campaigns to display. Default: only campaigns that have entries (plus
   *  "미지정" if present). When `showEmpty` is on, empty campaigns from the
   *  distinct list appear below. */
  const displayed = useMemo(() => {
    const withEntries = Array.from(groups.keys()).filter(
      (k) => k !== UNCATEGORIZED_KEY,
    );
    const withSet = new Set(withEntries);
    const empty = showEmpty ? campaigns.filter((c) => !withSet.has(c)) : [];
    const q = filterCampaign.trim().toLowerCase();
    const match = (c: string) => {
      if (!q) return true;
      if (c.toLowerCase().includes(q)) return true;
      const nick = nicknames?.[c];
      return nick ? nick.toLowerCase().includes(q) : false;
    };
    const all = [...withEntries.filter(match), ...empty.filter(match)];
    if (groups.has(UNCATEGORIZED_KEY) && (!q || "미지정".includes(q))) {
      all.push(UNCATEGORIZED_KEY);
    }
    return all;
  }, [groups, campaigns, filterCampaign, nicknames, showEmpty]);

  const emptyCount = useMemo(() => {
    const withSet = new Set(groups.keys());
    return campaigns.filter((c) => !withSet.has(c)).length;
  }, [campaigns, groups]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copyCampaignName(e: React.MouseEvent, name: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(name);
      setCopiedKey(name);
      window.setTimeout(
        () => setCopiedKey((k) => (k === name ? null : k)),
        1500,
      );
    } catch {
      // clipboard API unavailable — silently ignore
    }
  }

  async function deleteEntry(id: string) {
    if (!window.confirm("이 기록을 삭제할까요?")) return;
    const res = await fetch(`${baseUrl}/history/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${j.error ?? res.status}`);
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-medium text-gray-100">캠페인 수정일지</h2>
          <p className="text-xs text-gray-500">
            {brand} 브랜드의 캠페인별 변경 기록. 캠페인을 클릭하면 스레드가 펼쳐집니다.
          </p>
        </div>
        {!showTopAdd && (
          <button
            onClick={() => setShowTopAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-sm font-medium hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/30"
          >
            <Plus size={14} /> 새 기록 추가
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {showTopAdd && (
        <EntryForm
          baseUrl={baseUrl}
          campaigns={campaigns}
          nicknames={nicknames}
          onCancel={() => setShowTopAdd(false)}
          onSaved={() => {
            setShowTopAdd(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={filterCampaign}
            onChange={(e) => setFilterCampaign(e.target.value)}
            placeholder="캠페인 이름 또는 닉네임으로 스레드 찾기"
            className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md border border-purple-500/20 bg-slate-900 text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
            className="accent-cyan-500"
          />
          <span>기록 없는 캠페인도 보기 ({emptyCount})</span>
        </label>
      </div>

      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-2 p-6 text-gray-500 text-sm">
          <Loader2 size={14} className="animate-spin text-cyan-400" />
          불러오는 중...
        </div>
      ) : displayed.length === 0 ? (
        <div className="p-10 rounded-lg border border-dashed border-purple-500/30 bg-slate-800/40 text-center text-gray-500 text-sm">
          일치하는 캠페인이 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((key) => {
            const isUncat = key === UNCATEGORIZED_KEY;
            const list = groups.get(key) ?? [];
            const isOpen = expanded.has(key);
            const nickname = isUncat ? null : nicknames?.[key];
            const lastDate = list[0]?.entry_date;
            return (
              <div
                key={key}
                className="border border-purple-500/20 rounded-lg bg-slate-800/40 overflow-hidden"
              >
                <button
                  onClick={() => toggle(key)}
                  className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/5 text-left"
                >
                  {isOpen ? (
                    <ChevronDown size={14} className="text-cyan-400 shrink-0" />
                  ) : (
                    <ChevronRight size={14} className="text-gray-500 shrink-0" />
                  )}
                  <FileText size={12} className="text-gray-500 shrink-0" />
                  {isUncat ? (
                    <span className="text-sm italic text-gray-500 truncate">(미지정)</span>
                  ) : (
                    <>
                      <span
                        className="text-sm font-medium text-gray-100 font-mono text-xs truncate cursor-context-menu"
                        title={`${key}\n우클릭: 캠페인 이름 복사`}
                        onContextMenu={(e) => copyCampaignName(e, key)}
                      >
                        {key}
                      </span>
                      {nickname && (
                        <span
                          className="text-[11px] text-cyan-300/80 truncate"
                          title={`닉네임: ${nickname}`}
                        >
                          ({nickname})
                        </span>
                      )}
                      {copiedKey === key && (
                        <span className="text-[10px] text-emerald-300 shrink-0 animate-pulse">
                          복사됨
                        </span>
                      )}
                    </>
                  )}
                  <span className="flex-1" />
                  <span className="text-[11px] text-gray-500 shrink-0">
                    {list.length > 0 ? (
                      <>
                        {list.length}건
                        {lastDate && <span className="ml-1.5 text-gray-600">· 최근 {lastDate}</span>}
                      </>
                    ) : (
                      <span className="italic">기록 없음</span>
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-purple-500/20 p-3 space-y-3">
                    {addingFor !== key && (
                      <button
                        onClick={() => setAddingFor(key)}
                        className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200"
                      >
                        <Plus size={12} /> 이 캠페인에 기록 추가
                      </button>
                    )}
                    {addingFor === key && (
                      <EntryForm
                        baseUrl={baseUrl}
                        campaigns={campaigns}
                        nicknames={nicknames}
                        initialCampaign={isUncat ? "" : key}
                        lockCampaign={!isUncat}
                        onCancel={() => setAddingFor(null)}
                        onSaved={() => {
                          setAddingFor(null);
                          setRefreshKey((k) => k + 1);
                        }}
                      />
                    )}

                    {list.length === 0 && addingFor !== key && (
                      <div className="text-xs text-gray-500 italic">아직 기록이 없습니다.</div>
                    )}

                    {list.map((e) =>
                      editingId === e.id ? (
                        <EntryForm
                          key={e.id}
                          baseUrl={baseUrl}
                          campaigns={campaigns}
                          nicknames={nicknames}
                          initial={e}
                          initialCampaign={e.campaign_name ?? ""}
                          onCancel={() => setEditingId(null)}
                          onSaved={() => {
                            setEditingId(null);
                            setRefreshKey((k) => k + 1);
                          }}
                        />
                      ) : (
                        <EntryCard
                          key={e.id}
                          entry={e}
                          onEdit={() => setEditingId(e.id)}
                          onDelete={() => deleteEntry(e.id)}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: HistoryEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Open index into entry.screenshots when a thumbnail is clicked. Null closes.
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  return (
    <div className="p-3 rounded-md border border-purple-500/20 bg-slate-900/40 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-xs text-cyan-300 font-mono">{entry.entry_date}</div>
          <p className="mt-1 text-sm text-gray-200 whitespace-pre-wrap">
            {entry.note || <span className="italic text-gray-500">(내용 없음)</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300 hover:bg-white/5"
            title="수정"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-gray-400 hover:text-rose-300 hover:bg-rose-500/10"
            title="삭제"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {entry.screenshots && entry.screenshots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entry.screenshots.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setLightboxIdx(i)}
              className="block p-0 border-0 bg-transparent cursor-zoom-in"
              title="클릭해서 크게 보기"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="screenshot"
                className="h-28 w-auto rounded-md border border-purple-500/20 object-cover hover:border-cyan-500/50 transition-colors"
              />
            </button>
          ))}
        </div>
      )}
      {lightboxIdx != null && (
        <ScreenshotLightbox
          images={entry.screenshots}
          index={lightboxIdx}
          onChange={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

/**
 * Fullscreen screenshot viewer. Renders a portal on the body, blocks body
 * scroll while open, and supports Esc to close + arrow keys / on-screen
 * buttons to navigate within the same entry's screenshot list.
 */
function ScreenshotLightbox({
  images,
  index,
  onChange,
  onClose,
}: {
  images: string[];
  index: number;
  onChange: (next: number) => void;
  onClose: () => void;
}) {
  const go = useCallback(
    (delta: number) => {
      const n = images.length;
      if (n === 0) return;
      // Wrap so you can cycle — useful when an entry has many screenshots.
      onChange(((index + delta) % n + n) % n);
    },
    [images.length, index, onChange],
  );

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", h);
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  if (typeof document === "undefined") return null;
  const url = images[index];
  const canNav = images.length > 1;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
      />
      <div className="relative max-w-[92vw] max-h-[92vh] flex flex-col items-center gap-3">
        <div className="flex items-center justify-between w-full px-1 text-xs text-gray-300">
          <span className="tabular-nums">
            {index + 1} / {images.length}
          </span>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-gray-300 hover:text-rose-300 hover:bg-white/10"
            title="닫기 (Esc)"
          >
            <X size={14} /> 닫기
          </button>
        </div>
        <div className="relative flex items-center">
          {canNav && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute -left-12 p-2 rounded-full bg-slate-900/70 border border-purple-500/30 text-gray-200 hover:bg-cyan-500/20 hover:text-cyan-200"
              title="이전 (←)"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="screenshot"
            className="max-w-[88vw] max-h-[80vh] object-contain rounded-md border border-purple-500/20 shadow-2xl shadow-cyan-500/10"
          />
          {canNav && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute -right-12 p-2 rounded-full bg-slate-900/70 border border-purple-500/30 text-gray-200 hover:bg-cyan-500/20 hover:text-cyan-200"
              title="다음 (→)"
            >
              <ChevronRight size={20} />
            </button>
          )}
        </div>
        {canNav && (
          <div className="flex gap-1.5 max-w-[88vw] overflow-x-auto py-1">
            {images.map((u, i) => (
              <button
                key={u}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(i);
                }}
                className={`shrink-0 h-12 w-auto rounded border transition-colors ${
                  i === index
                    ? "border-cyan-400 ring-2 ring-cyan-500/40"
                    : "border-purple-500/20 opacity-60 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u}
                  alt=""
                  className="h-full w-auto object-cover rounded-[3px]"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function EntryForm({
  baseUrl,
  campaigns,
  nicknames,
  initial,
  initialCampaign,
  lockCampaign,
  onCancel,
  onSaved,
}: {
  baseUrl: string;
  campaigns: string[];
  nicknames?: Record<string, string>;
  initial?: HistoryEntry;
  initialCampaign?: string;
  lockCampaign?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
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
