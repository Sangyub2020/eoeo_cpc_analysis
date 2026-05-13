"use client";

import { useMemo } from "react";

/**
 * Gemini 의 출력이 늘 마크다운이라 굳이 react-markdown 의존성을 추가하지 않고
 * 직접 가벼운 렌더러를 둔다. 지원: ATX 헤딩(##), GFM 표, 순/비순 리스트,
 * 체크박스, **bold**, `code`, 일반 단락. 인라인 HTML 은 무시(이스케이프).
 *
 * 완전한 마크다운 파서가 아니다. Gemini 가 system prompt 에서 못박힌 형식만
 * 안정적으로 렌더하면 된다 — 표(`|`), 헤딩, 체크박스, 굵게/코드.
 */

interface Props {
  text: string;
}

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "check"; items: { done: boolean; text: string }[] }
  | { kind: "table"; header: string[]; align: ("left" | "right" | "center")[]; rows: string[][] }
  | { kind: "hr" };

function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push({ kind: "h", level: 3, text: line.slice(4).trim() });
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ kind: "h", level: 2, text: line.slice(3).trim() });
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ kind: "h", level: 1, text: line.slice(2).trim() });
      i++;
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    // 표: 헤더 라인 + 정렬 라인 + 본문
    if (line.includes("|") && i + 1 < lines.length && /^[|:\-\s]+$/.test(lines[i + 1])) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(parseAlign);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, align: aligns, rows });
      continue;
    }
    // 체크박스 리스트
    if (/^\s*-\s\[[ xX]\]\s/.test(line)) {
      const items: { done: boolean; text: string }[] = [];
      while (i < lines.length && /^\s*-\s\[[ xX]\]\s/.test(lines[i])) {
        const m = /^\s*-\s\[([ xX])\]\s(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push({ done: m[1] !== " ", text: m[2] });
        i++;
      }
      blocks.push({ kind: "check", items });
      continue;
    }
    // 일반 리스트
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s/, "").trim());
        i++;
        // 들여쓰기로 이어지는 줄은 이전 항목에 붙인다 (Gemini 가 가끔 그렇게 낸다).
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += "\n" + lines[i].trim();
          i++;
        }
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    // 숫자 리스트
    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s/, "").trim());
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // 일반 단락 — 빈 줄까지 묶기.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#|-{3,}|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) &&
      !lines[i].includes("|")
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

function splitRow(line: string): string[] {
  // 양 끝의 파이프 제거 + 셀 트리밍.
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((s) => s.trim());
}
function parseAlign(s: string): "left" | "right" | "center" {
  const t = s.trim();
  if (/^:-+:$/.test(t)) return "center";
  if (/^-+:$/.test(t)) return "right";
  return "left";
}

/** 인라인: **bold**, `code` 만 지원. 나머지는 그대로. */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let buf = "";
  let key = 0;
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = "";
    }
  };
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push(
          <strong
            key={`${keyBase}-b-${key++}`}
            className="text-cyan-200 font-semibold"
          >
            {text.slice(i + 2, end)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push(
          <code
            key={`${keyBase}-c-${key++}`}
            className="px-1 py-0.5 rounded bg-slate-900 text-amber-300 text-[11px] font-mono"
          >
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

export default function SimpleMarkdown({ text }: Props) {
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <div className="text-sm text-gray-200 leading-relaxed space-y-3">
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          const Tag: "h2" | "h3" | "h4" =
            b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4";
          const cls =
            b.level === 1
              ? "text-lg font-bold text-cyan-300 mt-4"
              : b.level === 2
                ? "text-base font-semibold text-cyan-200 mt-3 border-l-2 border-cyan-500/50 pl-2"
                : "text-sm font-semibold text-gray-100 mt-2";
          return (
            <Tag key={i} className={cls}>
              {renderInline(b.text, `h${i}`)}
            </Tag>
          );
        }
        if (b.kind === "hr") {
          return <hr key={i} className="border-purple-500/20 my-3" />;
        }
        if (b.kind === "p") {
          return (
            <p key={i}>{renderInline(b.text, `p${i}`)}</p>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} className="list-disc list-outside pl-5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j} className="whitespace-pre-wrap">
                  {renderInline(it, `ul${i}-${j}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (b.kind === "ol") {
          return (
            <ol key={i} className="list-decimal list-outside pl-5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it, `ol${i}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        if (b.kind === "check") {
          return (
            <ul key={i} className="space-y-1.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    defaultChecked={it.done}
                    className="mt-1 accent-cyan-500 shrink-0"
                  />
                  <span className={it.done ? "line-through text-gray-500" : ""}>
                    {renderInline(it.text, `ck${i}-${j}`)}
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        // table
        const alignClass = (a: "left" | "right" | "center" | undefined) =>
          a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
        return (
          <div
            key={i}
            className="overflow-x-auto rounded-lg border border-purple-500/20 bg-slate-900/50"
          >
            <table className="w-full text-xs">
              <thead className="bg-slate-800/80">
                <tr>
                  {b.header.map((h, j) => (
                    <th
                      key={j}
                      className={`px-2.5 py-1.5 text-gray-300 font-semibold ${alignClass(b.align[j])}`}
                    >
                      {renderInline(h, `th${i}-${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className="border-t border-purple-500/10 hover:bg-white/5"
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`px-2.5 py-1 text-gray-200 tabular-nums ${alignClass(b.align[ci])}`}
                      >
                        {renderInline(cell, `td${i}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
