import type {
  OpenAIProxyBenchmarkRoundRequest,
  OpenAIProxyBenchmarkRoundResponse,
  OpenAIProxyProbeRequest,
  OpenAIProxyProbeResponse,
  OpenAIProxyTestRequest,
  OpenAIProxyTestResponse,
} from "@/lib/openai-proxy-types";

import {
  fetch as undiciFetch,
  ProxyAgent,
  type RequestInit as UndiciRequestInit,
  type Response as UndiciResponse,
} from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const proxyDispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const FAIL_TEXT = "主人，我不行了";
const PASS_TEXT = "主人，快鞭策我吧";
const MODEL_CANDIDATES = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o", "gpt-5-mini", "gpt-5"];
// 推理模型（如 glm-5.x）常把小 token 预算全部耗在思考上，导致 content 为空被误判失败
const TEST_MAX_TOKENS = 256;
// 免费公益站高峰期排队 10~30 秒很常见，超时太短会把可用的站误判成超时
const CHAT_HEADER_TIMEOUT_MS = 45_000;
const STREAM_HEADER_TIMEOUT_MS = 60_000;
const PROBE_ATTEMPT_TIMEOUT_MS = 15_000;
const BENCH_TIMEOUT_MS = 30_000;
// 流式建立连接后若长时间无新数据也按超时处理，避免无限等待
const STREAM_IDLE_TIMEOUT_MS = 30_000;
// 整体测试最长耗时：候选模型链 + 瞬时错误重试的总上限
const TEST_OVERALL_DEADLINE_MS = 420_000;
// 循环测试逐模型扫描时的单次上限：只测一个模型，不需要候选链那么宽的预算
const SWEEP_TEST_DEADLINE_MS = 100_000;
const TRANSIENT_RETRY_DELAY_MS = 10_000;
// 候选链只在配置未指定模型时启用，避免死站点把一次测试拖得过久
const MAX_MODEL_CANDIDATE_TRIES = 4;
// 剩余时间不足这个预算时不再发起新一轮尝试（每个请求还会经历直连+代理两次超时）
const MIN_ATTEMPT_BUDGET_MS = 25_000;

type ModelTextResult = {
  ok: boolean;
  text: string;
  elapsedMs: number;
  error?: string;
};

type StreamTextResult = {
  ok: boolean;
  text: string;
  elapsedMs: number;
  firstTokenMs?: number;
  error?: string;
};

type TestResponseSource = "stream" | "chat" | "responses" | "messages";
type SourcedModelTextResult = ModelTextResult & {
  source: TestResponseSource;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanOneLineText(input: string, maxLen = 220): string {
  const singleLine = input.replace(/\s+/g, " ").trim();
  if (!singleLine) return "";
  if (singleLine.length <= maxLen) return singleLine;
  return `${singleLine.slice(0, maxLen)}...`;
}

function cleanMultilineText(input: string, maxLen = 2000): string {
  const normalized = input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen).trimEnd()}...`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function isLowSignalResponseText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;

  return [
    "ok",
    "okay",
    "ok.",
    "ok!",
    "ok？",
    "ok?",
    "好的",
    "收到",
    "收到。",
    "已收到",
    "明白",
    "在",
    "在的",
    "hi",
    "hello",
  ].includes(normalized);
}

function scoreResponseText(text: string): number {
  const normalized = text.trim();
  if (!normalized) return -1;

  let score = Math.min(normalized.length, 240);
  if (/[\u4e00-\u9fa5]/.test(normalized)) score += 40;
  if (!isLowSignalResponseText(normalized)) score += 120;
  if (/[，。！？,.!?]/.test(normalized)) score += 20;
  return score;
}

function pickBestTextResult(results: SourcedModelTextResult[]): SourcedModelTextResult | undefined {
  const successful = results.filter((item) => item.ok && item.text.trim());
  if (successful.length === 0) return undefined;

  return [...successful].sort((left, right) => {
    const scoreDiff = scoreResponseText(right.text) - scoreResponseText(left.text);
    if (scoreDiff !== 0) return scoreDiff;
    return left.elapsedMs - right.elapsedMs;
  })[0];
}

function normalizeBaseUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!/^https?:\/\//i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

function toOpenAIBaseUrl(raw: string): string {
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return "";

  const withoutEndpoint = normalized
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/messages$/i, "")
    .replace(/\/responses$/i, "")
    .replace(/\/response$/i, "")
    .replace(/\/completions$/i, "");

  if (/\/v\d+$/i.test(withoutEndpoint)) return withoutEndpoint;
  return `${withoutEndpoint}/v1`;
}

function cleanKey(raw: string): string {
  return raw.replace(/^Bearer\s+/i, "").trim();
}

function toReadableResponseText(content: unknown): string {
  if (typeof content === "string") return cleanMultilineText(content);
  if (!Array.isArray(content)) return "";

  const texts = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      const text = part.text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean);

  return cleanMultilineText(texts.join("\n"));
}

function extractChatMessageContent(payload: unknown): unknown {
  const firstChoice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  const message = isRecord(firstChoice) ? firstChoice.message : undefined;
  return isRecord(message) ? message.content : undefined;
}

// 推理模型的思考内容也算"接口确实能出话"，否则 content 为空时会把可用站点误判失败
function extractChatReasoningFallbackText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice)) return "";

  const message = firstChoice.message;
  if (!isRecord(message)) return "";

  const reasoning = message.reasoning_content;
  return typeof reasoning === "string" ? reasoning.trim() : "";
}

function extractResponsesText(payload: unknown): string {
  if (!isRecord(payload)) return "";

  const directText = payload.output_text;
  if (typeof directText === "string" && directText.trim()) {
    return cleanMultilineText(directText);
  }

  if (!Array.isArray(payload.output)) return "";

  const texts = payload.output
    .flatMap((item) => {
      if (!isRecord(item)) return [];

      const content = item.content;
      if (!Array.isArray(content)) return [];

      return content
        .map((part) => {
          if (!isRecord(part)) return "";
          if (typeof part.text === "string") return part.text;
          if (typeof part.refusal === "string") return part.refusal;
          return "";
        })
        .filter(Boolean);
    })
    .join("\n");

  return cleanMultilineText(texts);
}

function getErrorMessage(error: unknown): string {
  if (!isRecord(error)) return "";

  const directError = error.error;
  if (typeof directError === "string" && directError.trim()) return cleanOneLineText(directError, 260);

  const directMessage = error.message;
  if (typeof directMessage === "string" && directMessage.trim()) return cleanOneLineText(directMessage, 260);

  const nestedPaths = [
    ["error", "message"],
    ["response", "error", "message"],
    ["response", "data", "error", "message"],
    ["response", "body", "error", "message"],
    ["data", "error", "message"],
    ["body", "error", "message"],
    ["cause", "message"],
  ];

  for (const path of nestedPaths) {
    let current: unknown = error;
    for (const key of path) {
      if (!isRecord(current)) {
        current = "";
        break;
      }
      current = current[key];
    }
    if (typeof current === "string" && current.trim()) return cleanOneLineText(current, 260);
  }

  return "";
}

function makeErrorDetail(error: unknown): string {
  const baseError = isRecord(error) ? error : {};
  const status = typeof baseError.status === "number" ? baseError.status : undefined;
  const name = typeof baseError.name === "string" ? baseError.name : "";
  const raw = getErrorMessage(error);

  let detail = "测试异常，请检查地址或模型";
  if (status === 401 || status === 403) detail = "Key 无效或权限不足";
  else if (status === 404) detail = "地址可达，但聊天接口不存在";
  else if (typeof status === "number") detail = `请求失败（HTTP ${status}）`;
  else if (name === "AbortError" || /timeout|timed out/i.test(raw)) detail = "请求超时，请检查地址";
  else if (/network|fetch failed|connection|ENOTFOUND|ECONNREFUSED/i.test(raw)) {
    detail = "请求失败，请检查网络或地址";
  }

  if (!raw) return detail;
  if (detail.includes(raw)) return detail;
  return `${detail}；接口返回：${raw}`;
}

async function fetchWithTimeout(url: string, init: UndiciRequestInit, timeoutMs: number): Promise<UndiciResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    try {
      return await undiciFetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      // Only transport failures reach here; successful non-2xx responses stay untouched.
      // A direct-request timeout also falls back instead of spending another long OS-level timeout.
      if (!proxyDispatcher) {
        throw error;
      }

      const retryController = new AbortController();
      const retryTimer = setTimeout(() => retryController.abort(), timeoutMs);

      try {
        return await undiciFetch(url, {
          ...init,
          signal: retryController.signal,
          dispatcher: proxyDispatcher,
        });
      } finally {
        clearTimeout(retryTimer);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: UndiciRequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw {
      status: response.status,
      message: getErrorMessage(payload) || `HTTP ${response.status}`,
    };
  }

  return payload;
}

async function requestModelText(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
  timeoutMs: number = CHAT_HEADER_TIMEOUT_MS,
): Promise<ModelTextResult> {
  const startedAt = performance.now();

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
        }),
      },
      timeoutMs,
    );

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const elapsedMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        ok: false,
        text: "",
        elapsedMs,
        error: getErrorMessage(payload) || `HTTP ${response.status}`,
      };
    }

    if (isRecord(payload) && "error" in payload) {
      return {
        ok: false,
        text: "",
        elapsedMs,
        error: getErrorMessage(payload) || "模型不可用或上游渠道异常",
      };
    }

    const content = extractChatMessageContent(payload);
    let text = toReadableResponseText(content);

    if (!text && !content) {
      text = cleanMultilineText(extractChatReasoningFallbackText(payload));
    }

    if (text || content) {
      return { ok: true, text, elapsedMs };
    }

    return { ok: false, text: "", elapsedMs, error: "未返回消息内容" };
  } catch (error: unknown) {
    return {
      ok: false,
      text: "",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: makeErrorDetail(error),
    };
  }
}

async function requestResponsesText(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number = CHAT_HEADER_TIMEOUT_MS,
): Promise<ModelTextResult> {
  const startedAt = performance.now();

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/responses`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: prompt,
        }),
      },
      timeoutMs,
    );

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const elapsedMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        ok: false,
        text: "",
        elapsedMs,
        error: getErrorMessage(payload) || `HTTP ${response.status}`,
      };
    }

    if (isRecord(payload) && "error" in payload) {
      return {
        ok: false,
        text: "",
        elapsedMs,
        error: getErrorMessage(payload) || "模型不可用或上游渠道异常",
      };
    }

    const text = extractResponsesText(payload);
    if (text) {
      return { ok: true, text, elapsedMs };
    }

    return { ok: false, text: "", elapsedMs, error: "未返回消息内容" };
  } catch (error: unknown) {
    return {
      ok: false,
      text: "",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: makeErrorDetail(error),
    };
  }
}

async function requestMessagesText(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number = CHAT_HEADER_TIMEOUT_MS,
): Promise<ModelTextResult> {
  const startedAt = performance.now();

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: TEST_MAX_TOKENS,
        }),
      },
      timeoutMs,
    );

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const elapsedMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        ok: false,
        text: "",
        elapsedMs,
        error: getErrorMessage(payload) || `HTTP ${response.status}`,
      };
    }

    if (isRecord(payload) && "error" in payload) {
      return {
        ok: false,
        text: "",
        elapsedMs,
        error: getErrorMessage(payload) || "模型不可用或上游渠道异常",
      };
    }

    const text = isRecord(payload) ? toReadableResponseText(payload.content) : "";
    if (text) {
      return { ok: true, text, elapsedMs };
    }

    return { ok: false, text: "", elapsedMs, error: "未返回消息内容" };
  } catch (error: unknown) {
    return {
      ok: false,
      text: "",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: makeErrorDetail(error),
    };
  }
}

function shouldTryResponsesFallback(error: string): boolean {
  return /404|not found|不存在|does not exist|unsupported/i.test(error);
}

// 这些错误说明"换一个候选模型可能有用"，如渠道里没有该模型、接口路径不存在
// 超时也算（同站不同模型经常是不同渠道，主模型排队挂起时其他模型可能秒回）
const CANDIDATE_SWITCH_PATTERN =
  /404|not found|不存在|does not exist|unsupported|no available channel|无可用渠道|invalid\s*model|unknown\s*model|model_not_found|无权|权限不足|forbidden|not allowed|当前分组|超时|aborted|timed?[ _-]?out/i;

function shouldTryNextCandidate(error: string): boolean {
  return CANDIDATE_SWITCH_PATTERN.test(error);
}

// 瞬时错误（超时/限流/网络抖动）值得延迟后整体重试一次，不应直接判死
const TRANSIENT_ERROR_PATTERN =
  /超时|aborted|timed?[ _-]?out|rate.{0,3}limit|rpm|限流|fetch failed|connection|network|reset|econn|upstream|内部错误|internal error|服务器繁忙|请稍候|稍后再试|HTTP 50\d|未返回消息内容/i;

function isTransientTestError(error: string): boolean {
  if (!error) return false;
  return TRANSIENT_ERROR_PATTERN.test(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 多个候选都失败时，优先展示额度/鉴权这类决定性的原因，而不是候选模型的渠道噪声
function pickMostUsefulTestError(errors: string[]): string {
  const preferred = errors.find((item) => /额度|quota|余额|无效|unauthorized|api key|欠费|余额不足/i.test(item));
  return preferred || errors[0] || "";
}

function makeAbortLikeError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function requestModelTextBestEffort(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
  options?: {
    preferStream?: boolean;
    timeoutMs?: number;
  },
): Promise<ModelTextResult> {
  if (options?.preferStream) {
    const streamResponse = await requestModelTextStream(baseUrl, apiKey, model, prompt, maxTokens, options.timeoutMs);
    if (streamResponse.ok) {
      return {
        ok: true,
        text: streamResponse.text,
        elapsedMs: streamResponse.elapsedMs,
      };
    }

    const chatResponse = await requestModelText(baseUrl, apiKey, model, prompt, maxTokens, options.timeoutMs);
    if (chatResponse.ok) return chatResponse;

    const shouldTryResponses =
      chatResponse.error === "未返回消息内容" ||
      shouldTryResponsesFallback(streamResponse.error || "") ||
      shouldTryResponsesFallback(chatResponse.error || "");

    if (shouldTryResponses) {
      const responsesResponse = await requestResponsesText(baseUrl, apiKey, model, prompt, options.timeoutMs);
      if (responsesResponse.ok) return responsesResponse;

      return {
        ok: false,
        text: "",
        elapsedMs: streamResponse.elapsedMs,
        error:
          uniqueStrings([
            streamResponse.error || "",
            chatResponse.error || "",
            responsesResponse.error || "",
          ])[0] || "请求失败",
      };
    }

    return {
      ok: false,
      text: "",
      elapsedMs: streamResponse.elapsedMs,
      error: uniqueStrings([streamResponse.error || "", chatResponse.error || ""])[0] || "请求失败",
    };
  }

  const chatResponse = await requestModelText(baseUrl, apiKey, model, prompt, maxTokens, options?.timeoutMs);
  if (chatResponse.ok) return chatResponse;

  if (chatResponse.error === "未返回消息内容") {
    const streamResponse = await requestModelTextStream(baseUrl, apiKey, model, prompt, maxTokens, options?.timeoutMs);
    if (streamResponse.ok) {
      return {
        ok: true,
        text: streamResponse.text,
        elapsedMs: streamResponse.elapsedMs,
      };
    }

    const responsesResponse = await requestResponsesText(baseUrl, apiKey, model, prompt, options?.timeoutMs);
    if (responsesResponse.ok) return responsesResponse;

    return {
      ok: false,
      text: "",
      elapsedMs: chatResponse.elapsedMs,
      error:
        uniqueStrings([
          chatResponse.error || "",
          streamResponse.error || "",
          responsesResponse.error || "",
        ])[0] || "未返回消息内容",
    };
  }

  if (shouldTryResponsesFallback(chatResponse.error || "")) {
    const responsesResponse = await requestResponsesText(baseUrl, apiKey, model, prompt, options?.timeoutMs);
    if (responsesResponse.ok) return responsesResponse;

    return {
      ok: false,
      text: "",
      elapsedMs: chatResponse.elapsedMs,
      error: uniqueStrings([chatResponse.error || "", responsesResponse.error || ""])[0] || "请求失败",
    };
  }

  return chatResponse;
}

function extractStreamDeltaText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice)) return "";

  const delta = firstChoice.delta;
  if (!isRecord(delta)) return "";

  const directContent = delta.content;
  if (typeof directContent === "string") return directContent;

  if (Array.isArray(directContent)) {
    return directContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isRecord(part)) return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .join("");
  }

  const reasoningContent = delta.reasoning_content;
  if (typeof reasoningContent === "string") return reasoningContent;

  return "";
}

async function readStreamError(response: UndiciResponse): Promise<string> {
  try {
    const payload = (await response.clone().json()) as unknown;
    const message = getErrorMessage(payload);
    if (message) return message;
  } catch {
    // Ignore parse errors and fall back to raw text.
  }

  try {
    const rawText = await response.text();
    const cleaned = cleanOneLineText(rawText, 260);
    if (cleaned) return cleaned;
  } catch {
    // Ignore read errors and fall back to status code.
  }

  return `HTTP ${response.status}`;
}

async function requestModelTextStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
  timeoutMs: number = STREAM_HEADER_TIMEOUT_MS,
): Promise<StreamTextResult> {
  const startedAt = performance.now();

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          stream: true,
        }),
      },
      timeoutMs,
    );

    if (!response.ok) {
      return {
        ok: false,
        text: "",
        elapsedMs: Math.round(performance.now() - startedAt),
        error: await readStreamError(response),
      };
    }

    if (!response.body) {
      return {
        ok: false,
        text: "",
        elapsedMs: Math.round(performance.now() - startedAt),
        error: "流式响应不可用",
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let collectedText = "";
    let firstTokenMs: number | undefined;

    // 读流阶段如果上游长时间不发新数据，主动中断而不是无限等待
    const readWithIdleWatchdog = async () => {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            idleTimer = setTimeout(
              () => reject(makeAbortLikeError("流式响应空闲超时")),
              STREAM_IDLE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(idleTimer);
      }
    };

    while (true) {
      const { value, done } = await readWithIdleWatchdog();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const lines = chunk
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data:"));

        for (const line of lines) {
          const data = line.replace(/^data:\s*/, "");
          if (!data || data === "[DONE]") continue;

          try {
            const payload = JSON.parse(data) as unknown;
            const deltaText = extractStreamDeltaText(payload);
            if (!deltaText) continue;
            if (firstTokenMs === undefined) {
              firstTokenMs = Math.round(performance.now() - startedAt);
            }
            collectedText += deltaText;
          } catch {
            // Ignore malformed SSE events from relays and continue reading.
          }
        }
      }
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    const text = cleanMultilineText(collectedText.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim());
    if (!text) {
      return { ok: false, text: "", elapsedMs, error: "流式响应未返回可读内容" };
    }

    return {
      ok: true,
      text,
      elapsedMs,
      firstTokenMs,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      text: "",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: makeErrorDetail(error),
    };
  }
}

function chooseRecommendedModel(currentModel: string, models: string[]): string {
  const normalized = models.map((item) => item.trim()).filter(Boolean);
  const current = currentModel.trim();
  if (current && normalized.includes(current)) return current;

  for (const candidate of MODEL_CANDIDATES) {
    if (normalized.includes(candidate)) return candidate;
  }

  // 站点可能把画图/向量等非对话模型排在列表前面，推荐时优先挑对话类模型
  return normalized.find(isChatCapableModelName) || normalized[0] || "";
}

const NON_CHAT_MODEL_PATTERN =
  /embedding|\bembed|rerank|whisper|\btts\b|transcri|image|\bflux\b|stable-?diffusion|sdxl|\bvl\b|\bvlm\b|moderation|dall[- ]?e|\bvideo\b|\baudio\b/i;

function isChatCapableModelName(model: string): boolean {
  const normalized = model.trim();
  if (!normalized) return false;
  return !NON_CHAT_MODEL_PATTERN.test(normalized);
}

function extractModelsFromResponse(input: unknown): string[] {
  if (!isRecord(input) || !Array.isArray(input.data)) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of input.data) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
}

export async function runOpenAITest(input: OpenAIProxyTestRequest): Promise<OpenAIProxyTestResponse> {
  const baseUrl = toOpenAIBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const testedAt = new Date().toISOString();
  const prompt = "你是谁？请用一句简短中文回复，不要使用 Markdown。";
  // 循环测试扫描模式：单模型、少请求、不整体重试
  const sweepMode = input.sweep === true;
  const startedAt = performance.now();

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      result: {
        status: "error",
        message: FAIL_TEXT,
        detail: "地址或 Key 为空",
        testedAt,
      },
    };
  }

  const apiFormat = input.apiFormat || "auto";
  const requestedModel = input.model?.trim() || "";
  // 配置了模型就只测它；没配置时优先用探测到的站点模型，再退回内置候选链，
  // 避免写死 gpt-4o-mini 撞上渠道分组不提供的坑
  const chatCapableFallbacks = (input.fallbackModels || []).filter(isChatCapableModelName);
  const candidateModels = uniqueStrings([
    ...(requestedModel ? [requestedModel] : []),
    ...chatCapableFallbacks,
    ...(requestedModel ? [] : MODEL_CANDIDATES),
  ]).slice(0, MAX_MODEL_CANDIDATE_TRIES);

  async function runCandidateAttempts(model: string, budgetMs: number): Promise<SourcedModelTextResult[]> {
    const attempts: SourcedModelTextResult[] = [];
    const chatTimeoutMs = Math.min(CHAT_HEADER_TIMEOUT_MS, budgetMs);
    const streamTimeoutMs = Math.min(STREAM_HEADER_TIMEOUT_MS, budgetMs);

    if (apiFormat === "chat") {
      const chatResponse = await requestModelText(baseUrl, apiKey, model, prompt, TEST_MAX_TOKENS, chatTimeoutMs);
      attempts.push({ ...chatResponse, source: "chat" });
    } else if (apiFormat === "responses") {
      const responsesResponse = await requestResponsesText(baseUrl, apiKey, model, prompt, chatTimeoutMs);
      attempts.push({ ...responsesResponse, source: "responses" });
    } else if (apiFormat === "messages") {
      const messagesResponse = await requestMessagesText(baseUrl, apiKey, model, prompt, chatTimeoutMs);
      attempts.push({ ...messagesResponse, source: "messages" });
    } else {
      const streamResponse = await requestModelTextStream(baseUrl, apiKey, model, prompt, TEST_MAX_TOKENS, streamTimeoutMs);
      attempts.push({ ...streamResponse, source: "stream" });

      // 扫描模式下流式已经出话就不再补测，控制单个站点的请求密度
      const streamUsable = sweepMode
        ? streamResponse.ok
        : streamResponse.ok && !isLowSignalResponseText(streamResponse.text);

      if (!streamUsable) {
        const chatResponse = await requestModelText(baseUrl, apiKey, model, prompt, TEST_MAX_TOKENS, chatTimeoutMs);
        attempts.push({ ...chatResponse, source: "chat" });

        const shouldTryResponses =
          chatResponse.error === "未返回消息内容" ||
          shouldTryResponsesFallback(streamResponse.error || "") ||
          shouldTryResponsesFallback(chatResponse.error || "") ||
          (!sweepMode && (!chatResponse.ok || isLowSignalResponseText(chatResponse.text)));

        if (shouldTryResponses) {
          const responsesResponse = await requestResponsesText(baseUrl, apiKey, model, prompt, chatTimeoutMs);
          attempts.push({ ...responsesResponse, source: "responses" });
        }
      }
    }

    return attempts;
  }

  async function evaluateCandidates(): Promise<{
    best?: SourcedModelTextResult;
    winnerModel?: string;
    errors: string[];
    sawTransientError: boolean;
    attempts: SourcedModelTextResult[];
  }> {
    let lastAttempts: SourcedModelTextResult[] = [];
    const errors: string[] = [];
    let sawTransientError = false;

    for (let index = 0; index < candidateModels.length; index += 1) {
      const candidate = candidateModels[index];
      const budgetMs = deadlineAt - Date.now();
      if (budgetMs < MIN_ATTEMPT_BUDGET_MS) break;

      // 预算按剩余候选数均摊，避免主模型把整体时限吃光后其余候选全被跳过
      const remainingCandidates = candidateModels.length - index;
      const shareMs = Math.max(MIN_ATTEMPT_BUDGET_MS, Math.floor(budgetMs / remainingCandidates));

      const attempts = await runCandidateAttempts(candidate, shareMs);
      lastAttempts = attempts;

      const chainErrors = uniqueStrings(attempts.map((item) => item.error || ""));
      if (chainErrors[0]) {
        errors.push(chainErrors[0]);
        if (isTransientTestError(chainErrors[0])) sawTransientError = true;
      }

      const bestForCandidate = pickBestTextResult(attempts);
      if (bestForCandidate) {
        return { best: bestForCandidate, winnerModel: candidate, errors, sawTransientError, attempts };
      }

      const nextCandidateWorthTrying =
        index < candidateModels.length - 1 &&
        Date.now() < deadlineAt &&
        shouldTryNextCandidate(chainErrors.join("；"));
      if (!nextCandidateWorthTrying) break;
    }

    return { best: undefined, errors, sawTransientError, attempts: lastAttempts };
  }

  const deadlineAt = Date.now() + (sweepMode ? SWEEP_TEST_DEADLINE_MS : TEST_OVERALL_DEADLINE_MS);
  let evaluation = await evaluateCandidates();

  // 瞬时错误（超时/限流/网络抖动）不直接判死，延迟后整体再试一次；
  // 扫描模式把重试交给下一轮循环，单次请求不额外占用站点配额
  if (!sweepMode && !evaluation.best && evaluation.sawTransientError && Date.now() < deadlineAt) {
    await delay(TRANSIENT_RETRY_DELAY_MS);
    evaluation = await evaluateCandidates();
  }

  if (evaluation.best) {
    const bestResponse = evaluation.best;
    const sourceLabel =
      bestResponse.source === "stream"
        ? "流式"
        : bestResponse.source === "responses"
          ? "Responses"
          : bestResponse.source === "messages"
            ? "Messages"
            : "普通";
    return {
      ok: true,
      result: {
        status: "success",
        message: PASS_TEXT,
        detail: bestResponse.text ? `接口连通，已收到对“你是谁”的简短回复（${sourceLabel}）` : "返回消息正常",
        model: evaluation.winnerModel,
        responseText: bestResponse.text || undefined,
        responseSource: bestResponse.source,
        testedAt,
        elapsedMs: Math.round(performance.now() - startedAt),
      },
    };
  }

  const detail =
    pickMostUsefulTestError(uniqueStrings(evaluation.errors)) ||
    evaluation.attempts[0]?.error ||
    uniqueStrings(evaluation.attempts.map((item) => item.error || ""))[0] ||
    "未返回消息内容";

  return {
    ok: false,
    result: {
      status: "error",
      message: FAIL_TEXT,
      detail,
      model: requestedModel || undefined,
      testedAt,
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}

export async function runOpenAIProbe(input: OpenAIProxyProbeRequest): Promise<OpenAIProxyProbeResponse> {
  const baseUrl = toOpenAIBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const currentModel = input.currentModel?.trim() || "";
  const testedAt = new Date().toISOString();

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      result: {
        status: "error",
        supportedModels: [],
        detail: "地址或 Key 为空，无法探测模型",
        testedAt,
      },
    };
  }

  let modelsError = "";

  try {
    const payload = await fetchJsonWithTimeout(
      `${baseUrl}/models`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      10000,
    );
    const supportedModels = extractModelsFromResponse(payload);
    if (supportedModels.length > 0) {
      return {
        ok: true,
        result: {
          status: "success",
          supportedModels,
          recommendedModel: chooseRecommendedModel(currentModel, supportedModels) || undefined,
          detail: `读取 /models 成功，共识别 ${supportedModels.length} 个模型`,
          testedAt,
        },
      };
    }
    modelsError = "/models 可达，但未返回可识别模型";
  } catch (error: unknown) {
    modelsError = makeErrorDetail(error);
  }

  const supportedModels: string[] = [];
  let fallbackError = "";

  for (const candidate of MODEL_CANDIDATES) {
    const response = await requestModelTextBestEffort(baseUrl, apiKey, candidate, "你好，请回复：ok", 12, {
      timeoutMs: PROBE_ATTEMPT_TIMEOUT_MS,
    });
    if (response.ok) {
      supportedModels.push(candidate);
      continue;
    }
    if (!fallbackError && response.error) fallbackError = response.error;
  }

  if (supportedModels.length > 0) {
    return {
      ok: true,
      result: {
        status: "success",
        supportedModels,
        recommendedModel: chooseRecommendedModel(currentModel, supportedModels) || undefined,
        detail: `已通过候选模型试探识别 ${supportedModels.length} 个模型${modelsError ? `；/models：${modelsError}` : ""}`,
        testedAt,
      },
    };
  }

  return {
    ok: false,
    result: {
      status: "error",
      supportedModels: [],
      detail: modelsError ? `${modelsError}${fallbackError ? `；候选试探：${fallbackError}` : ""}` : fallbackError || "未探测到可用模型",
      testedAt,
    },
  };
}

export async function runOpenAIBenchmarkRound(
  input: OpenAIProxyBenchmarkRoundRequest,
): Promise<OpenAIProxyBenchmarkRoundResponse> {
  const baseUrl = toOpenAIBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const model = input.model.trim();

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      error: "地址或 Key 为空，无法执行模型测试",
    };
  }

  if (!model) {
    return {
      ok: false,
      error: "模型为空，无法执行模型测试",
    };
  }

  const streamedResponse = await requestModelTextStream(
    baseUrl,
    apiKey,
    model,
    "Reply with exactly OK. Do not add anything else.",
    8,
    BENCH_TIMEOUT_MS,
  );

  if (streamedResponse.ok) {
    return {
      ok: true,
      sample: {
        elapsedMs: streamedResponse.elapsedMs,
        firstTokenMs: streamedResponse.firstTokenMs,
      },
    };
  }

  const fallbackResponse = await requestModelTextBestEffort(
    baseUrl,
    apiKey,
    model,
    "Reply with exactly OK. Do not add anything else.",
    8,
    { timeoutMs: BENCH_TIMEOUT_MS },
  );

  if (fallbackResponse.ok) {
    return {
      ok: true,
      sample: {
        elapsedMs: fallbackResponse.elapsedMs,
      },
    };
  }

  return {
    ok: false,
    error: uniqueStrings([fallbackResponse.error || "", streamedResponse.error || ""])[0] || "测速失败，未返回可读内容",
  };
}
