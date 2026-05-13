"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";

const MENU_MAX_HEIGHT = 288; // tailwind max-h-72

interface Props {
  /** 후보 캠페인 이름 목록. */
  options: string[];
  /** campaign_name → nickname. 있으면 옵션과 표시값을 닉네임 위주로. */
  nicknames?: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 외부 너비 제한 — 페이지의 다른 입력들과 톤 맞추려고 디폴트는 fit-content. */
  className?: string;
}

/**
 * 캠페인 선택용 검색 가능한 콤보박스. 브랜드 페이지의 input/select 톤
 * (`border-purple-500/30 bg-slate-900 text-gray-200`) 을 그대로 사용한다.
 *
 * - 닉네임이 있으면 옵션에 굵게 표시 + 원래 캠페인 이름을 작은 글씨로.
 * - 닫힌 상태의 input 에는 닉네임 (있으면) 또는 캠페인 이름 그대로.
 * - 검색은 닉네임/캠페인명 둘 다 case-insensitive substring 매칭.
 */
export default function CampaignCombobox({
  options,
  nicknames,
  value,
  onChange,
  placeholder = "(선택)",
  disabled = false,
  className = "min-w-[260px] flex-1",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  /** 메뉴의 viewport 좌표 + 너비. open 일 때만 채워진다. flip 됐을 때 transform-origin 도 같이 전달. */
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    placement: "below" | "above";
  } | null>(null);

  // 닫혔을 땐 input 에 선택된 항목을 보여준다 (닉네임 우선). 열렸을 땐 검색어를 입력 중.
  const displayValue = useMemo(() => {
    if (open) return query;
    if (!value) return "";
    return nicknames?.[value] ? `${nicknames[value]} · ${value}` : value;
  }, [open, query, value, nicknames]);

  // 검색어로 필터링. 닉네임 또는 캠페인명에 매칭되면 통과.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = options.map((o) => ({
      value: o,
      nickname: nicknames?.[o] ?? null,
    }));
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.value.toLowerCase().includes(q)) return true;
      if (r.nickname && r.nickname.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [options, nicknames, query]);

  // 옵션 리스트가 바뀌면 active index 를 처음으로 리셋.
  useEffect(() => {
    setActiveIdx(0);
  }, [query, options.length]);

  // 바깥 클릭 시 닫힘. portal 로 띄운 menu 도 wrap 바깥이지만 클릭은 허용해야 한다.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 트리거 위치 + 뷰포트 공간에 맞춰 portal 메뉴를 띄울 좌표 계산. open 변화 +
  // scroll / resize 에서 재계산해서 트리거 따라다니게 한다. 아래에 공간이 부족하고
  // 위에 더 많은 공간이 있으면 위로 펼친다 (flip).
  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    function update() {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vh = window.innerHeight;
      const spaceBelow = vh - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const placement: "below" | "above" =
        spaceBelow >= MENU_MAX_HEIGHT || spaceBelow >= spaceAbove
          ? "below"
          : "above";
      const top =
        placement === "below"
          ? rect.bottom + 4
          : Math.max(8, rect.top - MENU_MAX_HEIGHT - 4);
      setMenuPos({ top, left: rect.left, width: rect.width, placement });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  function commit(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[activeIdx];
      if (pick) commit(pick.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full pl-7 pr-12 py-1 rounded border border-purple-500/30 bg-slate-900 text-[11px] text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none disabled:opacity-50 truncate"
        />
        {value && !open && (
          <button
            type="button"
            aria-label="선택 해제"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="absolute right-7 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-rose-500/20 text-gray-500 hover:text-rose-300"
          >
            <X size={11} />
          </button>
        )}
        <ChevronDown
          size={12}
          className={`absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 transition-transform ${
            open ? "rotate-180" : ""
          } pointer-events-none`}
        />
      </div>

      {open &&
        menuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: MENU_MAX_HEIGHT,
              zIndex: 9999,
            }}
            className="overflow-y-auto rounded border border-purple-500/30 bg-slate-900 shadow-xl shadow-slate-950/60"
          >
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-gray-500 italic">
                일치하는 캠페인 없음
              </div>
            ) : (
              <ul className="py-0.5">
                {filtered.slice(0, 300).map((r, i) => {
                  const active = i === activeIdx;
                  const isSelected = r.value === value;
                  return (
                    <li key={r.value}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIdx(i)}
                        onMouseDown={(e) => {
                          // mousedown 으로 처리해서 input blur 전에 commit.
                          e.preventDefault();
                          commit(r.value);
                        }}
                        title={r.value}
                        className={`w-full text-left px-2 py-1 text-[11px] flex flex-col gap-0 ${
                          active
                            ? "bg-cyan-500/10 text-cyan-200"
                            : isSelected
                              ? "bg-cyan-500/5 text-cyan-300"
                              : "text-gray-200 hover:bg-white/5"
                        }`}
                      >
                        <span className="truncate">
                          {r.nickname ? (
                            <>
                              <span className="font-semibold">{r.nickname}</span>
                              <span className="text-gray-500"> · </span>
                              <span className="text-gray-400">{r.value}</span>
                            </>
                          ) : (
                            <span className="font-mono text-gray-200">{r.value}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filtered.length > 300 && (
                  <li className="px-2 py-1 text-[10px] text-gray-500 italic">
                    … 위에서 300개만 표시. 검색어를 좁혀주세요.
                  </li>
                )}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
