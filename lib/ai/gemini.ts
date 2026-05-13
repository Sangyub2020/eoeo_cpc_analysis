/**
 * Gemini 호출을 위한 얇은 fetch 래퍼. SDK 의존성을 추가하지 않고도 충분히
 * 동작하며, 응답 구조가 깨졌을 때는 의미 있는 에러를 던진다.
 *
 * 환경변수:
 *   GEMINI_API_KEY  — Google AI Studio 에서 발급한 API 키. 필수.
 *   GEMINI_MODEL    — 모델 ID. 미지정 시 'gemini-3.1-pro-latest' 를 사용.
 */

const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// 2026-05 시점 Gemini 3.1 Pro 의 정식 모델 ID. v1beta ListModels 에서 확인됨.
// 추후 GA 로 승격되면 GEMINI_MODEL 환경변수로 새 ID 를 지정해 오버라이드.
const DEFAULT_MODEL = "gemini-3.1-pro-preview";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** 일시 과부하 시 같은 모델로 재시도할 백오프(ms) 배열. 합계 ~30초 — Railway
 *  maxDuration=120s 안에 충분히 들어가면서, "Spike" 가 회복될 시간을 충분히 준다.
 *  주의: 자동으로 다른 모델로 떨어뜨리지 않는다. 사용자가 명시한 모델만 쓴다. */
const RETRY_BACKOFFS_MS = [500, 1500, 3500, 7000, 15000];

export interface GeminiOptions {
  system: string;
  /** 단일 user 메시지. 우리는 멀티턴 대화가 필요 없다. */
  user: string;
  /** 0 ~ 1. 분석은 결정론적이 좋으므로 기본 0.2. */
  temperature?: number;
  /** 출력 + thinking 토큰 상한. Gemini 2.5/3.x Pro 는 thinking 토큰을 따로
   *  소비하므로 텍스트 출력을 위해 충분히 크게 잡아야 한다. 기본 32768. */
  maxOutputTokens?: number;
  /** thinking 에 할당할 최대 토큰. 분석은 사고가 도움되지만 너무 많으면
   *  답이 짧아져서 8192 로 캡. -1 로 주면 자동, 0 으로 주면 thinking 비활성. */
  thinkingBudget?: number;
  /** 모델 ID 오버라이드. */
  model?: string;
}

export interface GeminiResult {
  text: string;
  model: string;
  /** 입력 + 출력 토큰 사용량 (Google 응답에 있을 때만). */
  usage?: {
    promptTokens?: number;
    candidatesTokens?: number;
    totalTokens?: number;
  };
}

/** 단일 모델로 한 번 호출. 응답 파싱 + 텍스트 추출까지. */
async function callOnce(
  apiKey: string,
  model: string,
  opts: GeminiOptions,
): Promise<{ ok: true; result: GeminiResult } | { ok: false; status: number; message: string }> {
  const url = `${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      // Gemini 2.5+ pro 는 thinking 토큰을 출력 토큰과 같은 한도에서 소비한다.
      // 분석은 4–8k 토큰의 마크다운이 필요하므로 한도를 넉넉히 잡고,
      // thinking 은 별도 budget 으로 캡해서 답이 잘리지 않게 한다.
      maxOutputTokens: opts.maxOutputTokens ?? 32768,
      thinkingConfig: {
        thinkingBudget: opts.thinkingBudget ?? 8192,
      },
      responseMimeType: "text/plain",
    },
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "network error" };
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: errText.slice(0, 500) };
  }
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    promptFeedback?: { blockReason?: string };
  };
  if (json.promptFeedback?.blockReason) {
    return {
      ok: false,
      status: 400,
      message: `프롬프트 차단: ${json.promptFeedback.blockReason}`,
    };
  }
  const candidate = json.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("").trim();
  if (!text) {
    return {
      ok: false,
      status: 502,
      message: `빈 응답 (finishReason=${candidate?.finishReason ?? "unknown"})`,
    };
  }
  return {
    ok: true,
    result: {
      text,
      model,
      usage: json.usageMetadata
        ? {
            promptTokens: json.usageMetadata.promptTokenCount,
            candidatesTokens: json.usageMetadata.candidatesTokenCount,
            totalTokens: json.usageMetadata.totalTokenCount,
          }
        : undefined,
    },
  };
}

/**
 * Gemini 를 호출한다. 사용자가 지정한 모델 한 가지만 쓴다 — 503 (UNAVAILABLE) /
 * 429 (RESOURCE_EXHAUSTED) 가 나오면 같은 모델로 지수 백오프로 여러 번 재시도
 * 한다. 자동으로 더 낮은 등급의 모델로 떨어뜨리지 않는다 (구독한 모델을 그대로
 * 쓰는 게 사용자 의도).
 */
export async function callGemini(opts: GeminiOptions): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY 가 설정되지 않았습니다. .env.local 에 추가하세요.",
    );
  }
  const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

  let lastStatus = 500;
  let lastMsg = "알 수 없는 오류";
  // 첫 시도(즉시) + 백오프 재시도들. 총 시도 횟수 = 1 + RETRY_BACKOFFS_MS.length.
  const sleeps: number[] = [0, ...RETRY_BACKOFFS_MS];
  for (let i = 0; i < sleeps.length; i++) {
    if (sleeps[i] > 0) {
      await new Promise((r) => setTimeout(r, sleeps[i]));
    }
    const out = await callOnce(apiKey, model, opts);
    if (out.ok) return out.result;
    lastStatus = out.status;
    lastMsg = out.message;
    // 재시도해도 결과 안 바뀌는 에러(400/401/403/404, 프롬프트 차단 등)는 즉시 중단.
    if (out.status !== 0 && !RETRYABLE_STATUS.has(out.status)) break;
  }
  // 사용자가 503 을 자주 보면 직접 모델 ID 를 바꾸도록 안내. 자동 폴백 없음.
  throw new Error(
    `Gemini 호출 실패 (${lastStatus}, 모델 ${model} 으로 ${sleeps.length}회 시도): ${lastMsg}`,
  );
}
