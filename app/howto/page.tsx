import {
  Tags,
  Download,
  Upload,
  CheckCircle2,
  BarChart3,
  MessageSquare,
} from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * One-page how-to guide. Aimed at non-technical teammates seeing the
 * dashboard for the first time — keep the language simple, the steps
 * numbered, and the entire flow visible without scrolling much.
 */
export default function HowToPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
          사용법
        </h1>
        <p className="text-gray-400 mt-2">
          이 대시보드는 Amazon 광고 데이터를 보기 좋게 정리해주는 도구예요.
          순서대로 따라하면 됩니다.
        </p>
      </div>

      {/* Step 1 */}
      <section className="p-5 rounded-lg border border-purple-500/20 bg-slate-800/40 space-y-2">
        <h2 className="text-lg font-semibold text-gray-100 inline-flex items-center gap-2">
          <Tags className="text-cyan-300" size={18} />
          1. 브랜드 만들기 (처음 한 번만)
        </h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          상단 메뉴 <span className="font-mono text-cyan-300">브랜드</span> 를
          누르고 <strong>"새 브랜드 추가"</strong> 클릭. 표시 이름 (예:{" "}
          <span className="font-mono">KAHI</span>) 과 슬러그 (예:{" "}
          <span className="font-mono">kahi</span>) 입력 → 추가.
        </p>
        <p className="text-xs text-gray-500">
          💡 브랜드명이 캠페인 이름 안에 들어있으면 (예:{" "}
          <span className="font-mono">SP_KAHI_xxx</span>) 자동으로 그 브랜드로
          분류돼요. 안 들어있으면 업로드할 때 직접 골라줍니다.
        </p>
      </section>

      {/* Step 2 */}
      <section className="p-5 rounded-lg border border-purple-500/20 bg-slate-800/40 space-y-3">
        <h2 className="text-lg font-semibold text-gray-100 inline-flex items-center gap-2">
          <Download className="text-cyan-300" size={18} />
          2. Amazon 에서 보고서 다운로드
        </h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          Amazon Advertising Console → Reports → Sponsored Products 에서{" "}
          <strong>세 가지</strong> 보고서를 받아옵니다. 각 보고서는{" "}
          <span className="text-gray-400">Dimensions</span> (그룹핑 기준) +{" "}
          <span className="text-gray-400">Metrics</span> (수치 지표) 로
          구성됩니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ReportCard
            title="SP 검색어 레포트"
            subtitle="Search term report"
            dimensions={[
              "Date",
              "Campaign name",
              "Search term",
              "Budget currency",
            ]}
            metrics={["Impressions", "Clicks", "Total cost", "Sales"]}
          />
          <ReportCard
            title="SP 타겟 키워드 레포트"
            subtitle="Targeting report"
            dimensions={[
              "Date",
              "Campaign name",
              "Target value",
              "Target match type",
              "Budget currency",
            ]}
            metrics={["Impressions", "Clicks", "Total cost", "Sales"]}
          />
          <ReportCard
            title="SP 원본 (드릴다운용)"
            subtitle="Search term report — full raw"
            dimensions={[
              "Date",
              "Campaign name",
              "Target value",
              "Target match type",
              "Search term",
              "Budget currency",
            ]}
            metrics={["Impressions", "Clicks", "Total cost", "Sales"]}
            note="가장 용량 큰 파일. 검색어 ↔ 타겟 cross-drill 조회용."
          />
        </div>

        <p className="text-xs text-gray-500 leading-relaxed">
          ⚠️ <strong>세 종류 모두 올리세요</strong>. 빠뜨리면 해당 분석 화면이
          비어 보입니다. Amazon 의 헤더 이름이 살짝 달라도 시스템이 자동으로
          맞춰주니 그대로 올리면 됩니다.
        </p>
      </section>

      {/* Step 3 */}
      <section className="p-5 rounded-lg border border-purple-500/20 bg-slate-800/40 space-y-2">
        <h2 className="text-lg font-semibold text-gray-100 inline-flex items-center gap-2">
          <Upload className="text-cyan-300" size={18} />
          3. 업로드
        </h2>
        <ol className="text-sm text-gray-300 space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>
            상단 <span className="font-mono text-cyan-300">레포트</span> 페이지
            우상단 <strong>"업로드"</strong> 버튼 클릭
          </li>
          <li>
            CSV 파일을 끌어다 놓기 (xlsx 도 가능, 단 큰 파일은 CSV 권장).
            여러 개 한꺼번에 드래그도 OK
          </li>
          <li>
            <strong>레포트 종류</strong> 선택: 방금 받은 게 검색어 / 타겟
            키워드 / 원본 중 무엇인지에 맞게 세 개 중 하나 클릭
          </li>
          <li>
            <strong>브랜드 분류</strong> 화면 — 자동 매칭이 안 된 캠페인이
            있으면 직접 브랜드를 골라줍니다. "Easydew 일괄" 같은 버튼으로
            한꺼번에 지정 가능
          </li>
          <li>
            <strong>커밋</strong> 버튼 → 진행 표시 끝나면 완료. 대기 중인 다음
            파일이 있으면 "다음 파일 올리기" 클릭
          </li>
        </ol>
        <p className="text-xs text-gray-500 leading-relaxed">
          💡 같은 파일을 또 올려도 중복 안 쌓여요 (같은 키 = date + campaign +
          search/target 으로 자동 중복 제거). 새 날짜 데이터만 추가됩니다.
        </p>
      </section>

      {/* Step 4 */}
      <section className="p-5 rounded-lg border border-purple-500/20 bg-slate-800/40 space-y-2">
        <h2 className="text-lg font-semibold text-gray-100 inline-flex items-center gap-2">
          <BarChart3 className="text-cyan-300" size={18} />
          4. 대시보드 보기
        </h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          <span className="font-mono text-cyan-300">레포트</span> 메인의{" "}
          <strong>브랜드 카드</strong> 를 클릭 → 그 브랜드 전용 대시보드.
          상단 ChartBuilder 에서 캠페인을 선택하면 아래 두 섹션 (Search term
          분석 / Target value 분석) 이 같이 필터링됩니다.
        </p>
        <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside leading-relaxed">
          <li>
            <strong>공통 기간</strong> 으로 모든 차트 동시 필터링
          </li>
          <li>
            우측 패널에서 검색어 / 타겟 체크박스 → 차트에 즉시 반영
          </li>
          <li>
            우측 패널 행의{" "}
            <span className="font-mono text-cyan-300">🎯</span> 아이콘 →
            드릴다운 (어떤 타겟이 이 검색어와 매칭됐는지) — raw 레포트 업로드
            필요
          </li>
          <li>
            <strong>캠페인 닉네임</strong> 탭에서 긴 Amazon 캠페인명을 짧게
            별명 짓기 — 차트에서 별명으로 표시됨
          </li>
          <li>
            <strong>캠페인 수정일지</strong> 탭에서 캠페인별 변경 내용 +
            스크린샷 (Ctrl+V 붙여넣기) 기록
          </li>
          <li>
            <strong>업로드 관리</strong> 탭에서 잘못 올린 파일을 개별 삭제
            가능
          </li>
        </ul>
      </section>

      {/* Step 5 — feedback */}
      <section className="p-5 rounded-lg border border-cyan-500/20 bg-cyan-500/5 space-y-2">
        <h2 className="text-lg font-semibold text-gray-100 inline-flex items-center gap-2">
          <MessageSquare className="text-cyan-300" size={18} />
          5. 막히면? 건의하면?
        </h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          상단 <span className="font-mono text-cyan-300">건의 · 피드백</span>{" "}
          메뉴에 자유롭게 글 + 스크린샷 (Ctrl+V) 남겨주세요. 닉네임은
          로그인된 이메일이 자동으로 들어갑니다. 댓글로 의견 추가도 가능.
        </p>
      </section>

      <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-sm text-emerald-200 inline-flex items-center gap-2">
        <CheckCircle2 size={16} />
        끝. 처음 한 번만 브랜드 만들고, 그 다음부터는 매주{" "}
        <strong>다운로드 → 업로드 → 본다</strong> 만 하면 돼요.
      </div>
    </div>
  );
}

/** Single report-type card with separate Dimensions / Metrics blocks. */
function ReportCard({
  title,
  subtitle,
  dimensions,
  metrics,
  note,
}: {
  title: string;
  subtitle: string;
  dimensions: string[];
  metrics: string[];
  note?: string;
}) {
  return (
    <div className="p-3 rounded border border-purple-500/30 bg-slate-900/50 space-y-2">
      <div>
        <div className="text-sm font-semibold text-cyan-300">{title}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">{subtitle}</div>
      </div>
      <div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">
          Dimensions
        </div>
        <ul className="text-[11px] text-gray-300 space-y-0.5 list-disc list-inside leading-snug">
          {dimensions.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">
          Metrics
        </div>
        <ul className="text-[11px] text-gray-300 space-y-0.5 list-disc list-inside leading-snug">
          {metrics.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
      {note && <div className="text-[10px] text-amber-300/80 italic">{note}</div>}
    </div>
  );
}
