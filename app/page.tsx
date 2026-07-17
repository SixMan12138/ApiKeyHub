"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaBan,
  FaBolt,
  FaCheckCircle,
  FaChevronDown,
  FaChevronUp,
  FaCompressArrowsAlt,
  FaCopy,
  FaDesktop,
  FaEdit,
  FaExchangeAlt,
  FaExpandArrowsAlt,
  FaFileExport,
  FaInfoCircle,
  FaKey,
  FaLink,
  FaMagic,
  FaMoon,
  FaPaste,
  FaQuestionCircle,
  FaSave,
  FaSearch,
  FaSpinner,
  FaSun,
  FaTag,
  FaTimesCircle,
  FaTrashAlt,
  FaVial
} from "react-icons/fa";
import { parseCcSwitchSqlProviders } from "@/lib/cc-switch-sql";
import type {
  OpenAIProxyApiFormat,
  OpenAIProxyBenchmarkRoundResponse,
  OpenAIProxyProbeResponse,
  OpenAIProxyTestResponse
} from "@/lib/openai-proxy-types";

type KeyConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat?: OpenAIProxyApiFormat;
  listStatus?: "success" | "failed" | "disabled";
  createdAt: string;
  sourceMeta?: {
    kind: "manual" | "cc-switch-provider" | "cc-switch-deeplink";
    ccSwitchApp?: CcSwitchApp;
  };
  probe?: {
    status: "success" | "error";
    supportedModels: string[];
    recommendedModel?: string;
    detail?: string;
    testedAt: string;
  };
  lastTest?: {
    status: "success" | "error";
    message: string;
    detail?: string;
    responseText?: string;
    responseSource?: "stream" | "chat" | "responses" | "messages";
    testedAt: string;
  };
  benchmarks?: Record<string, FinishedModelBenchmarkResult>;
};

type FormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat: OpenAIProxyApiFormat;
};

type ExportType = "md" | "txt";
type TestStatus = "idle" | "pending" | "success" | "error";
type NoticeTone = "success" | "error" | "info";
type NoticeState = {
  message: string;
  tone: NoticeTone;
};
type CcSwitchApp = "claude" | "codex" | "gemini" | "opencode" | "openclaw";
type ThemeMode = "system" | "light" | "dark";

type TestResult = {
  status: TestStatus;
  message: string;
  detail?: string;
  responseText?: string;
  responseSource?: "stream" | "chat" | "responses" | "messages";
  testedAt?: string;
};
type FinishedTestResult = NonNullable<KeyConfig["lastTest"]>;
type ProbeResult = {
  status: TestStatus;
  supportedModels: string[];
  recommendedModel?: string;
  detail?: string;
  testedAt?: string;
};
type FinishedProbeResult = NonNullable<KeyConfig["probe"]>;
type BenchmarkRoundDetail = {
  round: number;
  ok: boolean;
  elapsedMs?: number;
  firstTokenMs?: number;
  error?: string;
};
type ModelBenchmarkResult = {
  status: TestStatus;
  model: string;
  tags: string[];
  speed?: {
    rounds: number;
    medianMs: number;
    avgMs: number;
    successRate: number;
    stabilityMs: number;
    samplesMs: number[];
    firstTokenMedianMs?: number;
    firstTokenAvgMs?: number;
    firstTokenSamplesMs?: number[];
    roundDetails?: BenchmarkRoundDetail[];
  };
  detail?: string;
  testedAt?: string;
};
type FinishedModelBenchmarkResult = ModelBenchmarkResult & {
  status: "success" | "error";
  testedAt: string;
};
type BenchmarkBatchProgress = {
  configId: string;
  models: string[];
  rounds: number;
  done: number;
  total: number;
  skipped: number;
  currentModel?: string;
  currentRound?: number;
};
type BenchmarkSummary = {
  configId: string;
  rounds: number;
  models: string[];
  totalModels: number;
  successModels: number;
  fastestModel?: string;
  fastestMedianMs?: number;
  quickestFirstTokenModel?: string;
  quickestFirstTokenMs?: number;
  mostStableModel?: string;
  stabilityMs?: number;
  recommendedModel?: string;
  finishedAt: string;
};
type ParsedConfig = FormState & {
  sourceMeta?: KeyConfig["sourceMeta"];
};
type CcSwitchAction = {
  label: string;
  onClick: () => void;
  tone?: "default" | "accent";
};

const THEME_STORAGE_KEY = "ai-key-vault-theme-v1";
const CLIENT_ID_RANDOM_BYTE_COUNT = 16;
const NOTICE_DURATION_MS = 3000;
const NOTICE_ERROR_KEYWORDS = ["失败", "错误", "暂无", "没有", "不能为空", "未识别", "请先", "重试"];
const NOTICE_SUCCESS_KEYWORDS = ["成功", "完成", "已", "通过"];
const PASS_TEXT = "主人，快鞭策我吧";
const FAIL_TEXT = "主人，我不行了";
const DEFAULT_BENCHMARK_ROUNDS = 2;
const API_FORMAT_OPTIONS: { value: OpenAIProxyApiFormat; label: string; hint: string }[] = [
  { value: "auto", label: "自动兼容", hint: "优先 Chat Completions，必要时 fallback 到 Responses" },
  { value: "chat", label: "/v1/chat/completions", hint: "OpenAI 兼容中转站最常见" },
  { value: "responses", label: "/v1/responses", hint: "OpenAI Responses API" },
  { value: "messages", label: "/v1/messages", hint: "Claude / Anthropic Messages 兼容格式" }
];
function normalizeApiFormat(input: unknown): OpenAIProxyApiFormat {
  if (input === "chat" || input === "responses" || input === "messages" || input === "auto") return input;
  return "auto";
}
type ModelCategory = "gpt" | "claude" | "glm" | "deepseek" | "gemini" | "grok" | "mimo" | "other";
type ModelCategoryFilter = ModelCategory | "all";
const MODEL_CATEGORY_RULES: { category: ModelCategory; patterns: RegExp[] }[] = [
  { category: "gpt", patterns: [/\bgpt\b/i, /\bo1\b/i, /\bo3\b/i, /\bo4\b/i, /openai/i, /chatgpt/i] },
  { category: "claude", patterns: [/claude/i, /anthropic/i] },
  { category: "glm", patterns: [/\bglm\b/i, /chatglm/i, /zhipu/i] },
  { category: "deepseek", patterns: [/deepseek/i] },
  { category: "gemini", patterns: [/gemini/i] },
  { category: "grok", patterns: [/grok/i, /\bxai\b/i] },
  { category: "mimo", patterns: [/mimo/i] }
];
const MODEL_CATEGORY_OPTIONS: { value: ModelCategoryFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "gpt", label: "GPT" },
  { value: "claude", label: "Claude" },
  { value: "glm", label: "GLM" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "gemini", label: "Gemini" },
  { value: "grok", label: "Grok" },
  { value: "mimo", label: "Mimo" },
  { value: "other", label: "其他" }
];
function inferModelCategory(model: string): ModelCategory {
  const m = model.trim();
  if (!m) return "other";
  const hit = MODEL_CATEGORY_RULES.find((r) => r.patterns.some((p) => p.test(m)));
  return hit ? hit.category : "other";
}
const MODEL_TAG_RULES: { tag: string; patterns: RegExp[] }[] = [
  { tag: "image", patterns: [/\bimage\b/i, /\bvision\b/i, /\bvl\b/i, /\bflux\b/i, /\bsd(?:xl)?\b/i, /stable[- ]?diffusion/i] },
  { tag: "embedding", patterns: [/embedding/i, /\bembed\b/i, /text-embedding/i, /\bbge\b/i, /\bmxbai\b/i, /\be5\b/i] },
  { tag: "thinking", patterns: [/thinking/i, /\breason/i, /\bthink\b/i, /\bo1\b/i, /\bo3\b/i, /\bo4\b/i, /\br1\b/i] },
  { tag: "coding", patterns: [/\bcoder\b/i, /\bcoding\b/i, /\bcode\b/i, /devstral/i] },
  { tag: "audio", patterns: [/\baudio\b/i, /\bspeech\b/i, /\btts\b/i, /whisper/i, /transcri/i] },
  { tag: "rerank", patterns: [/rerank/i, /reranker/i] },
  { tag: "moderation", patterns: [/moderation/i] }
];
const CC_SWITCH_APPS: { value: CcSwitchApp; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
  { value: "opencode", label: "OpenCode" },
  { value: "openclaw", label: "OpenClaw" }
];

const labelClass = "mb-1.5 mt-2.5 block text-sm font-semibold text-zinc-700 dark:text-zinc-200";
const inputClass =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition hover:border-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:focus:border-zinc-600 dark:focus:ring-emerald-900/40";
const btnBase =
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
const btnPrimary = `${btnBase} border-transparent bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-600/20 hover:from-emerald-600 hover:to-teal-700 dark:from-emerald-400 dark:to-teal-500 dark:text-emerald-950 dark:shadow-emerald-500/20`;
const btnGhost = `${btnBase} border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:border-zinc-600`;
const topBtnBase =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
const topBtnPrimary = `${topBtnBase} border-transparent bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-600/20 hover:from-emerald-600 hover:to-teal-700 dark:from-emerald-400 dark:to-teal-500 dark:text-emerald-950`;
const topBtnGhost = `${topBtnBase} border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:border-zinc-600`;
const topBtnDanger = `${topBtnBase} border-red-200 bg-white text-red-500 hover:border-red-700 hover:bg-red-700 hover:text-white dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-400 dark:hover:border-red-700`;
const smallBtn =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-700";
const smallDangerBtn =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-700 hover:bg-red-700 hover:text-white dark:border-red-900/60 dark:bg-zinc-800 dark:text-red-400";
const iconCopyBtn =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-zinc-700 dark:hover:text-zinc-200";
const endpointHintText = "地址只填域名也可以，系统会自动兼容 /v1、/chat/completions、/responses、/messages；API 格式可单独选择，自动兼容会优先 Chat Completions，再按需尝试 Responses。";
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function createClientId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();

  if (typeof webCrypto?.getRandomValues === "function") {
    const randomBytes = webCrypto.getRandomValues(new Uint8Array(CLIENT_ID_RANDOM_BYTE_COUNT));
    const randomPart = Array.from(randomBytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `cfg-${Date.now().toString(36)}-${randomPart}`;
  }

  return `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function inferNoticeTone(message: string): NoticeTone {
  if (message.startsWith("开始")) return "info";

  const toneMessage = message.replaceAll("失败列表", "列表");
  if (NOTICE_ERROR_KEYWORDS.some((keyword) => toneMessage.includes(keyword))) return "error";
  if (NOTICE_SUCCESS_KEYWORDS.some((keyword) => toneMessage.includes(keyword))) return "success";
  return "info";
}

function parseConfigTimestamp(value?: string): number | null {
  if (!value) return null;

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareConfigsByTestedAtDesc(left: KeyConfig, right: KeyConfig): number {
  const leftTestedAt = parseConfigTimestamp(left.lastTest?.testedAt);
  const rightTestedAt = parseConfigTimestamp(right.lastTest?.testedAt);

  if (leftTestedAt !== null || rightTestedAt !== null) {
    if (leftTestedAt === null) return 1;
    if (rightTestedAt === null) return -1;
    if (leftTestedAt !== rightTestedAt) return rightTestedAt - leftTestedAt;
  }

  const leftCreatedAt = parseConfigTimestamp(left.createdAt) || 0;
  const rightCreatedAt = parseConfigTimestamp(right.createdAt) || 0;
  return rightCreatedAt - leftCreatedAt;
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
    .replace(/\/responses$/i, "")
    .replace(/\/response$/i, "")
    .replace(/\/completions$/i, "");

  if (/\/v\d+$/i.test(withoutEndpoint)) return withoutEndpoint;
  return `${withoutEndpoint}/v1`;
}

function cleanKey(raw: string): string {
  return raw.replace(/^Bearer\s+/i, "").trim();
}

function toMaskedKey(key: string): string {
  if (key.length <= 10) return "******";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function makeDefaultName(index: number): string {
  return `配置${index}`;
}

function isCcSwitchApp(value: string): value is CcSwitchApp {
  return ["claude", "codex", "gemini", "opencode", "openclaw"].includes(value);
}

function sanitizeFilename(input: string): string {
  return input.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function collectGlobalMatches(text: string, regex: RegExp, group = 0): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(regex)) {
    const value = (match[group] || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

function normalizeParsedFieldValue(input: string): string {
  return input
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .replace(/[;,]+$/, "")
    .trim();
}

function normalizeParsedModelValue(input: string): string {
  return normalizeParsedFieldValue(input).replace(/\s+/g, "");
}

type StructuredFieldRule = {
  field: keyof FormState;
  labelPattern: string;
  normalize: (value: string) => string;
};

const STRUCTURED_FIELD_RULES: StructuredFieldRule[] = [
  {
    field: "name",
    labelPattern: "(?:name|名称|配置名|别名|标签|title)",
    normalize: normalizeParsedFieldValue
  },
  {
    field: "baseUrl",
    labelPattern:
      "(?:base\\s*url|base_url|base-url|api\\s*base|api_base|api-base|api\\s*url|api_url|api-url|endpoint|url|地址|接口地址|请求地址|服务地址|域名|host)",
    normalize: (value) => normalizeBaseUrl(normalizeParsedFieldValue(value))
  },
  {
    field: "apiKey",
    labelPattern: "(?:api\\s*key|api_key|api-key|access[_-]?token|access\\s*token|token|key|密钥|令牌|凭证)",
    normalize: (value) => cleanKey(normalizeParsedFieldValue(value))
  },
  {
    field: "model",
    labelPattern: "(?:default\\s*model|default_model|default-model|model\\s*name|model_name|model-name|model|模型|默认模型)",
    normalize: normalizeParsedModelValue
  }
];

const STRUCTURED_FIELD_SEPARATOR_PATTERN = "(?::|：|=|＝|=>|->)";
const ANY_STRUCTURED_LABEL_PATTERN = STRUCTURED_FIELD_RULES.map((rule) => rule.labelPattern).join("|");
const DECORATIVE_LINE_RE = /^\s*(?:=+|-{3,}|_{3,}|~{3,})\s*$/;
const INDEX_ONLY_LINE_RE = /^\s*(?:\[\s*\d+\s*\]|\(\s*\d+\s*\)|（\s*\d+\s*）|#\s*\d+|(?:item|配置)\s*\d+|\d+[.)、])\s*$/i;
const INLINE_FIELD_BREAK_RE = new RegExp(
  `([^\\n])\\s+(?=(?:${ANY_STRUCTURED_LABEL_PATTERN})\\s*(?:${STRUCTURED_FIELD_SEPARATOR_PATTERN}))`,
  "gi"
);

function hasAnyParsedField(item: Partial<ParsedConfig>): boolean {
  return Boolean(item.name || item.baseUrl || item.apiKey || item.model);
}

function hasCoreParsedField(item: Partial<ParsedConfig>): boolean {
  return Boolean(item.baseUrl || item.apiKey || item.model);
}

function mergeParsedConfig(base: Partial<ParsedConfig>, incoming: Partial<ParsedConfig>): Partial<ParsedConfig> {
  return {
    name: base.name || incoming.name,
    baseUrl: base.baseUrl || incoming.baseUrl,
    apiKey: base.apiKey || incoming.apiKey,
    model: base.model || incoming.model,
    sourceMeta: incoming.sourceMeta || base.sourceMeta
  };
}

function shouldStartNewParsedConfig(current: Partial<ParsedConfig>, incoming: Partial<ParsedConfig>): boolean {
  if (!hasAnyParsedField(current) || !hasAnyParsedField(incoming)) return false;
  if (incoming.name && current.name) return true;
  if (incoming.name && hasCoreParsedField(current)) return true;
  if (incoming.baseUrl && current.baseUrl) return true;
  if (incoming.apiKey && current.apiKey) return true;
  if (incoming.model && current.model && (current.baseUrl || current.apiKey)) return true;
  return false;
}

function preprocessStructuredText(input: string): string {
  return input.replace(/\r\n?/g, "\n").replace(INLINE_FIELD_BREAK_RE, "$1\n");
}

function parseStructuredFieldLine(line: string): Partial<ParsedConfig> {
  const normalized = line
    .trim()
    .replace(/^[>|]+/, "")
    .replace(/^[\s\-*•]+/, "")
    .trim();

  if (!normalized || DECORATIVE_LINE_RE.test(normalized) || INDEX_ONLY_LINE_RE.test(normalized)) return {};

  for (const rule of STRUCTURED_FIELD_RULES) {
    const match = normalized.match(
      new RegExp(
        `^\\s*(?:\\[\\s*\\d+\\s*\\]|\\(\\s*\\d+\\s*\\)|（\\s*\\d+\\s*）|#\\s*\\d+\\s*|\\d+[.)、]\\s*)?${rule.labelPattern}\\s*(?:${STRUCTURED_FIELD_SEPARATOR_PATTERN})\\s*(.+?)\\s*$`,
        "i"
      )
    );
    if (!match?.[1]) continue;

    return {
      [rule.field]: rule.normalize(match[1])
    } as Partial<ParsedConfig>;
  }

  return {};
}

function parseStructuredSegment(input: string): Partial<ParsedConfig> {
  const text = preprocessStructuredText(input).trim();
  if (!text) return {};

  let out: Partial<ParsedConfig> = {};
  for (const line of text.split("\n")) {
    const parsedLine = parseStructuredFieldLine(line);
    if (!hasAnyParsedField(parsedLine)) continue;
    out = mergeParsedConfig(out, parsedLine);
  }

  return out;
}

function parseSingleSegment(input: string): Partial<ParsedConfig> {
  const text = input.trim();
  if (!text) return {};

  const out: Partial<ParsedConfig> = parseStructuredSegment(text);

  const keyPatterns = [
    /api[_-]?key["'\s:：=＝]+([A-Za-z0-9._-]{10,})/i,
    /bearer\s+([A-Za-z0-9._-]{10,})/i,
    /key["'\s:：=＝]+([A-Za-z0-9._-]{10,})/i
  ];
  for (const p of keyPatterns) {
    const m = text.match(p);
    if (m?.[1]) {
      out.apiKey = cleanKey(m[1]);
      break;
    }
  }
  if (!out.apiKey) {
    const fallback = text.match(/(?:sk|rk|ak|pk)[-_][A-Za-z0-9._-]{8,}/i);
    if (fallback?.[0]) out.apiKey = cleanKey(fallback[0]);
  }

  const urlMatch = text.match(/https?:\/\/[^\s"'`]+/i);
  if (urlMatch?.[0]) {
    out.baseUrl = normalizeBaseUrl(urlMatch[0]);
  } else {
    const hostLike = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'`]*)?/i);
    if (hostLike?.[0]) out.baseUrl = normalizeBaseUrl(hostLike[0]);
  }

  const modelMatch = text.match(
    /(?:^|\n|\r|[,{])\s*(?:model|model_name|modelName|default_model|defaultModel|模型)\s*["']?\s*[:：=＝]\s*["'`]?([^"'`\n\r,}]+)["'`]?/i
  );
  if (modelMatch?.[1]) out.model = normalizeParsedModelValue(modelMatch[1]);

  return out;
}

function parseObjectConfig(item: unknown): Partial<FormState> {
  if (!item || typeof item !== "object") return {};

  const obj = item as Record<string, unknown>;
  const rawBaseUrl =
    obj.baseUrl ?? obj.base_url ?? obj.url ?? obj.endpoint ?? obj.host ?? obj.apiBase ?? obj.api_base;
  const rawApiKey =
    obj.apiKey ??
    obj.api_key ??
    obj.key ??
    obj.token ??
    obj.access_token ??
    obj.authorization ??
    obj.auth;
  const rawModel = obj.model ?? obj.model_name ?? obj.modelName ?? obj.default_model ?? obj.defaultModel;

  return {
    name: "",
    baseUrl: rawBaseUrl ? normalizeBaseUrl(String(rawBaseUrl)) : "",
    apiKey: rawApiKey ? cleanKey(String(rawApiKey)) : "",
    model: rawModel ? normalizeParsedModelValue(String(rawModel)) : ""
  };
}

function parseCcSwitchDeepLink(input: string): Partial<ParsedConfig> | null {
  const text = input.trim();
  if (!/^ccswitch:\/\/v1\/import\?/i.test(text)) return null;

  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "ccswitch:") return null;
    if (parsed.hostname !== "v1") return null;
    if (parsed.pathname !== "/import") return null;

    const resource = parsed.searchParams.get("resource");
    if (resource !== "provider") return null;

    const app = (parsed.searchParams.get("app") || "").trim().toLowerCase();
    const endpoint = (parsed.searchParams.get("endpoint") || "")
      .split(",")
      .map((value) => value.trim())
      .find(Boolean);

    return {
      name: (parsed.searchParams.get("name") || "").trim(),
      baseUrl: normalizeBaseUrl(endpoint || ""),
      apiKey: cleanKey(parsed.searchParams.get("apiKey") || ""),
      model: (parsed.searchParams.get("model") || "").trim(),
      sourceMeta: {
        kind: "cc-switch-deeplink",
        ccSwitchApp: isCcSwitchApp(app) ? app : undefined
      }
    };
  } catch {
    return null;
  }
}

function parseCcSwitchProviderObject(item: unknown): Partial<ParsedConfig> {
  if (!isRecord(item)) return {};

  const resource = typeof item.resource === "string" ? item.resource.trim().toLowerCase() : "";
  const app = typeof item.app === "string" ? item.app.trim().toLowerCase() : "";
  const endpointValue = typeof item.endpoint === "string" ? item.endpoint : "";
  const endpoint = endpointValue
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);

  const looksLikeProvider =
    resource === "provider" ||
    Boolean(
      typeof item.name === "string" &&
        (typeof item.endpoint === "string" || typeof item.apiKey === "string" || typeof item.model === "string")
    );

  if (!looksLikeProvider) return {};

  return {
    name: typeof item.name === "string" ? item.name.trim() : "",
    baseUrl: normalizeBaseUrl(endpoint || ""),
    apiKey: cleanKey(typeof item.apiKey === "string" ? item.apiKey : ""),
    model: typeof item.model === "string" ? item.model.trim() : "",
    sourceMeta: {
      kind: "cc-switch-provider",
      ccSwitchApp: isCcSwitchApp(app) ? app : undefined
    }
  };
}

function parseCcSwitchTextBlock(input: string): Partial<ParsedConfig> {
  const text = input.trim();
  if (!text) return {};

  const appMatch = text.match(/(?:^|\n)\s*app\s*[:：=＝]\s*([a-z-]+)/i);
  const nameMatch = text.match(/(?:^|\n)\s*name\s*[:：=＝]\s*(.+?)(?:\n|$)/i);
  const endpointMatch = text.match(/(?:^|\n)\s*endpoint\s*[:：=＝]\s*(.+?)(?:\n|$)/i);
  const keyMatch = text.match(/(?:^|\n)\s*apiKey\s*[:：=＝]\s*(.+?)(?:\n|$)/i);
  const modelMatch = text.match(/(?:^|\n)\s*(?:model|模型)\s*[:：=＝]\s*(.+?)(?:\n|$)/i);

  if (!appMatch && !endpointMatch && !keyMatch && !modelMatch) return {};

  const app = (appMatch?.[1] || "").trim().toLowerCase();
  const endpoint = (endpointMatch?.[1] || "")
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);

  return {
    name: (nameMatch?.[1] || "").trim(),
    baseUrl: normalizeBaseUrl(endpoint || ""),
    apiKey: cleanKey(keyMatch?.[1] || ""),
    model: normalizeParsedModelValue(modelMatch?.[1] || ""),
    sourceMeta: {
      kind: "cc-switch-provider",
      ccSwitchApp: isCcSwitchApp(app) ? app : undefined
    }
  };
}

function finalizeParsed(items: Partial<ParsedConfig>[], startIndex: number): ParsedConfig[] {
  const cleaned = items
    .map((item) => ({
      name: (item.name || "").trim(),
      baseUrl: normalizeBaseUrl(item.baseUrl || ""),
      apiKey: cleanKey(item.apiKey || ""),
      model: (item.model || "").trim(),
      apiFormat: normalizeApiFormat(item.apiFormat),
      sourceMeta: item.sourceMeta
    }))
    .filter((item) => item.baseUrl || item.apiKey || item.model);

  const deduped: ParsedConfig[] = [];
  const seen = new Set<string>();

  for (const item of cleaned) {
    const key = `${item.baseUrl}__${item.apiKey}__${item.model}__${item.apiFormat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.map((item, index) => ({
    ...item,
    name: item.name || makeDefaultName(startIndex + index)
  }));
}

function createKeyConfigsFromParsed(items: ParsedConfig[]): KeyConfig[] {
  return items.map((item) => ({
    id: createClientId(),
    name: item.name,
    baseUrl: item.baseUrl,
    apiKey: item.apiKey,
    model: item.model,
    apiFormat: item.apiFormat || "auto",
    listStatus: "success",
    createdAt: new Date().toISOString(),
    sourceMeta: item.sourceMeta || { kind: "manual" }
  }));
}

function parsePastedConfigs(input: string, startIndex: number): ParsedConfig[] {
  const text = input.trim();
  if (!text) return [];

  const deepLinks = collectGlobalMatches(text, /ccswitch:\/\/v1\/import\?[^\s"'`]+/gi)
    .map(parseCcSwitchDeepLink)
    .filter((item): item is Partial<ParsedConfig> => Boolean(item));
  const fromDeepLinks = finalizeParsed(deepLinks, startIndex);
  if (fromDeepLinks.length > 0) return fromDeepLinks;

  const fromCcSwitchSql = finalizeParsed(
    parseCcSwitchSqlProviders(text).map((item) => ({
      name: item.name,
      baseUrl: item.baseUrl,
      apiKey: item.apiKey,
      model: item.model,
      sourceMeta: {
        kind: "cc-switch-provider" as const,
        ccSwitchApp: item.appType
      }
    })),
    startIndex
  );
  if (fromCcSwitchSql.length > 0) return fromCcSwitchSql;

  try {
    const parsed = JSON.parse(text) as unknown;
    let source: unknown[] = [];

    if (Array.isArray(parsed)) {
      source = parsed;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.configs)) source = obj.configs;
      else if (Array.isArray(obj.items)) source = obj.items;
      else source = [obj];
    }

    const fromCcSwitchJson = finalizeParsed(source.map(parseCcSwitchProviderObject), startIndex);
    if (fromCcSwitchJson.length > 0) return fromCcSwitchJson;

    const fromJson = finalizeParsed(source.map(parseObjectConfig), startIndex);
    if (fromJson.length > 0) return fromJson;
  } catch {
    // Ignore JSON parse errors and continue with text parsing.
  }

  const normalizedText = preprocessStructuredText(text);
  const structuredItems: Partial<ParsedConfig>[] = [];
  let current: Partial<ParsedConfig> = {};

  for (const rawLine of normalizedText.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      if (hasCoreParsedField(current)) {
        structuredItems.push(current);
        current = {};
      }
      continue;
    }

    if (DECORATIVE_LINE_RE.test(line)) continue;

    if (INDEX_ONLY_LINE_RE.test(line)) {
      if (hasAnyParsedField(current)) {
        structuredItems.push(current);
        current = {};
      }
      continue;
    }

    const parsedLine = parseSingleSegment(line);
    if (!hasAnyParsedField(parsedLine)) continue;

    if (shouldStartNewParsedConfig(current, parsedLine)) {
      structuredItems.push(current);
      current = {};
    }

    current = mergeParsedConfig(current, parsedLine);
  }

  if (hasAnyParsedField(current)) {
    structuredItems.push(current);
  }

  const fromStructuredText = finalizeParsed(structuredItems, startIndex);
  if (fromStructuredText.length > 0) return fromStructuredText;

  const blocks = normalizedText
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (blocks.length > 1) {
    const fromCcSwitchBlocks = finalizeParsed(blocks.map(parseCcSwitchTextBlock), startIndex);
    if (fromCcSwitchBlocks.length > 0) return fromCcSwitchBlocks;

    const fromBlocks = finalizeParsed(blocks.map(parseSingleSegment), startIndex);
    if (fromBlocks.length > 0) return fromBlocks;
  }

  const singleCcSwitchBlock = finalizeParsed([parseCcSwitchTextBlock(text)], startIndex);
  if (singleCcSwitchBlock.length > 0) return singleCcSwitchBlock;

  const globalUrls = collectGlobalMatches(text, /https?:\/\/[^\s"'`]+/gi).map(normalizeBaseUrl);
  const globalKeys = [
    ...collectGlobalMatches(text, /api[_-]?key["'\s:：=＝]+([A-Za-z0-9._-]{10,})/gi, 1),
    ...collectGlobalMatches(text, /bearer\s+([A-Za-z0-9._-]{10,})/gi, 1),
    ...collectGlobalMatches(text, /(?:sk|rk|ak|pk)[-_][A-Za-z0-9._-]{8,}/gi)
  ].map(cleanKey);
  const globalModels = [
    ...collectGlobalMatches(
      text,
      /(?:^|\n|\r|[,{])\s*(?:model|model_name|modelName|default_model|defaultModel|模型)\s*["']?\s*[:：=＝]\s*["'`]?([^"'`\n\r,}]+)["'`]?/gi,
      1
    )
  ].map(normalizeParsedModelValue);

  const paired: Partial<FormState>[] = [];
  const pairCount = Math.max(globalUrls.length, globalKeys.length, globalModels.length);
  for (let i = 0; i < pairCount; i += 1) {
    const baseUrl = globalUrls[i] || globalUrls[0] || "";
    const apiKey = globalKeys[i] || globalKeys[0] || "";
    const model = globalModels[i] || globalModels[0] || "";
    if (baseUrl || apiKey || model) paired.push({ baseUrl, apiKey, model });
  }

  const fromGlobal = finalizeParsed(paired, startIndex);
  if (fromGlobal.length > 0) return fromGlobal;

  const single = finalizeParsed([parseSingleSegment(text)], startIndex);
  return single;
}

function formatConfig(item: KeyConfig, type: ExportType): string {
  if (type === "md") {
    return [
      `## ${item.name}`,
      "",
      `- 地址: ${item.baseUrl}`,
      `- Key: ${item.apiKey}`,
      `- 模型: ${item.model || "(未设置)"}`,
      `- API 格式: ${API_FORMAT_OPTIONS.find((option) => option.value === (item.apiFormat || "auto"))?.label || "自动兼容"}`,
      `- 创建时间: ${item.createdAt}`,
      ""
    ].join("\n");
  }
  return [
    `名称: ${item.name}`,
    `地址: ${item.baseUrl}`,
    `Key: ${item.apiKey}`,
    `模型: ${item.model || "(未设置)"}`,
    `API 格式: ${API_FORMAT_OPTIONS.find((option) => option.value === (item.apiFormat || "auto"))?.label || "自动兼容"}`,
    `创建时间: ${item.createdAt}`,
    ""
  ].join("\n");
}

function formatAll(configs: KeyConfig[], type: ExportType): string {
  if (configs.length === 0) return "";
  if (type === "md") {
    return [
      "# AI API Key 配置导出",
      "",
      ...configs.map((item) => formatConfig(item, type))
    ].join("\n");
  }
  return [
    "AI API Key 配置导出",
    "====================",
    "",
    ...configs.map((item, idx) => [`[${idx + 1}]`, formatConfig(item, type)].join("\n"))
  ].join("\n");
}

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

function safeDateToIso(input: unknown): string {
  if (typeof input !== "string") return "";
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeBenchmarkRoundDetail(input: unknown, index = 0): BenchmarkRoundDetail | undefined {
  if (!isRecord(input)) return undefined;

  const roundRaw = typeof input.round === "number" && Number.isFinite(input.round) ? Math.round(input.round) : index + 1;
  const ok = typeof input.ok === "boolean" ? input.ok : typeof input.elapsedMs === "number" && Number.isFinite(input.elapsedMs);
  const elapsedMs =
    typeof input.elapsedMs === "number" && Number.isFinite(input.elapsedMs) ? Math.max(0, Math.round(input.elapsedMs)) : undefined;
  const firstTokenMs =
    typeof input.firstTokenMs === "number" && Number.isFinite(input.firstTokenMs)
      ? Math.max(0, Math.round(input.firstTokenMs))
      : undefined;
  const error = typeof input.error === "string" && input.error.trim() ? cleanOneLineText(input.error, 260) : undefined;

  return {
    round: Math.max(1, roundRaw),
    ok,
    elapsedMs,
    firstTokenMs,
    error
  };
}

function buildRoundDetailsFromSamples(
  rounds: number,
  elapsedSamples: number[],
  firstTokenSamples: number[] = [],
  errors: string[] = []
): BenchmarkRoundDetail[] {
  const out: BenchmarkRoundDetail[] = [];

  for (let index = 0; index < rounds; index += 1) {
    const elapsedMs = elapsedSamples[index];
    const firstTokenMs = firstTokenSamples[index];
    const error = errors[index];

    out.push({
      round: index + 1,
      ok: typeof elapsedMs === "number",
      elapsedMs,
      firstTokenMs: typeof firstTokenMs === "number" ? firstTokenMs : undefined,
      error: typeof elapsedMs === "number" ? undefined : error
    });
  }

  return out;
}

function getBenchmarkRoundDetails(result?: ModelBenchmarkResult): BenchmarkRoundDetail[] {
  if (!result?.speed) return [];

  if (Array.isArray(result.speed.roundDetails) && result.speed.roundDetails.length > 0) {
    return [...result.speed.roundDetails].sort((left, right) => left.round - right.round);
  }

  return buildRoundDetailsFromSamples(
    result.speed.rounds,
    result.speed.samplesMs,
    result.speed.firstTokenSamplesMs,
    []
  );
}

function normalizeFinishedTestResult(input: unknown): FinishedTestResult | undefined {
  if (!isRecord(input)) return undefined;

  const status = input.status;
  if (status !== "success" && status !== "error") return undefined;

  const message = typeof input.message === "string" && input.message.trim() ? input.message.trim() : "";
  const rawDetail = typeof input.detail === "string" && input.detail.trim() ? input.detail.trim() : "";
  const legacyResponseText = rawDetail.startsWith("接口返回：") ? rawDetail.slice("接口返回：".length).trim() : "";
  const responseTextSource =
    typeof input.responseText === "string" && input.responseText.trim() ? input.responseText : legacyResponseText;
  const responseText = responseTextSource ? cleanMultilineText(responseTextSource, 2000) : "";
  const responseSource =
    input.responseSource === "stream" ||
    input.responseSource === "chat" ||
    input.responseSource === "responses" ||
    input.responseSource === "messages"
      ? input.responseSource
      : undefined;
  const detail = rawDetail && !legacyResponseText ? cleanOneLineText(rawDetail, 300) : responseText ? "接口连通，已收到模型回复" : "";
  const testedAt = safeDateToIso(input.testedAt);

  if (!testedAt) return undefined;

  return {
    status,
    message: message || (status === "success" ? PASS_TEXT : FAIL_TEXT),
    detail: detail || undefined,
    responseText: responseText || undefined,
    responseSource,
    testedAt
  };
}

function normalizeFinishedProbeResult(input: unknown): FinishedProbeResult | undefined {
  if (!isRecord(input)) return undefined;

  const status = input.status;
  if (status !== "success" && status !== "error") return undefined;

  const supportedModels = Array.isArray(input.supportedModels)
    ? input.supportedModels.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const recommendedModel = typeof input.recommendedModel === "string" ? input.recommendedModel.trim() : "";
  const detail = typeof input.detail === "string" && input.detail.trim() ? cleanOneLineText(input.detail, 300) : "";
  const testedAt = safeDateToIso(input.testedAt);

  if (!testedAt) return undefined;

  return {
    status,
    supportedModels,
    recommendedModel: recommendedModel || undefined,
    detail: detail || undefined,
    testedAt
  };
}

function normalizeBenchmarkSpeed(input: unknown): FinishedModelBenchmarkResult["speed"] | undefined {
  if (!isRecord(input)) return undefined;

  const roundDetails = Array.isArray(input.roundDetails)
    ? input.roundDetails
        .map((item, index) => normalizeBenchmarkRoundDetail(item, index))
        .filter((item): item is BenchmarkRoundDetail => Boolean(item))
        .sort((left, right) => left.round - right.round)
    : [];
  const successRate =
    typeof input.successRate === "number" && Number.isFinite(input.successRate) ? Math.min(1, Math.max(0, input.successRate)) : 0;
  const samplesMs = Array.isArray(input.samplesMs)
    ? input.samplesMs
        .map((item) => (typeof item === "number" && Number.isFinite(item) ? Math.max(0, Math.round(item)) : 0))
        .filter((item) => item > 0)
    : roundDetails.map((item) => item.elapsedMs).filter((item): item is number => typeof item === "number");
  const firstTokenSamplesMs = Array.isArray(input.firstTokenSamplesMs)
    ? input.firstTokenSamplesMs
        .map((item) => (typeof item === "number" && Number.isFinite(item) ? Math.max(0, Math.round(item)) : 0))
        .filter((item) => item > 0)
    : roundDetails.map((item) => item.firstTokenMs).filter((item): item is number => typeof item === "number");
  const rounds = typeof input.rounds === "number" && Number.isFinite(input.rounds) ? Math.max(1, Math.round(input.rounds)) : roundDetails.length || samplesMs.length;
  const medianMsCandidate =
    typeof input.medianMs === "number" && Number.isFinite(input.medianMs) ? Math.max(0, Math.round(input.medianMs)) : 0;
  const avgMsCandidate = typeof input.avgMs === "number" && Number.isFinite(input.avgMs) ? Math.max(0, Math.round(input.avgMs)) : 0;
  const medianMs = medianMsCandidate || (samplesMs.length > 0 ? medianOf(samplesMs) : 0);
  const avgMs = avgMsCandidate || (samplesMs.length > 0 ? averageOf(samplesMs) : 0);
  const stabilityMs =
    typeof input.stabilityMs === "number" && Number.isFinite(input.stabilityMs)
      ? Math.max(0, Math.round(input.stabilityMs))
      : computeStability(samplesMs);
  const firstTokenMedianMs =
    typeof input.firstTokenMedianMs === "number" && Number.isFinite(input.firstTokenMedianMs)
      ? Math.max(0, Math.round(input.firstTokenMedianMs))
      : firstTokenSamplesMs.length > 0
        ? medianOf(firstTokenSamplesMs)
        : undefined;
  const firstTokenAvgMs =
    typeof input.firstTokenAvgMs === "number" && Number.isFinite(input.firstTokenAvgMs)
      ? Math.max(0, Math.round(input.firstTokenAvgMs))
      : firstTokenSamplesMs.length > 0
        ? averageOf(firstTokenSamplesMs)
        : undefined;

  if (!rounds || !medianMs || !avgMs) return undefined;

  return {
    rounds,
    medianMs,
    avgMs,
    successRate: successRate || (samplesMs.length > 0 ? Math.min(1, samplesMs.length / rounds) : 0),
    stabilityMs,
    samplesMs,
    firstTokenMedianMs,
    firstTokenAvgMs,
    firstTokenSamplesMs: firstTokenSamplesMs.length > 0 ? firstTokenSamplesMs : undefined,
    roundDetails: roundDetails.length > 0 ? roundDetails : buildRoundDetailsFromSamples(rounds, samplesMs, firstTokenSamplesMs)
  };
}

function inferModelTags(model: string): string[] {
  const normalized = model.trim();
  if (!normalized) return [];

  const out: string[] = [];
  for (const rule of MODEL_TAG_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      out.push(rule.tag);
    }
  }

  return uniqueStrings(out);
}

function normalizeFinishedBenchmarkResult(
  input: unknown,
  modelKey: string
): FinishedModelBenchmarkResult | undefined {
  if (!isRecord(input)) return undefined;

  const status = input.status;
  if (status !== "success" && status !== "error") return undefined;

  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : modelKey.trim();
  if (!model) return undefined;

  const tags = Array.isArray(input.tags) ? uniqueStrings(input.tags.map((item) => String(item))) : inferModelTags(model);
  const speed = normalizeBenchmarkSpeed(input.speed);
  const detail = typeof input.detail === "string" && input.detail.trim() ? cleanOneLineText(input.detail, 360) : "";
  const testedAt = safeDateToIso(input.testedAt);

  if (!testedAt) return undefined;

  return {
    status,
    model,
    tags,
    speed,
    detail: detail || undefined,
    testedAt
  };
}

function normalizeStoredBenchmarks(input: unknown): KeyConfig["benchmarks"] | undefined {
  const out: Record<string, FinishedModelBenchmarkResult> = {};
  const entries = Array.isArray(input)
    ? input
        .map((item, index) => {
          const model = isRecord(item) ? firstNonEmptyString(item.model, item.name, item.id) : "";
          return model ? [model || String(index), item] : null;
        })
        .filter((item): item is [string, unknown] => Boolean(item))
    : isRecord(input)
      ? Object.entries(input)
      : [];

  for (const [modelKey, value] of entries) {
    const normalized = normalizeFinishedBenchmarkResult(value, modelKey);
    if (!normalized) continue;
    out[normalized.model] = normalized;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function isLikelyChatBenchmarkable(model: string, tags?: string[]): boolean {
  const normalized = model.trim().toLowerCase();
  const resolvedTags = tags || inferModelTags(model);

  if (resolvedTags.includes("embedding") || resolvedTags.includes("image") || resolvedTags.includes("rerank") || resolvedTags.includes("moderation")) {
    return false;
  }

  return !/(whisper|transcri|text-embedding|embedding-|rerank|stable-diffusion|sdxl|flux|moderation)/i.test(normalized);
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, item) => sum + item, 0) / values.length);
}

function computeStability(values: number[]): number {
  if (values.length <= 1) return 0;
  return Math.max(...values) - Math.min(...values);
}

function formatDurationLabel(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatSuccessRateLabel(rate?: number): string {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "-";
  return `${Math.round(rate * 100)}%`;
}

function getBenchmarkRounds(input: string | number): number {
  const numeric = typeof input === "number" ? input : Number.parseInt(String(input).trim(), 10);
  if (!Number.isFinite(numeric)) return DEFAULT_BENCHMARK_ROUNDS;
  return Math.min(3, Math.max(1, Math.round(numeric)));
}

function defaultModelBenchmarkResult(model: string): ModelBenchmarkResult {
  return { status: "idle", model, tags: inferModelTags(model) };
}

function benchmarkStatusLabel(result: ModelBenchmarkResult): string {
  if (result.status === "pending") return "测试中...";
  if (result.status === "success") return "已测试";
  if (result.status === "error") return "测试失败";
  return "未测试";
}

function collectFinishedBenchmarks(item: KeyConfig, runtimeBenchmarks?: Record<string, ModelBenchmarkResult>) {
  const merged = {
    ...(item.benchmarks || {}),
    ...(runtimeBenchmarks || {})
  };

  return Object.values(merged).filter(
    (benchmark): benchmark is FinishedModelBenchmarkResult => benchmark.status === "success"
  );
}

function buildBenchmarkSummary(
  configId: string,
  results: FinishedModelBenchmarkResult[],
  fallbackRounds = DEFAULT_BENCHMARK_ROUNDS,
  scopeModels: string[] = []
): BenchmarkSummary | null {
  const modelList = uniqueStrings(scopeModels.length > 0 ? scopeModels : results.map((item) => item.model));
  if (results.length === 0 && modelList.length === 0) return null;

  const successfulBenchmarks = results.filter((item) => item.status === "success" && item.speed);
  const fastest = pickFastestBenchmark(successfulBenchmarks);
  const quickestFirstToken = pickQuickestFirstTokenBenchmark(successfulBenchmarks);
  const mostStable = pickMostStableBenchmark(successfulBenchmarks);
  const recommended = pickRecommendedBenchmark(successfulBenchmarks);
  const finishedAt = [...results]
    .map((item) => item.testedAt)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

  return {
    configId,
    rounds: Math.max(
      1,
      ...results.map((item) => item.speed?.rounds || 0),
      fallbackRounds
    ),
    models: modelList,
    totalModels: modelList.length,
    successModels: successfulBenchmarks.length,
    fastestModel: fastest?.model,
    fastestMedianMs: fastest?.speed?.medianMs,
    quickestFirstTokenModel: quickestFirstToken?.model,
    quickestFirstTokenMs: quickestFirstToken?.speed?.firstTokenMedianMs,
    mostStableModel: mostStable?.model,
    stabilityMs: mostStable?.speed?.stabilityMs,
    recommendedModel: recommended?.model,
    finishedAt: finishedAt || new Date().toISOString()
  };
}

function pickFastestBenchmark(benchmarks: FinishedModelBenchmarkResult[]): FinishedModelBenchmarkResult | undefined {
  return [...benchmarks]
    .filter((item) => typeof item.speed?.medianMs === "number")
    .sort((left, right) => (left.speed?.medianMs || Number.POSITIVE_INFINITY) - (right.speed?.medianMs || Number.POSITIVE_INFINITY))[0];
}

function pickQuickestFirstTokenBenchmark(benchmarks: FinishedModelBenchmarkResult[]): FinishedModelBenchmarkResult | undefined {
  return [...benchmarks]
    .filter((item) => typeof item.speed?.firstTokenMedianMs === "number")
    .sort(
      (left, right) =>
        (left.speed?.firstTokenMedianMs || Number.POSITIVE_INFINITY) -
        (right.speed?.firstTokenMedianMs || Number.POSITIVE_INFINITY)
    )[0];
}

function pickMostStableBenchmark(benchmarks: FinishedModelBenchmarkResult[]): FinishedModelBenchmarkResult | undefined {
  return [...benchmarks]
    .filter((item) => typeof item.speed?.stabilityMs === "number")
    .sort((left, right) => (left.speed?.stabilityMs || Number.POSITIVE_INFINITY) - (right.speed?.stabilityMs || Number.POSITIVE_INFINITY))[0];
}

function pickRecommendedBenchmark(benchmarks: FinishedModelBenchmarkResult[]): FinishedModelBenchmarkResult | undefined {
  const ranked = [...benchmarks]
    .filter((item) => item.speed)
    .sort((left, right) => {
      const leftScore = (left.speed?.successRate || 0) * 100000 - (left.speed?.medianMs || 0) - (left.speed?.stabilityMs || 0) * 2;
      const rightScore = (right.speed?.successRate || 0) * 100000 - (right.speed?.medianMs || 0) - (right.speed?.stabilityMs || 0) * 2;
      return rightScore - leftScore;
    });

  return ranked[0];
}

function getTagClassName(tag: string): string {
  if (tag === "image") return "border-rose-200 bg-rose-50 text-rose-700";
  if (tag === "embedding") return "border-sky-200 bg-sky-50 text-sky-700";
  if (tag === "thinking") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tag === "coding") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tag === "audio") return "border-violet-200 bg-violet-50 text-violet-700";
  if (tag === "rerank") return "border-zinc-300 bg-zinc-100 text-zinc-700";
  if (tag === "moderation") return "border-red-200 bg-red-50 text-red-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function normalizeSourceMeta(input: unknown): KeyConfig["sourceMeta"] | undefined {
  if (!isRecord(input)) return undefined;

  const kind = typeof input.kind === "string" ? input.kind.trim() : "";
  if (kind !== "manual" && kind !== "cc-switch-provider" && kind !== "cc-switch-deeplink") return undefined;

  const ccSwitchAppRaw = typeof input.ccSwitchApp === "string" ? input.ccSwitchApp.trim().toLowerCase() : "";
  return {
    kind,
    ccSwitchApp: isCcSwitchApp(ccSwitchAppRaw) ? ccSwitchAppRaw : undefined
  };
}

function toDateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(d);
}

function defaultProbeResult(): ProbeResult {
  return { status: "idle", supportedModels: [] };
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: unknown = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw {
        status: response.status,
        message: getErrorMessage(payload) || `HTTP ${response.status}`
      };
    }

    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

async function postJsonWithTimeout<TResponse>(url: string, body: unknown, timeoutMs: number): Promise<TResponse> {
  return (await fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    timeoutMs
  )) as TResponse;
}

function inferCcSwitchHomepage(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname;

    if (host.startsWith("api.")) {
      return `${parsed.protocol}//${host.slice(4)}`;
    }
    if (host.startsWith("api-")) {
      return `${parsed.protocol}//${host.replace(/^api-/, "")}`;
    }

    return parsed.origin;
  } catch {
    return "";
  }
}

function buildCcSwitchDeepLink(item: KeyConfig, app: CcSwitchApp): string {
  const params = new URLSearchParams();
  params.set("resource", "provider");
  params.set("app", app);
  params.set("name", item.name || "AI Key Vault");
  if (item.baseUrl) params.set("endpoint", normalizeBaseUrl(item.baseUrl));
  if (item.apiKey) params.set("apiKey", cleanKey(item.apiKey));
  if (item.model) params.set("model", item.model.trim());

  const homepage = inferCcSwitchHomepage(item.baseUrl);
  if (homepage) params.set("homepage", homepage);

  params.set("enabled", "false");
  return `ccswitch://v1/import?${params.toString()}`;
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
    ["cause", "message"]
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
  else if (/network|fetch failed|connection|ENOTFOUND|ECONNREFUSED/i.test(raw))
    detail = "请求失败，请检查网络或地址";

  if (!raw) return detail;
  if (detail.includes(raw)) return detail;
  return `${detail}；接口返回：${raw}`;
}

function normalizeStoredConfigItem(input: unknown, index: number): KeyConfig | undefined {
  if (!isRecord(input)) return undefined;

  const id = typeof input.id === "string" && input.id ? input.id : createClientId();
  const rawName = firstNonEmptyString(input.name, input.title, input.label);
  const baseUrl = normalizeBaseUrl(
    firstNonEmptyString(input.baseUrl, input.baseURL, input.url, input.endpoint, input.apiBaseUrl, input.api_url)
  );
  const apiKey = cleanKey(firstNonEmptyString(input.apiKey, input.api_key, input.key, input.token));
  const model = firstNonEmptyString(input.model, input.modelName, input.defaultModel, input.default_model);
  const createdAt = safeDateToIso(input.createdAt) || safeDateToIso(input.updatedAt) || new Date().toISOString();
  const sourceMeta = normalizeSourceMeta(input.sourceMeta);
  const probe = normalizeFinishedProbeResult(input.probe || input.probeResult || input.modelProbe);
  const lastTest = normalizeFinishedTestResult(input.lastTest || input.lastResult || input.testResult);
  const benchmarks = normalizeStoredBenchmarks(input.benchmarks || input.modelBenchmarks || input.benchmarkResults);
  const apiFormat = normalizeApiFormat(input.apiFormat || input.api_format || input.format || input.endpointFormat);
  const rawListStatus = input.listStatus || input.list_status || input.groupStatus;
  const listStatus: KeyConfig["listStatus"] =
    rawListStatus === "disabled" || rawListStatus === "disable" || rawListStatus === "off"
      ? "disabled"
      : rawListStatus === "failed" || rawListStatus === "error"
        ? "failed"
        : rawListStatus === "success"
          ? "success"
          : lastTest?.status === "error"
            ? "failed"
            : "success";
  const hasCoreValue = Boolean(rawName || baseUrl || apiKey || model || probe || lastTest || benchmarks);

  if (!hasCoreValue) return undefined;

  const name = rawName || makeDefaultName(index + 1);
  return { id, name, baseUrl, apiKey, model, apiFormat, listStatus, createdAt, sourceMeta, probe, lastTest, benchmarks };
}

function toStoredConfigCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];

  if (Array.isArray(parsed.configs)) return parsed.configs;
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed.data)) return parsed.data;

  const recordValues = Object.values(parsed).filter((item) => isRecord(item));
  if (recordValues.length > 0) return recordValues;

  return [];
}

function normalizeStoredConfigs(raw: string): KeyConfig[] {
  const parsed = JSON.parse(raw) as unknown;
  const candidates = toStoredConfigCandidates(parsed);
  const normalized: KeyConfig[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const item = normalizeStoredConfigItem(candidates[index], index);
    if (item) normalized.push(item);
  }

  return normalized;
}

function defaultTestResult(): TestResult {
  return { status: "idle", message: "未测试" };
}

function testResponseSourceLabel(source?: TestResult["responseSource"]): string {
  if (source === "stream") return "流式";
  if (source === "responses") return "Responses";
  if (source === "messages") return "Messages";
  if (source === "chat") return "普通";
  return "";
}

function statusPillClass(status: TestStatus): string {
  if (status === "success") return "bg-emerald-50 text-emerald-800";
  if (status === "error") return "bg-red-50 text-red-700";
  if (status === "pending") return "bg-amber-50 text-amber-700";
  return "bg-zinc-100 text-zinc-600";
}

function StatusIcon({ status }: { status: TestStatus }) {
  if (status === "success") return <FaCheckCircle aria-hidden />;
  if (status === "error") return <FaTimesCircle aria-hidden />;
  if (status === "pending") return <FaSpinner className="animate-spin" aria-hidden />;
  return <FaVial aria-hidden />;
}

function HelpHint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-zinc-400 transition hover:text-zinc-700"
        aria-label={text}
        title={text}
        tabIndex={0}
      >
        <FaQuestionCircle aria-hidden />
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-56 -translate-x-1/2 rounded-xl border border-zinc-200 bg-zinc-900 px-3 py-2 text-[11px] leading-5 text-white shadow-xl group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export default function Home() {
  const ccSwitchSqlInputRef = useRef<HTMLInputElement | null>(null);
  const configWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [configs, setConfigs] = useState<KeyConfig[]>([]);
  const [isConfigStoreReady, setIsConfigStoreReady] = useState(false);
  const [configStoreError, setConfigStoreError] = useState("");
  const [form, setForm] = useState<FormState>({ name: "", baseUrl: "", apiKey: "", model: "", apiFormat: "auto" });
  const [formSourceMeta, setFormSourceMeta] = useState<KeyConfig["sourceMeta"]>();
  const [pasteRaw, setPasteRaw] = useState("");
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [resultMap, setResultMap] = useState<Record<string, TestResult>>({});
  const [probeMap, setProbeMap] = useState<Record<string, ProbeResult>>({});
  const [benchmarkMap, setBenchmarkMap] = useState<Record<string, Record<string, ModelBenchmarkResult>>>({});
  const [notice, setNoticeState] = useState<NoticeState | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [probingAll, setProbingAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>({ name: "", baseUrl: "", apiKey: "", model: "", apiFormat: "auto" });
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState("");
  const [ccSwitchDialogId, setCcSwitchDialogId] = useState<string | null>(null);
  const [ccSwitchTargetApp, setCcSwitchTargetApp] = useState<CcSwitchApp>("codex");
  const [probeDialogId, setProbeDialogId] = useState<string | null>(null);
  const [benchmarkDialogId, setBenchmarkDialogId] = useState<string | null>(null);
  const [benchmarkSearch, setBenchmarkSearch] = useState("");
  const [benchmarkRoundsInput, setBenchmarkRoundsInput] = useState(String(DEFAULT_BENCHMARK_ROUNDS));
  const [selectedProbeModels, setSelectedProbeModels] = useState<string[]>([]);
  const [benchmarkBatch, setBenchmarkBatch] = useState<BenchmarkBatchProgress | null>(null);
  const [benchmarkSummaryMap, setBenchmarkSummaryMap] = useState<Record<string, BenchmarkSummary>>({});
  const [benchmarkChartModel, setBenchmarkChartModel] = useState("");
  const [benchmarkListCollapsed, setBenchmarkListCollapsed] = useState(false);
  const [benchmarkDetailModel, setBenchmarkDetailModel] = useState("");
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [categoryFilter, setCategoryFilter] = useState<ModelCategoryFilter>("all");
  const [configSearch, setConfigSearch] = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const [highlightedConfigId, setHighlightedConfigId] = useState<string | null>(null);
  const [probeModelCategory, setProbeModelCategory] = useState<ModelCategoryFilter>("all");
  const cardItemRefs = useRef<Record<string, HTMLLIElement | null>>({});

  function setNotice(message: string, tone?: NoticeTone) {
    if (!message) {
      setNoticeState(null);
      return;
    }

    setNoticeState({ message, tone: tone || inferNoticeTone(message) });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadProjectConfigs() {
      try {
        const response = await fetch("/api/configs", { cache: "no-store" });
        if (!response.ok) throw new Error("读取项目配置失败");

        const payload: unknown = await response.json();
        const storedConfigs =
          typeof payload === "object" && payload !== null && "configs" in payload
            ? (payload as { configs: unknown }).configs
            : [];

        if (!cancelled) {
          setConfigs(normalizeStoredConfigs(JSON.stringify(storedConfigs)));
          setIsConfigStoreReady(true);
          setConfigStoreError("");
        }
      } catch {
        if (!cancelled) {
          const errorMessage = "读取项目配置失败，请刷新页面重试";
          setConfigStoreError(errorMessage);
          setNotice(errorMessage);
        }
      }
    }

    void loadProjectConfigs();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isConfigStoreReady) return;

    configWriteQueueRef.current = configWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch("/api/configs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ configs })
        });
        if (!response.ok) throw new Error("保存项目配置失败");
      })
      .catch(() => {
        const errorMessage = "保存项目配置失败，请检查服务状态后重试";
        setConfigStoreError(errorMessage);
        setNotice(errorMessage);
      });
  }, [configs, isConfigStoreReady]);

  // 主题初始化：读取本地存储，否则默认跟随系统。
  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const normalized: ThemeMode =
      stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    setTheme(normalized);
  }, []);

  // 搜索下拉：点击外部或按 Esc 关闭候选列表。
  useEffect(() => {
    if (!searchDropdownOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!searchBoxRef.current?.contains(event.target as Node)) {
        setSearchDropdownOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSearchDropdownOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [searchDropdownOpen]);

  // 主题应用 + 监听系统主题变化（仅 system 模式生效）。
  useEffect(() => {
    const root = document.documentElement;

    const apply = (mode: ThemeMode) => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const isDark = mode === "dark" || (mode === "system" && prefersDark);
      root.classList.toggle("dark", isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
    };

    apply(theme);

    if (theme !== "system") return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => apply(theme);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme]);

  function setThemeMode(mode: ThemeMode) {
    setTheme(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // 忽略隐身模式等写入失败。
    }
  }

  // 卡片折叠/展开：默认一律折叠；仅当 collapsedIds[id] === false 时才展开
  function isConfigCollapsed(id: string) {
    return collapsedIds[id] !== false;
  }

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => ({ ...prev, [id]: prev[id] !== false ? false : true }));
  }

  function ensureCollapsed(id: string) {
    setCollapsedIds((prev) => (prev[id] === false ? { ...prev, [id]: true } : prev));
  }

  // 卡片展示状态取运行时结果；列表归属使用持久 listStatus，避免测试中/编辑时在成功与失败列表之间跳动
  function getConfigResult(item: KeyConfig): TestResult {
    return resultMap[item.id] || item.lastTest || defaultTestResult();
  }
  function getConfigListStatus(item: KeyConfig): "success" | "failed" | "disabled" {
    if (item.listStatus === "disabled") return "disabled";
    if (item.listStatus === "failed" || item.listStatus === "success") return item.listStatus;
    return item.lastTest?.status === "error" ? "failed" : "success";
  }
  const sortedConfigs = [...configs].sort(compareConfigsByTestedAtDesc);
  const failedConfigs = sortedConfigs.filter((item) => getConfigListStatus(item) === "failed");
  const disabledConfigs = sortedConfigs.filter((item) => getConfigListStatus(item) === "disabled");
  const visibleConfigs = sortedConfigs.filter((item) => getConfigListStatus(item) === "success");

  // 折叠/展开全部 的控制范围跟随当前激活的列表
  const [activeList, setActiveList] = useState<"all" | "failed" | "disabled">("all");
  const baseActiveConfigs =
    activeList === "failed" ? failedConfigs : activeList === "disabled" ? disabledConfigs : visibleConfigs;
  // 按模型分类过滤（与失败/配置列表切换叠加）
  const activeConfigs = baseActiveConfigs.filter(
    (item) => categoryFilter === "all" || inferModelCategory(item.model) === categoryFilter
  );
  const activeCount = activeConfigs.length;
  const activeCollapsedCount = activeConfigs.filter((item) => isConfigCollapsed(item.id)).length;
  const activeAllCollapsed = activeCount > 0 && activeCollapsedCount === activeCount;

  // 搜索匹配：按名称模糊匹配，最多展示 8 条候选
  const searchMatches = useMemo(() => {
    const query = configSearch.trim().toLowerCase();
    if (!query) return [];
    return sortedConfigs.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 8);
  }, [configSearch, sortedConfigs]);

  // 搜索定位：切到目标所在列表并高亮、展开，再滚动到对应卡片
  function locateConfigTarget(target: KeyConfig) {
    const status = getConfigListStatus(target);
    setActiveList(status === "failed" ? "failed" : status === "disabled" ? "disabled" : "all");
    setCategoryFilter("all");
    setConfigSearch(target.name);
    setCollapsedIds((prev) => ({ ...prev, [target.id]: false }));
    setHighlightedConfigId(target.id);
    setSearchDropdownOpen(false);

    // 等列表切换 / 展开渲染完成后再滚动；多帧重试避免 ref 尚未挂载
    const scrollToCard = (attempt: number) => {
      const el = cardItemRefs.current[target.id];
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (attempt < 8) {
        window.setTimeout(() => scrollToCard(attempt + 1), 50);
      }
    };
    window.setTimeout(() => scrollToCard(0), 50);

    window.setTimeout(() => {
      setHighlightedConfigId((cur) => (cur === target.id ? null : cur));
    }, 2200);
  }

  // 回车/点击「定位」：跳到首个匹配项
  function locateConfig() {
    const target = searchMatches[0];
    if (!target) return;
    locateConfigTarget(target);
  }

  function revealSavedConfig(id: string) {
    setActiveList("all");
    setCategoryFilter("all");
    setConfigSearch("");
    // 新保存的配置也保持折叠，只高亮并滚入视野
    ensureCollapsed(id);
    setHighlightedConfigId(id);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cardItemRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
    setTimeout(() => {
      setHighlightedConfigId((currentId) => (currentId === id ? null : currentId));
    }, 2200);
  }

  function collapseActiveAll() {
    setCollapsedIds((prev) => ({ ...prev, ...Object.fromEntries(activeConfigs.map((item) => [item.id, true])) }));
  }

  function expandActiveAll() {
    setCollapsedIds((prev) => ({ ...prev, ...Object.fromEntries(activeConfigs.map((item) => [item.id, false])) }));
  }

  // 共享卡片渲染：成功 / 失败 / 禁用列表共用同一函数，折叠/小框设计一致复用
  function renderConfigCard(item: KeyConfig) {
    const testing = loadingMap[item.id];
    const result = getConfigResult(item);
    const probe = probeMap[item.id] || item.probe || defaultProbeResult();
    const isEditing = editingId === item.id;
    const isEditingModel = editingModelId === item.id;
    const isCollapsed = !isEditing && isConfigCollapsed(item.id);
    const probing = probe.status === "pending";
    const isDisabled = getConfigListStatus(item) === "disabled";
    const currentModelTags = inferModelTags(item.model);
    const runtimeBenchmarks = benchmarkMap[item.id] || {};
    const currentBenchmark =
      item.model.trim() ? runtimeBenchmarks[item.model] || item.benchmarks?.[item.model] || defaultModelBenchmarkResult(item.model) : null;
    const finishedBenchmarks = collectFinishedBenchmarks(item, runtimeBenchmarks);
    const fastestBenchmark = pickFastestBenchmark(finishedBenchmarks);
    const quickestFirstTokenBenchmark = pickQuickestFirstTokenBenchmark(finishedBenchmarks);
    const recommendedBenchmark = pickRecommendedBenchmark(finishedBenchmarks);

    return (
      <li
        key={item.id}
        data-config-id={item.id}
        ref={(el) => {
          cardItemRefs.current[item.id] = el;
        }}
        className={`w-full min-w-0 rounded-2xl border bg-white p-2.5 transition dark:bg-zinc-900 ${
          highlightedConfigId === item.id
            ? "border-emerald-400 ring-2 ring-emerald-300 dark:border-emerald-500 dark:ring-emerald-500/60"
            : isDisabled
              ? "border-zinc-300 opacity-95 dark:border-zinc-600"
              : "border-zinc-200 dark:border-zinc-700"
        }`}
      >
        {isEditing ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-3">
            <label className={labelClass}>名称</label>
            <input
              className={inputClass}
              value={editForm.name}
              onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
            />

            <label className={labelClass}>地址</label>
            <input
              className={inputClass}
              value={editForm.baseUrl}
              onChange={(e) => setEditForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="例如：https://api.openai.com"
            />
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">{endpointHintText}</p>

            <label className={labelClass}>Key</label>
            <input
              className={inputClass}
              value={editForm.apiKey}
              onChange={(e) => setEditForm((prev) => ({ ...prev, apiKey: e.target.value }))}
            />

            <label className={labelClass}>模型</label>
            <input
              className={inputClass}
              value={editForm.model}
              onChange={(e) => setEditForm((prev) => ({ ...prev, model: e.target.value }))}
            />

            <label className={labelClass}>API 格式</label>
            <select
              className={inputClass}
              value={editForm.apiFormat}
              onChange={(e) => setEditForm((prev) => ({ ...prev, apiFormat: normalizeApiFormat(e.target.value) }))}
            >
              {API_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{`${option.label} - ${option.hint}`}</option>
              ))}
            </select>

            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} onClick={() => saveEdit(item.id)}>
                <FaSave aria-hidden />
                <span>保存编辑</span>
              </button>
              <button type="button" className={btnGhost} onClick={cancelEdit}>
                <FaTimesCircle aria-hidden />
                <span>取消</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div
                className="group/card flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 -mx-1.5 -my-1 cursor-pointer outline-none transition hover:bg-zinc-50/70 focus-visible:ring-2 focus-visible:ring-emerald-300 dark:hover:bg-zinc-800/40"
              onClick={() => toggleCollapse(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleCollapse(item.id);
                }
              }}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? "展开卡片" : "折叠卡片"}
              title={isCollapsed ? "点击展开" : "点击折叠"}
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-zinc-400 transition-transform duration-200 group-hover/card:text-emerald-600 dark:text-zinc-500 dark:group-hover/card:text-emerald-400">
                <span className={`transition-transform duration-200 ${isCollapsed ? "" : "rotate-180"}`}>
                  <FaChevronDown aria-hidden />
                </span>
              </span>
              <div className="min-w-0 max-w-[min(48vw,28rem)] truncate text-base font-bold text-zinc-900 dark:text-zinc-100">{item.name}</div>
              <span
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${statusPillClass(result.status)}`}
                title={result.message}
                aria-label={result.message}
              >
                <StatusIcon status={result.status} />
              </span>
              </div>
              {isCollapsed ? (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {isDisabled ? (
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={() => enableConfig(item.id)}
                      title="启用"
                      aria-label="启用"
                    >
                      <FaCheckCircle aria-hidden />
                      <span>启用</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={smallBtn}
                        onClick={() => testConfig(item)}
                        disabled={testing}
                        title="测试"
                        aria-label="测试"
                      >
                        {testing ? <FaSpinner className="animate-spin" aria-hidden /> : <FaBolt aria-hidden />}
                        <span>测试</span>
                      </button>
                      <button
                        type="button"
                        className={smallBtn}
                        onClick={() => probeConfig(item)}
                        disabled={probing}
                        title="识别模型"
                        aria-label="识别模型"
                      >
                        {probing ? <FaSpinner className="animate-spin" aria-hidden /> : <FaMagic aria-hidden />}
                        <span>识别模型</span>
                      </button>
                      <button
                        type="button"
                        className={smallBtn}
                        onClick={() => disableConfig(item.id)}
                        title="禁用"
                        aria-label="禁用"
                      >
                        <FaBan aria-hidden />
                        <span>禁用</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={() => startEdit(item)}
                    title="编辑"
                    aria-label="编辑"
                  >
                    <FaEdit aria-hidden />
                    <span>编辑</span>
                  </button>
                  <button
                    type="button"
                    className={smallDangerBtn}
                    onClick={() => removeConfig(item.id)}
                    title="删除"
                    aria-label="删除"
                  >
                    <FaTrashAlt aria-hidden />
                    <span>删除</span>
                  </button>
                </div>
              ) : null}
            </div>

            {isCollapsed ? (
              <div className="mt-1 flex min-w-0 items-center gap-2">
                {/* 模型 + 返回内容 + 操作按钮（单行） */}
                <span
                  className="inline-flex min-w-0 max-w-[42vw] shrink items-center gap-1 truncate rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200"
                  title={item.model || "（未设置）"}
                >
                  <FaTag className="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
                  <span className="truncate">{item.model || "（未设置）"}</span>
                </span>
                {result.detail ? (
                  <span
                    className="inline-flex min-w-0 flex-1 items-center gap-1 truncate rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                    title={cleanOneLineText(result.detail, 300)}
                  >
                    <FaInfoCircle className="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
                    <span className="truncate">{cleanOneLineText(result.detail, 120)}</span>
                  </span>
                ) : null}
              </div>
            ) : (
              <>
                <div className="mt-2 grid gap-2">
                  <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <FaLink aria-hidden /> 地址
                    </span>
                    <div className="flex min-w-0 max-w-full items-start gap-1.5">
                      <button
                        type="button"
                        className="min-w-0 flex-1 break-all rounded-md px-1 py-0.5 text-left text-sm text-zinc-800 transition hover:bg-zinc-100 hover:text-emerald-700 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-emerald-300 dark:disabled:hover:text-zinc-100"
                        onClick={() => void copyText(item.baseUrl, `已复制地址：${item.name}`)}
                        title={item.baseUrl ? "点击复制地址" : "未填写地址"}
                        disabled={!item.baseUrl}
                      >
                        {item.baseUrl || "(未填写)"}
                      </button>
                      <button
                        type="button"
                        className={iconCopyBtn}
                        onClick={() => void copyText(item.baseUrl, `已复制地址：${item.name}`)}
                        title="复制地址"
                        aria-label="复制地址"
                        disabled={!item.baseUrl}
                      >
                        <FaCopy aria-hidden />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <FaKey aria-hidden /> Key
                    </span>
                    <div className="flex min-w-0 max-w-full items-start gap-1.5">
                      <button
                        type="button"
                        className="min-w-0 flex-1 break-all rounded-md px-1 py-0.5 text-left font-mono text-sm text-zinc-800 transition hover:bg-zinc-100 hover:text-emerald-700 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-emerald-300 dark:disabled:hover:text-zinc-100"
                        onClick={() => void copyText(item.apiKey, `已复制 Key：${item.name}`)}
                        title={item.apiKey ? "点击复制 Key" : "未填写 Key"}
                        disabled={!item.apiKey}
                      >
                        {item.apiKey ? toMaskedKey(item.apiKey) : "(未填写)"}
                      </button>
                      <button
                        type="button"
                        className={iconCopyBtn}
                        onClick={() => void copyText(item.apiKey, `已复制 Key：${item.name}`)}
                        title="复制 Key"
                        aria-label="复制 Key"
                        disabled={!item.apiKey}
                      >
                        <FaCopy aria-hidden />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <FaTag aria-hidden /> 模型
                    </span>
                    <div className="grid gap-1.5">
                      {isEditingModel ? (
                        <input
                          autoFocus
                          className={inputClass}
                          value={modelDraft}
                          onChange={(e) => setModelDraft(e.target.value)}
                          onBlur={() => saveInlineModelEdit(item.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveInlineModelEdit(item.id);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelInlineModelEdit();
                            }
                          }}
                          placeholder="点击后可修改"
                        />
                      ) : (
                        <button
                          type="button"
                          className="inline-flex w-fit rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-50"
                          onClick={() => startInlineModelEdit(item)}
                          title="点击编辑模型"
                          aria-label="点击编辑模型"
                        >
                          {item.model || "点击设置模型"}
                        </button>
                      )}
                      {currentModelTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {currentModelTags.map((tag) => (
                            <span
                              key={`${item.id}-${tag}`}
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${getTagClassName(tag)}`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <FaVial aria-hidden /> API 格式
                    </span>
                    <select
                      className={`${inputClass} max-w-md`}
                      value={item.apiFormat || "auto"}
                      onChange={(e) => updateConfigApiFormat(item.id, normalizeApiFormat(e.target.value))}
                    >
                      {API_FORMAT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{`${option.label} - ${option.hint}`}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <FaVial aria-hidden /> 状态
                    </span>
                    <div className="grid gap-1">
                      <span
                        className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${statusPillClass(result.status)}`}
                      >
                        <StatusIcon status={result.status} />
                        <span>{result.message}</span>
                      </span>
                      {result.status === "error" && result.detail ? (
                        <details className="w-full rounded-lg border border-red-100 bg-red-50/50 px-2 py-1.5 text-xs text-red-800">
                          <summary className="cursor-pointer font-medium text-red-700">有错误，点击查看详情</summary>
                          <div className="mt-1 whitespace-pre-wrap break-words leading-5">{result.detail}</div>
                        </details>
                      ) : result.detail ? (
                        <span className="text-xs text-zinc-500">{result.detail}</span>
                      ) : null}
                      {result.responseText ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                              AI 返回内容
                            </div>
                            {result.responseSource ? (
                              <span className="rounded-full border border-emerald-300 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                来源：{testResponseSourceLabel(result.responseSource)}
                              </span>
                            ) : null}
                          </div>
                          <div className="whitespace-pre-wrap break-words text-xs leading-5 text-emerald-950">
                            {result.responseText}
                          </div>
                        </div>
                      ) : null}
                      {item.lastTest?.testedAt ? (
                        <span className="text-xs text-zinc-500">
                          上次测试：{toDateTimeLabel(item.lastTest.testedAt)}（
                          {item.lastTest.status === "success" ? "通过" : "失败"}）
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <FaMagic aria-hidden /> 模型识别
                      <HelpHint text="读取这组地址和 Key 可见的模型列表，帮助你先知道有哪些模型可以选。" />
                    </span>
                    <div className="grid gap-1">
                      <span
                        className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${statusPillClass(probe.status)}`}
                      >
                        <StatusIcon status={probe.status} />
                        <span>
                          {probe.status === "idle"
                            ? "未识别"
                            : probe.status === "pending"
                              ? "识别中..."
                              : probe.status === "success"
                                ? "识别成功"
                                : "识别失败"}
                        </span>
                      </span>
                      {probe.recommendedModel ? (
                        <span className="text-xs text-zinc-600">推荐模型：{probe.recommendedModel}</span>
                      ) : null}
                      {probe.supportedModels.length > 0 ? (
                        <button
                          type="button"
                          className="inline-flex w-fit items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                          onClick={() => openProbeDialog(item)}
                        >
                          <FaMagic aria-hidden />
                          <span>查看 {probe.supportedModels.length} 个模型</span>
                        </button>
                      ) : null}
                      {probe.detail ? <span className="text-xs text-zinc-500">{probe.detail}</span> : null}
                      {probe.testedAt ? (
                        <span className="text-xs text-zinc-500">最近识别：{toDateTimeLabel(probe.testedAt)}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <FaBolt aria-hidden /> 性能评测
                      <HelpHint text="对已识别到的模型做响应速度测试，帮你挑一个更适合日常使用的默认模型。" />
                    </span>
                    <div className="grid min-w-0 gap-1.5">
                      <span
                        className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                          currentBenchmark ? statusPillClass(currentBenchmark.status) : statusPillClass("idle")
                        }`}
                      >
                        <StatusIcon status={currentBenchmark?.status || "idle"} />
                        <span>{currentBenchmark ? benchmarkStatusLabel(currentBenchmark) : "未测试"}</span>
                      </span>
                      {currentBenchmark?.speed?.medianMs ? (
                        <span className="break-all text-xs leading-5 text-zinc-600">
                          当前中位：{formatDurationLabel(currentBenchmark.speed.medianMs)}
                        </span>
                      ) : null}
                      {currentBenchmark?.speed?.firstTokenMedianMs ? (
                        <span className="break-all text-xs leading-5 text-zinc-600">
                          当前首字：{formatDurationLabel(currentBenchmark.speed.firstTokenMedianMs)}
                        </span>
                      ) : null}
                      {finishedBenchmarks.length > 0 ? (
                        <span className="break-all text-xs leading-5 text-zinc-500">已测：{finishedBenchmarks.length} 个模型</span>
                      ) : null}
                      {fastestBenchmark?.speed?.medianMs ? (
                        <span className="break-all text-xs leading-5 text-zinc-500">
                          最快：{fastestBenchmark.model} · {formatDurationLabel(fastestBenchmark.speed.medianMs)}
                        </span>
                      ) : null}
                      {quickestFirstTokenBenchmark?.speed?.firstTokenMedianMs ? (
                        <span className="break-all text-xs leading-5 text-zinc-500">
                          首字最快：{quickestFirstTokenBenchmark.model} ·{" "}
                          {formatDurationLabel(quickestFirstTokenBenchmark.speed.firstTokenMedianMs)}
                        </span>
                      ) : null}
                      {recommendedBenchmark ? (
                        <span className="break-all text-xs leading-5 text-zinc-500">
                          推荐默认：{recommendedBenchmark.model}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 border-t border-zinc-200 pt-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex items-center gap-2 overflow-x-auto">
                    {isDisabled ? (
                      <button
                        type="button"
                        className={smallBtn}
                        onClick={() => enableConfig(item.id)}
                        title="启用"
                        aria-label="启用"
                      >
                        <FaCheckCircle aria-hidden />
                        <span>启用</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={smallBtn}
                          onClick={() => testConfig(item)}
                          disabled={testing}
                          title="测试"
                          aria-label="测试"
                        >
                          {testing ? <FaSpinner className="animate-spin" aria-hidden /> : <FaBolt aria-hidden />}
                          <span>测试</span>
                        </button>
                        <button
                          type="button"
                          className={smallBtn}
                          onClick={() => probeConfig(item)}
                          disabled={probing}
                          title="识别模型"
                          aria-label="识别模型"
                        >
                          {probing ? <FaSpinner className="animate-spin" aria-hidden /> : <FaMagic aria-hidden />}
                          <span>识别模型</span>
                        </button>
                        <button
                          type="button"
                          className={smallBtn}
                          onClick={() => openBenchmarkDialog(item)}
                          disabled={probe.supportedModels.length === 0}
                          title={probe.supportedModels.length > 0 ? "性能评测" : "请先识别模型"}
                          aria-label={probe.supportedModels.length > 0 ? "性能评测" : "请先识别模型"}
                        >
                          <FaVial aria-hidden />
                          <span>性能评测</span>
                        </button>
                        <button
                          type="button"
                          className={smallBtn}
                          onClick={() => disableConfig(item.id)}
                          title="禁用"
                          aria-label="禁用"
                        >
                          <FaBan aria-hidden />
                          <span>禁用</span>
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-start gap-2 overflow-x-auto sm:justify-end">
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={() => copyText(formatConfig(item, "txt"), `已复制：${item.name}`)}
                      title="复制"
                      aria-label="复制"
                    >
                      <FaCopy aria-hidden />
                      <span>复制</span>
                    </button>
                    <ExportMenu
                      onExport={(type) => exportOne(item, type)}
                      extraActions={[{ label: "导出到 CC Switch", onClick: () => openCcSwitchDialog(item), tone: "accent" }]}
                      label="导出·CC"
                      size="small"
                    />
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={() => startEdit(item)}
                      title="编辑"
                      aria-label="编辑"
                    >
                      <FaEdit aria-hidden />
                      <span>编辑</span>
                    </button>
                    <button
                      type="button"
                      className={smallDangerBtn}
                      onClick={() => removeConfig(item.id)}
                      title="删除"
                      aria-label="删除"
                    >
                      <FaTrashAlt aria-hidden />
                      <span>删除</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </li>
    );
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNoticeState(null), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const nextIndex = useMemo(() => configs.length + 1, [configs.length]);
  const ccSwitchDialogItem = useMemo(
    () => configs.find((item) => item.id === ccSwitchDialogId) || null,
    [configs, ccSwitchDialogId]
  );
  const probeDialogItem = useMemo(() => configs.find((item) => item.id === probeDialogId) || null, [configs, probeDialogId]);
  const benchmarkDialogItem = useMemo(
    () => configs.find((item) => item.id === benchmarkDialogId) || null,
    [benchmarkDialogId, configs]
  );
  const activeProbeDialogProbe = useMemo(() => {
    if (!benchmarkDialogItem) return defaultProbeResult();
    return probeMap[benchmarkDialogItem.id] || benchmarkDialogItem.probe || defaultProbeResult();
  }, [benchmarkDialogItem, probeMap]);
  const probeDialogModels = useMemo(() => {
    if (!benchmarkDialogItem) return [];

    const benchmarkByModel = {
      ...(benchmarkDialogItem.benchmarks || {}),
      ...(benchmarkMap[benchmarkDialogItem.id] || {})
    };

    return activeProbeDialogProbe.supportedModels.map((model) => {
      const tags = inferModelTags(model);
      const benchmark = benchmarkByModel[model] || defaultModelBenchmarkResult(model);
      return {
        model,
        tags,
        benchmark,
        benchmarkable: isLikelyChatBenchmarkable(model, tags),
        isCurrent: benchmarkDialogItem.model === model
      };
    });
  }, [activeProbeDialogProbe, benchmarkDialogItem, benchmarkMap]);
  const benchmarkRounds = useMemo(() => getBenchmarkRounds(benchmarkRoundsInput), [benchmarkRoundsInput]);
  const filteredProbeModels = useMemo(() => {
    const query = benchmarkSearch.trim().toLowerCase();
    return [...probeDialogModels]
      .filter((item) => !query || item.model.toLowerCase().includes(query) || item.tags.some((tag) => tag.toLowerCase().includes(query)))
      .sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
        return left.model.localeCompare(right.model);
      });
  }, [benchmarkSearch, probeDialogModels]);
  const visibleBenchmarkableModels = useMemo(
    () => filteredProbeModels.filter((item) => item.benchmarkable).map((item) => item.model),
    [filteredProbeModels]
  );
  const selectedBenchmarkableModels = useMemo(
    () =>
      probeDialogModels
        .filter((item) => selectedProbeModels.includes(item.model) && item.benchmarkable)
        .map((item) => item.model),
    [probeDialogModels, selectedProbeModels]
  );
  const benchmarkActionModels = selectedBenchmarkableModels.length > 0 ? selectedBenchmarkableModels : visibleBenchmarkableModels;
  const activeBenchmarkBatch =
    benchmarkDialogItem && benchmarkBatch?.configId === benchmarkDialogItem.id ? benchmarkBatch : null;
  const activeBenchmarkProgressPercent = useMemo(() => {
    if (!activeBenchmarkBatch) return 0;
    const totalRounds = Math.max(1, activeBenchmarkBatch.total * activeBenchmarkBatch.rounds);
    const completedRounds = activeBenchmarkBatch.done * activeBenchmarkBatch.rounds;
    const currentRound = activeBenchmarkBatch.currentRound ? Math.max(0, activeBenchmarkBatch.currentRound - 1) : 0;
    return Math.min(100, Math.round(((completedRounds + currentRound) / totalRounds) * 100));
  }, [activeBenchmarkBatch]);
  const mergedBenchmarkByModel = useMemo(
    () =>
      benchmarkDialogItem
        ? {
            ...(benchmarkDialogItem.benchmarks || {}),
            ...(benchmarkMap[benchmarkDialogItem.id] || {})
          }
        : {},
    [benchmarkDialogItem, benchmarkMap]
  );
  const allFinishedBenchmarkResults = useMemo(() => {
    const modelsFromProbe = probeDialogModels.map((item) => item.model);
    const modelsFromResults = Object.keys(mergedBenchmarkByModel);
    const models = uniqueStrings([...modelsFromProbe, ...modelsFromResults]);

    return models
      .map((model) => {
        const result = mergedBenchmarkByModel[model];
        return result && (result.status === "success" || result.status === "error") ? result : null;
      })
      .filter((item): item is FinishedModelBenchmarkResult => Boolean(item))
      .sort((left, right) => {
        const leftCurrent = benchmarkDialogItem?.model === left.model;
        const rightCurrent = benchmarkDialogItem?.model === right.model;
        if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
        return new Date(right.testedAt).getTime() - new Date(left.testedAt).getTime();
      });
  }, [benchmarkDialogItem?.model, mergedBenchmarkByModel, probeDialogModels]);
  const storedBenchmarkSummary = useMemo(() => {
    if (!benchmarkDialogItem) return null;
    return (
      benchmarkSummaryMap[benchmarkDialogItem.id] ||
      buildBenchmarkSummary(benchmarkDialogItem.id, allFinishedBenchmarkResults, benchmarkRounds)
    );
  }, [benchmarkDialogItem, allFinishedBenchmarkResults, benchmarkRounds, benchmarkSummaryMap]);
  const activeBenchmarkScopeModels = useMemo(() => {
    if (activeBenchmarkBatch?.models.length) return activeBenchmarkBatch.models;
    if (storedBenchmarkSummary?.models.length) return storedBenchmarkSummary.models;
    return [];
  }, [activeBenchmarkBatch, storedBenchmarkSummary]);
  const benchmarkResults = useMemo(() => {
    if (activeBenchmarkScopeModels.length === 0) return allFinishedBenchmarkResults;

    return activeBenchmarkScopeModels
      .map((model) => {
        const result = mergedBenchmarkByModel[model];
        return result && (result.status === "success" || result.status === "error") ? result : null;
      })
      .filter((item): item is FinishedModelBenchmarkResult => Boolean(item))
      .sort((left, right) => {
        const leftCurrent = benchmarkDialogItem?.model === left.model;
        const rightCurrent = benchmarkDialogItem?.model === right.model;
        if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
        return new Date(right.testedAt).getTime() - new Date(left.testedAt).getTime();
      });
  }, [activeBenchmarkScopeModels, allFinishedBenchmarkResults, benchmarkDialogItem?.model, mergedBenchmarkByModel]);
  const activeBenchmarkSummary = useMemo(() => {
    if (!benchmarkDialogItem) return null;
    if (activeBenchmarkBatch) {
      return buildBenchmarkSummary(
        benchmarkDialogItem.id,
        benchmarkResults,
        activeBenchmarkBatch.rounds,
        activeBenchmarkBatch.models
      );
    }
    return storedBenchmarkSummary;
  }, [activeBenchmarkBatch, benchmarkDialogItem, benchmarkResults, storedBenchmarkSummary]);
  const failedBenchmarkResults = useMemo(
    () => benchmarkResults.filter((item) => item.status === "error"),
    [benchmarkResults]
  );
  const chartReadyBenchmarkResults = useMemo(
    () => benchmarkResults.filter((item) => item.speed && item.status === "success"),
    [benchmarkResults]
  );
  const activeBenchmarkChartResult = useMemo(
    () => chartReadyBenchmarkResults.find((item) => item.model === benchmarkChartModel) || chartReadyBenchmarkResults[0] || null,
    [benchmarkChartModel, chartReadyBenchmarkResults]
  );
  const activeBenchmarkDetailResult = useMemo(
    () => benchmarkResults.find((item) => item.model === benchmarkDetailModel) || null,
    [benchmarkDetailModel, benchmarkResults]
  );
  const benchmarkComparisonChartOption = useMemo<EChartsOption | null>(() => {
    if (chartReadyBenchmarkResults.length === 0) return null;

    const sortedResults = [...chartReadyBenchmarkResults].sort(
      (left, right) => (left.speed?.avgMs || Number.POSITIVE_INFINITY) - (right.speed?.avgMs || Number.POSITIVE_INFINITY)
    );

    return {
      animationDuration: 260,
      grid: {
        left: 18,
        right: 18,
        top: 20,
        bottom: 10,
        containLabel: true
      },
      legend: {
        top: 0,
        textStyle: {
          color: "#334155",
          fontSize: 11
        }
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        valueFormatter: (value) => formatDurationLabel(typeof value === "number" ? value : undefined)
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatDurationLabel(value)
        },
        splitLine: {
          lineStyle: {
            color: "#e2e8f0"
          }
        }
      },
      yAxis: {
        type: "category",
        axisLabel: {
          color: "#0f172a",
          width: 180,
          overflow: "truncate"
        },
        data: sortedResults.map((item) => item.model)
      },
      series: [
        {
          name: "平均耗时",
          type: "bar",
          barMaxWidth: 14,
          itemStyle: {
            color: "#16a34a",
            borderRadius: [0, 8, 8, 0]
          },
          data: sortedResults.map((item) => item.speed?.avgMs || 0)
        },
        {
          name: "中位耗时",
          type: "bar",
          barMaxWidth: 14,
          itemStyle: {
            color: "#0f172a",
            borderRadius: [0, 8, 8, 0]
          },
          data: sortedResults.map((item) => item.speed?.medianMs || 0)
        }
      ]
    };
  }, [chartReadyBenchmarkResults]);
  const benchmarkRoundChartOption = useMemo<EChartsOption | null>(() => {
    if (!activeBenchmarkChartResult?.speed) return null;

    const roundDetails = getBenchmarkRoundDetails(activeBenchmarkChartResult);
    const elapsedValues = roundDetails.map((item) => item.elapsedMs ?? null);
    const firstTokenValues = roundDetails.map((item) => item.firstTokenMs ?? null);

    return {
      animationDuration: 260,
      grid: {
        left: 20,
        right: 20,
        top: 24,
        bottom: 18,
        containLabel: true
      },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatDurationLabel(typeof value === "number" ? value : undefined)
      },
      legend: {
        top: 0,
        textStyle: {
          color: "#334155",
          fontSize: 11
        }
      },
      xAxis: {
        type: "category",
        axisLabel: {
          color: "#64748b"
        },
        data: roundDetails.map((item) => `第${item.round}轮`)
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatDurationLabel(value)
        },
        splitLine: {
          lineStyle: {
            color: "#e2e8f0"
          }
        }
      },
      series: [
        {
          name: "总耗时",
          type: "bar",
          barMaxWidth: 26,
          itemStyle: {
            color: "#0f172a",
            borderRadius: [8, 8, 0, 0]
          },
          markLine: {
            symbol: "none",
            label: {
              color: "#0f172a",
              formatter: ({ name, value }) => `${name} ${formatDurationLabel(typeof value === "number" ? value : undefined)}`
            },
            lineStyle: {
              type: "dashed",
              color: "#16a34a"
            },
            data: [
              { name: "平均", yAxis: activeBenchmarkChartResult.speed.avgMs },
              { name: "中位", yAxis: activeBenchmarkChartResult.speed.medianMs }
            ]
          },
          data: elapsedValues
        },
        {
          name: "首字时间",
          type: "line",
          smooth: true,
          connectNulls: false,
          itemStyle: {
            color: "#f59e0b"
          },
          lineStyle: {
            width: 2,
            color: "#f59e0b"
          },
          data: firstTokenValues
        }
      ]
    };
  }, [activeBenchmarkChartResult]);

  useEffect(() => {
    if (!benchmarkDialogItem) return;

    const nextModel =
      chartReadyBenchmarkResults.find((item) => item.model === benchmarkChartModel)?.model ||
      activeBenchmarkSummary?.recommendedModel ||
      activeBenchmarkSummary?.fastestModel ||
      chartReadyBenchmarkResults[0]?.model ||
      "";

    if (nextModel !== benchmarkChartModel) {
      setBenchmarkChartModel(nextModel);
    }
  }, [activeBenchmarkSummary, benchmarkChartModel, benchmarkDialogItem, chartReadyBenchmarkResults]);

  useEffect(() => {
    const hasOverlayOpen = Boolean(benchmarkDialogItem || probeDialogItem || ccSwitchDialogItem);
    if (!hasOverlayOpen) return;

    const body = document.body;
    const html = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const previousHtmlOverflow = html.style.overflow;
    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);

    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      html.style.overflow = previousHtmlOverflow;
    };
  }, [benchmarkDialogItem, ccSwitchDialogItem, probeDialogItem]);

  function ExportMenu({
    onExport,
    extraActions = [],
    label = "导出",
    size = "default",
    triggerClassName
  }: {
    onExport: (type: ExportType) => void;
    extraActions?: CcSwitchAction[];
    label?: string;
    size?: "default" | "small";
    triggerClassName?: string;
  }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const menuItemClass = "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition";
    const triggerClass =
      triggerClassName || (size === "small" ? `${smallBtn} list-none` : `${btnGhost} list-none`);

    useEffect(() => {
      if (!open) return;

      function handlePointerDown(event: MouseEvent) {
        if (!menuRef.current?.contains(event.target as Node)) {
          setOpen(false);
        }
      }

      function handleEscape(event: KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
      }

      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handlePointerDown);
        document.removeEventListener("keydown", handleEscape);
      };
    }, [open]);

    function handle(type: ExportType) {
      onExport(type);
      setOpen(false);
    }

    function handleExtra(action: () => void) {
      action();
      setOpen(false);
    }

    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className={`${triggerClass} cursor-pointer [&::-webkit-details-marker]:hidden`}
          title={label}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          <FaFileExport aria-hidden />
          <span>{label}</span>
        </button>
        {open ? (
          <div className="absolute right-0 z-20 mt-1 w-56 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-1.5 shadow-lg">
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              常规导出
            </div>
            <button
              type="button"
              className={`${menuItemClass} text-zinc-700 hover:bg-zinc-100`}
              onClick={() => handle("md")}
            >
              导出 .md
            </button>
            <button
              type="button"
              className={`${menuItemClass} text-zinc-700 hover:bg-zinc-100`}
              onClick={() => handle("txt")}
            >
              导出 .txt
            </button>
            {extraActions.length > 0 ? (
              <>
                <div className="my-1 border-t border-zinc-200" />
                <div className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-500">
                  CC Switch
                </div>
              </>
            ) : null}
            {extraActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`${menuItemClass} ${
                  action.tone === "accent"
                    ? "bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
                onClick={() => handleExtra(action.onClick)}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function applyPaste() {
    const parsed = parsePastedConfigs(pasteRaw, nextIndex);
    if (parsed.length === 0) {
      setNotice("未识别到完整配置");
      return;
    }

    setForm({
      name: parsed[0].name,
      baseUrl: parsed[0].baseUrl,
      apiKey: parsed[0].apiKey,
      model: parsed[0].model,
      apiFormat: parsed[0].apiFormat || "auto"
    });
    setFormSourceMeta(parsed[0].sourceMeta);
    if (parsed.length > 1) {
      setNotice(`已识别 ${parsed.length} 个配置，点击“粘贴并直接新增”可一次导入`);
    } else {
      setNotice("已解析到表单");
    }
  }

  function addItem(
    name: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    apiFormat: OpenAIProxyApiFormat,
    sourceMeta?: KeyConfig["sourceMeta"]
  ) {
    const item: KeyConfig = {
      id: createClientId(),
      name,
      baseUrl,
      apiKey,
      model,
      apiFormat,
      listStatus: "success",
      createdAt: new Date().toISOString(),
      sourceMeta: sourceMeta || { kind: "manual" }
    };
    setConfigs((prev) => [item, ...prev]);
    revealSavedConfig(item.id);
    setForm({ name: "", baseUrl: "", apiKey: "", model: "", apiFormat: "auto" });
    setFormSourceMeta(undefined);
    setPasteRaw("");
  }

  function prependParsedConfigs(parsed: ParsedConfig[], noticeText: string) {
    if (parsed.length === 0) {
      setNotice("未识别到可导入配置");
      return;
    }

    const newItems = createKeyConfigsFromParsed(parsed);
    setConfigs((prev) => [...newItems, ...prev]);
    revealSavedConfig(newItems[0].id);
    setForm({ name: "", baseUrl: "", apiKey: "", model: "", apiFormat: "auto" });
    setFormSourceMeta(undefined);
    setPasteRaw("");
    setNotice(noticeText.replace("{count}", String(newItems.length)));
  }

  function addFromPaste() {
    if (!isConfigStoreReady) {
      setNotice(configStoreError || "项目配置正在加载，请稍候");
      return;
    }

    const parsed = parsePastedConfigs(pasteRaw, nextIndex);
    if (parsed.length === 0) {
      setNotice("未识别到可插入字段");
      return;
    }

    prependParsedConfigs(parsed, "已新增 {count} 个配置");
  }

  function openCcSwitchSqlFilePicker() {
    ccSwitchSqlInputRef.current?.click();
  }

  async function importCcSwitchSqlFile(file: File) {
    const content = await file.text();
    const parsed = parsePastedConfigs(content, nextIndex);
    if (parsed.length === 0) {
      setNotice("未从 cc-switch SQL 中识别到可导入配置");
      return;
    }

    prependParsedConfigs(parsed, "已从 cc-switch SQL 导入 {count} 个配置");
  }

  async function handleCcSwitchSqlFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      await importCcSwitchSqlFile(file);
    } catch {
      setNotice("读取 cc-switch SQL 文件失败");
    }
  }

  function addConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isConfigStoreReady) {
      setNotice(configStoreError || "项目配置正在加载，请稍候");
      return;
    }

    const baseUrl = normalizeBaseUrl(form.baseUrl);
    const apiKey = cleanKey(form.apiKey);
    const model = form.model.trim();
    let name = form.name.trim();

    if (!baseUrl && !apiKey && !model) {
      setNotice("请至少填写地址、Key、模型中的一个");
      return;
    }
    if (!name) name = makeDefaultName(nextIndex);

    addItem(name, baseUrl, apiKey, model, form.apiFormat, formSourceMeta);
    setNotice("保存成功，已定位到成功列表");
  }

  function removeConfig(id: string) {
    setConfigs((prev) => prev.filter((i) => i.id !== id));
    setResultMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setProbeMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setBenchmarkMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (editingModelId === id) {
      setEditingModelId(null);
      setModelDraft("");
    }
    if (ccSwitchDialogId === id) {
      setCcSwitchDialogId(null);
    }
    if (probeDialogId === id) {
      setProbeDialogId(null);
    }
    if (benchmarkDialogId === id) {
      setBenchmarkDialogId(null);
    }
    setNotice("已删除");
  }

  function removeAllConfigs() {
    if (configs.length === 0) {
      setNotice("暂无配置可删除");
      return;
    }

    const confirmed = window.confirm(`确认删除全部 ${configs.length} 条配置吗？此操作不可恢复。`);
    if (!confirmed) return;

    setConfigs([]);
    setResultMap({});
    setProbeMap({});
    setBenchmarkMap({});
    setLoadingMap({});
    setEditingId(null);
    setEditingModelId(null);
    setModelDraft("");
    setFormSourceMeta(undefined);
    setCcSwitchDialogId(null);
    setProbeDialogId(null);
    setBenchmarkDialogId(null);
    setNotice("已删除全部配置");
  }

  function commitFinishedTestResult(id: string, result: FinishedTestResult) {
    setResultMap((prev) => ({ ...prev, [id]: result }));
    setConfigs((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        // 禁用列表只更新测试结果，不因测试成功/失败而离开禁用列表
        if (item.listStatus === "disabled") {
          return { ...item, lastTest: result };
        }
        return {
          ...item,
          lastTest: result,
          listStatus: result.status === "error" ? "failed" : "success"
        };
      })
    );
  }

  function disableConfig(id: string) {
    const target = configs.find((item) => item.id === id);
    setConfigs((prev) => prev.map((item) => (item.id === id ? { ...item, listStatus: "disabled" } : item)));
    setActiveList("disabled");
    ensureCollapsed(id);
    setHighlightedConfigId(id);
    setNotice(target ? `已禁用：${target.name}` : "已移入禁用列表");
    window.setTimeout(() => {
      setHighlightedConfigId((currentId) => (currentId === id ? null : currentId));
    }, 2200);
  }

  function enableConfig(id: string) {
    const target = configs.find((item) => item.id === id);
    // 启用后固定进入成功列表，保持折叠
    setConfigs((prev) => prev.map((item) => (item.id === id ? { ...item, listStatus: "success" } : item)));
    setActiveList("all");
    ensureCollapsed(id);
    setHighlightedConfigId(id);
    setNotice(target ? `已启用：${target.name}` : "已启用配置");
    window.setTimeout(() => {
      setHighlightedConfigId((currentId) => (currentId === id ? null : currentId));
    }, 2200);
  }

  function commitFinishedProbeResult(id: string, result: FinishedProbeResult) {
    setProbeMap((prev) => ({ ...prev, [id]: result }));
    setConfigs((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              probe: result,
              model: !item.model && result.recommendedModel ? result.recommendedModel : item.model
            }
          : item
        )
    );
  }

  function commitFinishedBenchmarkResult(id: string, model: string, result: FinishedModelBenchmarkResult) {
    setBenchmarkMap((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [model]: result
      }
    }));
    setConfigs((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              benchmarks: {
                ...(item.benchmarks || {}),
                [model]: result
              }
            }
          : item
      )
    );
  }

  function setPendingBenchmarkResult(id: string, model: string, tags: string[]) {
    setBenchmarkMap((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [model]: {
          ...(prev[id]?.[model] || defaultModelBenchmarkResult(model)),
          status: "pending",
          model,
          tags,
          detail: "测试中..."
        }
      }
    }));
  }

  function setPendingBenchmarkResults(id: string, models: string[]) {
    const uniqueModels = uniqueStrings(models);
    if (uniqueModels.length === 0) return;

    setBenchmarkMap((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        ...Object.fromEntries(
          uniqueModels.map((model) => [
            model,
            {
              ...(prev[id]?.[model] || defaultModelBenchmarkResult(model)),
              status: "pending" as const,
              model,
              tags: inferModelTags(model),
              detail: "测试中..."
            }
          ])
        )
      }
    }));
  }

  async function runTest(item: KeyConfig): Promise<boolean> {
    if (getConfigListStatus(item) === "disabled") {
      setNotice(`${item.name} 已禁用，无法测试`);
      return false;
    }

    setLoadingMap((prev) => ({ ...prev, [item.id]: true }));
    setResultMap((prev) => ({ ...prev, [item.id]: { status: "pending", message: "测试中..." } }));

    const baseUrl = toOpenAIBaseUrl(item.baseUrl);
    const apiKey = cleanKey(item.apiKey);

    if (!baseUrl || !apiKey) {
      commitFinishedTestResult(item.id, {
        status: "error",
        message: FAIL_TEXT,
        detail: "地址或 Key 为空",
        testedAt: new Date().toISOString()
      });
      setLoadingMap((prev) => ({ ...prev, [item.id]: false }));
      return false;
    }

    try {
      const response = await postJsonWithTimeout<OpenAIProxyTestResponse>(
        "/api/openai/test",
        {
          baseUrl,
          apiKey,
          model: item.model || "gpt-4o-mini",
          apiFormat: item.apiFormat || "auto"
        },
        45000
      );

      commitFinishedTestResult(item.id, response.result);
      return response.ok;
    } catch (error: unknown) {
      commitFinishedTestResult(item.id, {
        status: "error",
        message: FAIL_TEXT,
        detail: makeErrorDetail(error),
        testedAt: new Date().toISOString()
      });
      return false;
    } finally {
      setLoadingMap((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function testConfig(item: KeyConfig) {
    if (getConfigListStatus(item) === "disabled") {
      setNotice(`${item.name} 已禁用，无法测试`);
      return;
    }
    const ok = await runTest(item);
    setNotice(ok ? `${item.name} 测试通过` : `${item.name} 测试失败`);
  }

  async function runModelProbe(item: KeyConfig): Promise<boolean> {
    setProbeMap((prev) => ({
      ...prev,
      [item.id]: {
        status: "pending",
        supportedModels: item.probe?.supportedModels || []
      }
    }));

    const baseUrl = toOpenAIBaseUrl(item.baseUrl);
    const apiKey = cleanKey(item.apiKey);

    if (!baseUrl || !apiKey) {
      commitFinishedProbeResult(item.id, {
        status: "error",
        supportedModels: [],
        detail: "地址或 Key 为空，无法探测模型",
        testedAt: new Date().toISOString()
      });
      return false;
    }

    try {
      const response = await postJsonWithTimeout<OpenAIProxyProbeResponse>(
        "/api/openai/probe",
        {
          baseUrl,
          apiKey,
          currentModel: item.model
        },
        20000
      );
      commitFinishedProbeResult(item.id, response.result);
      return response.ok;
    } catch (error: unknown) {
      commitFinishedProbeResult(item.id, {
        status: "error",
        supportedModels: [],
        detail: makeErrorDetail(error),
        testedAt: new Date().toISOString()
      });
      return false;
    }
  }

  async function runModelBenchmark(
    item: KeyConfig,
    model: string,
    rounds: number,
    onRoundStart?: (modelName: string, roundIndex: number) => void
  ): Promise<FinishedModelBenchmarkResult | null> {
    const baseUrl = toOpenAIBaseUrl(item.baseUrl);
    const apiKey = cleanKey(item.apiKey);
    const tags = inferModelTags(model);

    setPendingBenchmarkResult(item.id, model, tags);

    if (!baseUrl || !apiKey) {
      commitFinishedBenchmarkResult(item.id, model, {
        status: "error",
        model,
        tags,
        detail: "地址或 Key 为空，无法执行模型测试",
        testedAt: new Date().toISOString()
      });
      return null;
    }

    const elapsedSamples: number[] = [];
    const firstTokenSamples: number[] = [];
    const speedErrors: string[] = [];
    const roundDetails: BenchmarkRoundDetail[] = [];

    for (let round = 0; round < rounds; round += 1) {
      onRoundStart?.(model, round + 1);
      try {
        const response = await postJsonWithTimeout<OpenAIProxyBenchmarkRoundResponse>(
          "/api/openai/benchmark",
          {
            baseUrl,
            apiKey,
            model
          },
          25000
        );

        if (response.ok && response.sample) {
          elapsedSamples.push(response.sample.elapsedMs);
          if (typeof response.sample.firstTokenMs === "number") {
            firstTokenSamples.push(response.sample.firstTokenMs);
          }
          roundDetails.push({
            round: round + 1,
            ok: true,
            elapsedMs: response.sample.elapsedMs,
            firstTokenMs: response.sample.firstTokenMs
          });
          continue;
        }

        const errorDetail = response.error || "测速失败，未返回可读内容";
        speedErrors.push(errorDetail);
        roundDetails.push({
          round: round + 1,
          ok: false,
          error: errorDetail
        });
      } catch (error: unknown) {
        const errorDetail = makeErrorDetail(error);
        speedErrors.push(errorDetail);
        roundDetails.push({
          round: round + 1,
          ok: false,
          error: errorDetail
        });
      }
    }

    if (elapsedSamples.length === 0) {
      commitFinishedBenchmarkResult(item.id, model, {
        status: "error",
        model,
        tags,
        speed: {
          rounds,
          medianMs: 0,
          avgMs: 0,
          successRate: 0,
          stabilityMs: 0,
          samplesMs: [],
          roundDetails
        },
        detail: uniqueStrings(speedErrors)[0] || "测速失败，模型未返回可读内容",
        testedAt: new Date().toISOString()
      });
      return null;
    }

    const medianMs = medianOf(elapsedSamples);
    const avgMs = averageOf(elapsedSamples);
    const firstTokenMedianMs = firstTokenSamples.length > 0 ? medianOf(firstTokenSamples) : undefined;
    const firstTokenAvgMs = firstTokenSamples.length > 0 ? averageOf(firstTokenSamples) : undefined;
    const successRate = elapsedSamples.length / rounds;
    const stabilityMs = computeStability(elapsedSamples);
    const detailParts = [
      `成功 ${elapsedSamples.length}/${rounds}`,
      firstTokenMedianMs ? `首字中位 ${formatDurationLabel(firstTokenMedianMs)}` : "",
      `中位耗时 ${formatDurationLabel(medianMs)}`,
      `波动 ${formatDurationLabel(stabilityMs)}`,
      speedErrors.length > 0 ? `异常：${uniqueStrings(speedErrors)[0]}` : "",
    ].filter(Boolean);

    const result: FinishedModelBenchmarkResult = {
      status: "success",
      model,
      tags,
      speed: {
        rounds,
        medianMs,
        avgMs,
        successRate,
        stabilityMs,
        samplesMs: elapsedSamples,
        firstTokenMedianMs,
        firstTokenAvgMs,
        firstTokenSamplesMs: firstTokenSamples.length > 0 ? firstTokenSamples : undefined,
        roundDetails
      },
      detail: detailParts.join("；"),
      testedAt: new Date().toISOString()
    };
    commitFinishedBenchmarkResult(item.id, model, result);
    return result;
  }

  async function benchmarkModels(item: KeyConfig, models: string[], rounds: number) {
    const uniqueModels = uniqueStrings(models);
    const benchmarkableModels = uniqueModels.filter((model) => isLikelyChatBenchmarkable(model));
    const skipped = uniqueModels.length - benchmarkableModels.length;

    if (benchmarkableModels.length === 0) {
      setNotice(skipped > 0 ? `已跳过 ${skipped} 个非对话模型` : "没有可测试的模型");
      return;
    }

    setPendingBenchmarkResults(item.id, benchmarkableModels);
    setBenchmarkBatch({
      configId: item.id,
      models: benchmarkableModels,
      rounds,
      done: 0,
      total: benchmarkableModels.length,
      skipped,
      currentModel: benchmarkableModels[0],
      currentRound: 1
    });
    setBenchmarkListCollapsed(true);

    let okCount = 0;
    const successfulBenchmarks: FinishedModelBenchmarkResult[] = [];
    for (let index = 0; index < benchmarkableModels.length; index += 1) {
      const model = benchmarkableModels[index];
      setBenchmarkBatch((prev) =>
        prev && prev.configId === item.id
          ? {
              ...prev,
              currentModel: model,
              currentRound: 1
            }
          : prev
      );
      const result = await runModelBenchmark(item, model, rounds, (modelName, roundIndex) => {
        setBenchmarkBatch((prev) =>
          prev && prev.configId === item.id
            ? {
                ...prev,
                currentModel: modelName,
                currentRound: roundIndex
              }
            : prev
        );
      });
      if (result) {
        okCount += 1;
        successfulBenchmarks.push(result);
      }

      setBenchmarkBatch((prev) =>
        prev && prev.configId === item.id
          ? {
              ...prev,
              done: index + 1
            }
          : prev
      );
    }

    const fastest = pickFastestBenchmark(successfulBenchmarks);
    const quickestFirstToken = pickQuickestFirstTokenBenchmark(successfulBenchmarks);
    const mostStable = pickMostStableBenchmark(successfulBenchmarks);
    const recommended = pickRecommendedBenchmark(successfulBenchmarks);

    setBenchmarkSummaryMap((prev) => ({
      ...prev,
      [item.id]: {
        configId: item.id,
        rounds,
        models: uniqueStrings(benchmarkableModels),
        totalModels: benchmarkableModels.length,
        successModels: okCount,
        fastestModel: fastest?.model,
        fastestMedianMs: fastest?.speed?.medianMs,
        quickestFirstTokenModel: quickestFirstToken?.model,
        quickestFirstTokenMs: quickestFirstToken?.speed?.firstTokenMedianMs,
        mostStableModel: mostStable?.model,
        stabilityMs: mostStable?.speed?.stabilityMs,
        recommendedModel: recommended?.model,
        finishedAt: new Date().toISOString()
      }
    }));
    setBenchmarkBatch(null);
    setNotice(
      `模型测试完成：成功 ${okCount}，失败 ${benchmarkableModels.length - okCount}${skipped > 0 ? `，跳过 ${skipped}` : ""}`
    );
  }

  async function probeConfig(item: KeyConfig) {
    const ok = await runModelProbe(item);
    setProbeDialogId(item.id);
    setNotice(ok ? `${item.name} 模型探测完成` : `${item.name} 模型探测失败`);
  }

  async function probeAllConfigs() {
    if (activeList === "disabled") {
      setNotice("禁用列表不支持批量识别");
      return;
    }
    if (activeConfigs.length === 0) {
      setNotice(activeList === "failed" ? "暂无失败配置可探测" : "暂无成功配置可探测");
      return;
    }

    const targetConfigs = activeConfigs;
    setProbingAll(true);
    setNotice(`开始探测当前${activeList === "failed" ? "失败" : "成功"}列表模型...`);
    const result = await Promise.all(targetConfigs.map((item) => runModelProbe(item)));
    const okCount = result.filter(Boolean).length;
    setProbingAll(false);
    setNotice(`探测完成：成功 ${okCount}，失败 ${result.length - okCount}`);
  }

  async function testAllConfigs() {
    if (activeList === "disabled") {
      setNotice("禁用列表不支持批量测试");
      return;
    }
    if (activeConfigs.length === 0) {
      setNotice(activeList === "failed" ? "暂无失败配置可测试" : "暂无成功配置可测试");
      return;
    }

    const targetConfigs = activeConfigs;
    setTestingAll(true);
    setNotice(`开始测试当前${activeList === "failed" ? "失败" : "成功"}列表配置...`);
    const result = await Promise.all(targetConfigs.map((item) => runTest(item)));
    const passCount = result.filter(Boolean).length;
    const failCount = result.length - passCount;
    setTestingAll(false);
    setNotice(`测试完成：通过 ${passCount}，失败 ${failCount}`);
  }

  async function copyText(text: string, okText: string) {
    if (!text) {
      setNotice("没有可复制的内容");
      return;
    }

    // 优先 execCommand：在用户点击手势内同步执行，不弹浏览器剪贴板权限，
    // 也兼容 HTTP / 局域网 IP 等非安全上下文。
    if (copyTextWithExecCommand(text)) {
      setNotice(okText);
      return;
    }

    // 次选 Clipboard API（仅 HTTPS / localhost 等安全上下文）
    if (typeof window !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setNotice(okText);
        return;
      } catch {
        // 继续走失败提示
      }
    }

    setNotice("复制失败，请手动选择文本后复制");
  }

  // 同步复制：临时 textarea + execCommand，避免 Clipboard API 权限弹窗
  function copyTextWithExecCommand(text: string): boolean {
    if (typeof document === "undefined") return false;

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.setAttribute("aria-hidden", "true");
    // 需在视口内且可聚焦，部分浏览器对 off-screen / display:none 会拒绝 copy
    textarea.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;margin:0;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    let ok = false;
    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    } finally {
      document.body.removeChild(textarea);
      if (selection) {
        selection.removeAllRanges();
        if (previousRange) selection.addRange(previousRange);
      }
    }
    return ok;
  }

  function downloadText(filename: string, content: string) {
    if (!content) {
      setNotice("没有可导出的内容");
      return;
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("导出完成");
  }

  function exportOne(item: KeyConfig, type: ExportType) {
    const filename = `${sanitizeFilename(item.name || "ai-key")}.${type}`;
    const content = formatConfig(item, type);
    downloadText(filename, content);
  }

  function exportAll(type: ExportType) {
    const content = formatAll(configs, type);
    const filename = `ai-key-configs.${type}`;
    downloadText(filename, content);
  }

  function openCcSwitchDialog(item: KeyConfig) {
    if (!item.baseUrl || !item.apiKey) {
      setNotice("导入到 CC Switch 需要完整的地址和 Key");
      return;
    }
    setCcSwitchDialogId(item.id);
    setCcSwitchTargetApp(item.sourceMeta?.ccSwitchApp || "codex");
  }

  function closeCcSwitchDialog() {
    setCcSwitchDialogId(null);
  }

  async function copyCcSwitchLink(item: KeyConfig, app: CcSwitchApp) {
    await copyText(buildCcSwitchDeepLink(item, app), `已复制 CC Switch 链接（${app}）`);
  }

  function importToCcSwitch(item: KeyConfig, app: CcSwitchApp) {
    const link = buildCcSwitchDeepLink(item, app);
    setCcSwitchDialogId(null);
    window.location.assign(link);
    setNotice(`已尝试唤起 CC Switch（${app}）`);
  }

  function openProbeDialog(item: KeyConfig) {
    setBenchmarkDialogId(null);
    setBenchmarkBatch(null);
    setProbeDialogId(item.id);
  }

  function openBenchmarkDialog(item: KeyConfig) {
    const activeProbe = probeMap[item.id] || item.probe || defaultProbeResult();
    if (activeProbe.supportedModels.length === 0) {
      setNotice("请先探测模型，再打开模型测试");
      return;
    }

    setBenchmarkSearch("");
    setBenchmarkRoundsInput(String(DEFAULT_BENCHMARK_ROUNDS));
    const currentModel = item.model.trim();
    if (currentModel && activeProbe.supportedModels.includes(currentModel) && isLikelyChatBenchmarkable(currentModel)) {
      setSelectedProbeModels([currentModel]);
    } else {
      setSelectedProbeModels([]);
    }

    setProbeDialogId(null);
    setBenchmarkChartModel(item.model.trim());
    setBenchmarkListCollapsed(false);
    setBenchmarkDialogId(item.id);
  }

  function closeProbeDialog() {
    setProbeDialogId(null);
    setProbeModelCategory("all");
  }

  function closeBenchmarkDialog() {
    setBenchmarkSearch("");
    setSelectedProbeModels([]);
    setBenchmarkBatch(null);
    setBenchmarkChartModel("");
    setBenchmarkListCollapsed(false);
    setBenchmarkDetailModel("");
    setBenchmarkDialogId(null);
  }

  function toggleProbeModelSelection(model: string) {
    setSelectedProbeModels((prev) => (prev.includes(model) ? prev.filter((item) => item !== model) : [...prev, model]));
  }

  function selectVisibleProbeModels() {
    setSelectedProbeModels(visibleBenchmarkableModels);
  }

  function selectAllProbeModels() {
    setSelectedProbeModels(probeDialogModels.filter((item) => item.benchmarkable).map((item) => item.model));
  }

  function clearSelectedProbeModels() {
    setSelectedProbeModels([]);
  }

  async function copyProbeModels(item: KeyConfig, probe: ProbeResult | FinishedProbeResult) {
    const lines = [
      `名称: ${item.name}`,
      `推荐模型: ${probe.recommendedModel || "(无)"}`,
      `模型数量: ${probe.supportedModels.length}`,
      "",
      ...probe.supportedModels
    ];

    await copyText(lines.join("\n"), `已复制 ${item.name} 的探测模型`);
  }

  async function copySingleProbeModel(model: string) {
    await copyText(model, `已复制模型 ${model}`);
  }

  function applyProbeModel(id: string, model: string) {
    const nextModel = model.trim();
    if (!nextModel) return;

    const original = configs.find((item) => item.id === id);
    const resetLastTest = original ? (original.model || "") !== nextModel : false;

    setConfigs((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, model: nextModel, lastTest: resetLastTest ? undefined : item.lastTest } : item
      )
    );

    if (resetLastTest) {
      setResultMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    if (editingModelId === id) {
      setModelDraft(nextModel);
    }

    setNotice(`已切换为 ${nextModel}`);
  }

  function updateConfigApiFormat(id: string, apiFormat: OpenAIProxyApiFormat) {
    setConfigs((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, apiFormat, lastTest: item.apiFormat === apiFormat ? item.lastTest : undefined } : item
      )
    );
    setResultMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setNotice(`API 格式已切换为 ${apiFormat === "auto" ? "自动兼容" : API_FORMAT_OPTIONS.find((item) => item.value === apiFormat)?.label || apiFormat}`);
  }

  function startEdit(item: KeyConfig) {
    setEditingId(item.id);
    setEditForm({ name: item.name, baseUrl: item.baseUrl, apiKey: item.apiKey, model: item.model, apiFormat: item.apiFormat || "auto" });
  }

  function cancelEdit() {
    const editing = editingId;
    setEditingId(null);
    setEditForm({ name: "", baseUrl: "", apiKey: "", model: "", apiFormat: "auto" });
    // 取消编辑后回到折叠，避免列表里留下展开卡片
    if (editing) ensureCollapsed(editing);
  }

  function saveEdit(id: string) {
    if (!isConfigStoreReady) {
      setNotice(configStoreError || "项目配置正在加载，请稍候");
      return;
    }

    const baseUrl = normalizeBaseUrl(editForm.baseUrl);
    const apiKey = cleanKey(editForm.apiKey);
    const name = editForm.name.trim();
    const model = editForm.model.trim();
    const apiFormat = editForm.apiFormat;

    if (!baseUrl || !apiKey) {
      setNotice("编辑保存失败：地址和 Key 不能为空");
      return;
    }

    const original = configs.find((item) => item.id === id);
    const resetLastTest = original
      ? original.baseUrl !== baseUrl ||
        original.apiKey !== apiKey ||
        (original.model || "") !== model ||
        (original.apiFormat || "auto") !== apiFormat
      : false;
    const resetProbe = original ? original.baseUrl !== baseUrl || original.apiKey !== apiKey : false;
    const resetBenchmarks = resetProbe;

    setConfigs((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              name: name || item.name,
              baseUrl,
              apiKey,
              model,
              apiFormat,
              lastTest: resetLastTest ? undefined : item.lastTest,
              probe: resetProbe ? undefined : item.probe,
              benchmarks: resetBenchmarks ? undefined : item.benchmarks
            }
          : item
      )
    );
    if (resetLastTest) {
      setResultMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    if (resetProbe) {
      setProbeMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    if (resetBenchmarks) {
      setBenchmarkMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    if (editingModelId === id) {
      setEditingModelId(null);
      setModelDraft("");
    }

    cancelEdit();
    ensureCollapsed(id);
    setNotice("已保存编辑");
  }

  function startInlineModelEdit(item: KeyConfig) {
    setEditingModelId(item.id);
    setModelDraft(item.model || "");
  }

  function saveInlineModelEdit(id: string) {
    if (!isConfigStoreReady) {
      setNotice(configStoreError || "项目配置正在加载，请稍候");
      return;
    }

    const nextModel = modelDraft.trim();
    const original = configs.find((item) => item.id === id);
    const resetLastTest = original ? (original.model || "") !== nextModel : false;

    setConfigs((prev) =>
      prev.map((item) => (item.id === id ? { ...item, model: nextModel, lastTest: resetLastTest ? undefined : item.lastTest } : item))
    );
    if (resetLastTest) {
      setResultMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    setEditingModelId(null);
    setModelDraft("");
    setNotice("模型已更新");
  }

  function cancelInlineModelEdit() {
    setEditingModelId(null);
    setModelDraft("");
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-3 px-3 py-4 text-zinc-900 sm:px-5 lg:px-6 dark:text-zinc-100">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
            <Image
              src="/logo.png"
              alt="Logo"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg object-cover ring-1 ring-emerald-200 sm:h-9 sm:w-9 dark:ring-emerald-900"
              priority
            />
            <span>AI Key Vault</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">本地保存、批量测试、模型识别、性能评测、复制与导出</p>
        </div>
        <div
          role="group"
          aria-label="主题切换"
          className="inline-flex shrink-0 items-center rounded-full border border-zinc-200 bg-white p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {([
            { mode: "system" as ThemeMode, label: "跟随系统", icon: <FaDesktop className="h-3.5 w-3.5" aria-hidden /> },
            { mode: "light" as ThemeMode, label: "白天", icon: <FaSun className="h-3.5 w-3.5" aria-hidden /> },
            { mode: "dark" as ThemeMode, label: "黑夜", icon: <FaMoon className="h-3.5 w-3.5" aria-hidden /> }
          ]).map((option) => {
            const active = theme === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                onClick={() => setThemeMode(option.mode)}
                aria-pressed={active}
                aria-label={`切换到${option.label}主题`}
                title={option.label}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {option.icon}
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(24rem,28rem)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-3.5 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-900">新增配置</h2>
            <span className="text-xs text-zinc-500">{configs.length} 条配置</span>
          </div>

          <label className={labelClass}>粘贴内容（支持一次解析多个配置，也支持 cc-switch SQL 文本）</label>
          <textarea
            className={inputClass}
            value={pasteRaw}
            onChange={(e) => setPasteRaw(e.target.value)}
            placeholder="可粘贴 curl、JSON、环境变量、ccswitch:// 链接、cc-switch 导出的 SQL、多个配置块"
            rows={3}
          />
          <input
            ref={ccSwitchSqlInputRef}
            type="file"
            accept=".sql,text/sql,text/plain"
            className="hidden"
            onChange={handleCcSwitchSqlFileChange}
          />

          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnGhost} onClick={applyPaste}>
              <FaMagic aria-hidden />
              <span>解析到表单</span>
            </button>
            <button type="button" className={btnPrimary} onClick={addFromPaste} disabled={!isConfigStoreReady}>
              <FaPaste aria-hidden />
              <span>粘贴并直接新增</span>
            </button>
            <button type="button" className={btnGhost} onClick={openCcSwitchSqlFilePicker}>
              <FaPaste aria-hidden />
              <span>导入 cc-switch SQL</span>
            </button>
          </div>

          <form onSubmit={addConfig} className="mt-2">
            <label className={labelClass}>名称</label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={`例如：${makeDefaultName(nextIndex)}`}
            />

            <label className={labelClass}>地址</label>
            <input
              className={inputClass}
              value={form.baseUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="例如：https://api.openai.com"
              required
            />
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">{endpointHintText}</p>

            <label className={labelClass}>Key</label>
            <input
              className={inputClass}
              value={form.apiKey}
              onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="例如：sk-xxxx"
              required
            />

            <label className={labelClass}>模型（可选）</label>
            <input
              className={inputClass}
              value={form.model}
              onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="例如：gpt-4.1-mini"
            />

            <label className={labelClass}>API 格式</label>
            <select
              className={inputClass}
              value={form.apiFormat}
              onChange={(e) => setForm((prev) => ({ ...prev, apiFormat: normalizeApiFormat(e.target.value) }))}
            >
              {API_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{`${option.label} - ${option.hint}`}</option>
              ))}
            </select>

            <div className="mt-2 flex flex-wrap gap-2">
              <button type="submit" className={btnPrimary} disabled={!isConfigStoreReady}>
                <FaSave aria-hidden />
                <span>{isConfigStoreReady ? "保存配置" : "加载配置中"}</span>
              </button>
            </div>
          </form>
        </section>

        <section className="flex min-w-0 max-h-[calc(100vh-7rem)] flex-col rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-3.5 shadow-sm sm:p-5">
          <div className="mb-3 space-y-2.5 shrink-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="shrink-0 text-base font-semibold text-zinc-900 dark:text-zinc-100">配置列表</h2>
              {/* Tab 切换：紧挨「配置列表」标题右侧 */}
              <div
                role="tablist"
                aria-label="配置列表视图"
                className="inline-flex max-w-full flex-wrap items-center rounded-full border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeList === "all"}
                  onClick={() => setActiveList("all")}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition ${
                    activeList === "all"
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  <span>成功列表</span>
                  <span className={`inline-flex items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${activeList === "all" ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"}`}>
                    {visibleConfigs.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeList === "failed"}
                  onClick={() => setActiveList("failed")}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition ${
                    activeList === "failed"
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  <span>失败列表</span>
                  <span className={`inline-flex items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${activeList === "failed" ? "bg-red-600 text-white dark:bg-red-500" : failedConfigs.length > 0 ? "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"}`}>
                    {failedConfigs.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeList === "disabled"}
                  onClick={() => setActiveList("disabled")}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition ${
                    activeList === "disabled"
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  <span>禁用列表</span>
                  <span className={`inline-flex items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${activeList === "disabled" ? "bg-zinc-700 text-white dark:bg-zinc-500 dark:text-zinc-950" : disabledConfigs.length > 0 ? "bg-zinc-300 text-zinc-700 dark:bg-zinc-600 dark:text-zinc-200" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"}`}>
                    {disabledConfigs.length}
                  </span>
                </button>
              </div>
              <HelpHint text={endpointHintText} />
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 pb-1">
              {activeList !== "disabled" ? (
                <>
                  <button type="button" className={topBtnPrimary} onClick={testAllConfigs} disabled={testingAll}>
                    {testingAll ? <FaSpinner className="animate-spin" aria-hidden /> : <FaBolt aria-hidden />}
                    <span>{testingAll ? "测试中" : activeList === "failed" ? "测试失败列表" : "测试成功列表"}</span>
                  </button>
                  <button type="button" className={topBtnGhost} onClick={probeAllConfigs} disabled={probingAll}>
                    {probingAll ? <FaSpinner className="animate-spin" aria-hidden /> : <FaMagic aria-hidden />}
                    <span>{probingAll ? "识别中" : activeList === "failed" ? "识别失败列表" : "识别成功列表"}</span>
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className={topBtnGhost}
                onClick={() => copyText(formatAll(configs, "txt"), "已复制全部配置")}
                disabled={configs.length === 0}
              >
                <FaCopy aria-hidden />
                <span>复制全部</span>
              </button>
              <ExportMenu onExport={exportAll} label="导出" triggerClassName={topBtnGhost} />
              <button
                type="button"
                className={topBtnDanger}
                onClick={removeAllConfigs}
                disabled={configs.length === 0}
              >
                <FaTrashAlt aria-hidden />
                <span>一键删除</span>
              </button>
              <button
                type="button"
                className={topBtnGhost}
                onClick={collapseActiveAll}
                disabled={activeCount === 0 || activeAllCollapsed}
                title="折叠当前列表全部卡片"
              >
                <FaCompressArrowsAlt aria-hidden />
                <span>折叠全部</span>
              </button>
              <button
                type="button"
                className={topBtnGhost}
                onClick={expandActiveAll}
                disabled={activeCount === 0 || activeCollapsedCount === 0}
                title="打开当前列表全部卡片"
              >
                <FaExpandArrowsAlt aria-hidden />
                <span>打开全部</span>
              </button>

              <div
                className="relative ml-auto flex min-w-0 w-full max-w-md items-center gap-2 sm:w-auto sm:min-w-[16rem]"
                ref={searchBoxRef}
              >
                <div className="relative min-w-0 flex-1">
                  <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400" aria-hidden />
                  <input
                    className="w-full rounded-xl border border-zinc-300 bg-white py-2 pl-8 pr-3 text-sm text-zinc-900 outline-none transition hover:border-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:focus:border-zinc-600 dark:focus:ring-emerald-900/40"
                    value={configSearch}
                    onChange={(e) => {
                      setConfigSearch(e.target.value);
                      setSearchDropdownOpen(true);
                    }}
                    onFocus={() => setSearchDropdownOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        locateConfig();
                      } else if (e.key === "Escape") {
                        setSearchDropdownOpen(false);
                      }
                    }}
                    placeholder="搜索公益站名称并选择"
                    role="combobox"
                    aria-controls="config-search-listbox"
                    aria-expanded={searchDropdownOpen && searchMatches.length > 0}
                    aria-autocomplete="list"
                  />
                  {searchDropdownOpen && searchMatches.length > 0 ? (
                    <ul
                      id="config-search-listbox"
                      role="listbox"
                      className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {searchMatches.map((match) => (
                        <li key={match.id} role="option" aria-selected={false}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            // mousedown 时就定位，避免 input blur 导致列表先关闭、click 丢失
                            onMouseDown={(e) => {
                              e.preventDefault();
                              locateConfigTarget(match);
                            }}
                          >
                            <span
                              className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${
                                getConfigListStatus(match) === "failed"
                                  ? "bg-red-500"
                                  : getConfigListStatus(match) === "disabled"
                                    ? "bg-zinc-400"
                                    : "bg-emerald-500"
                              }`}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate">{match.name}</span>
                            {match.model ? (
                              <span className="shrink-0 truncate text-xs text-zinc-400">{match.model}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={topBtnGhost}
                  onClick={locateConfig}
                  disabled={searchMatches.length === 0}
                  title="定位到首个匹配的配置"
                >
                  <FaSearch aria-hidden />
                  <span>定位</span>
                </button>
              </div>
            </div>
            {/* 模型分类筛选 */}
            <div className="flex w-full flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/60">
                {MODEL_CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCategoryFilter(opt.value)}
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition ${
                      categoryFilter === opt.value
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeList === "failed" && failedConfigs.length === 0 ? (
            <p className="shrink-0 text-sm text-zinc-500">暂无失败配置</p>
          ) : activeList === "disabled" && disabledConfigs.length === 0 ? (
            <p className="shrink-0 text-sm text-zinc-500">暂无禁用配置</p>
          ) : activeCount === 0 ? (
            <p className="shrink-0 text-sm text-zinc-500">
              {activeList === "failed"
                ? "暂无失败配置"
                : activeList === "disabled"
                  ? "暂无禁用配置"
                  : categoryFilter !== "all" || configSearch.trim()
                    ? "当前筛选下无配置"
                    : "暂无配置"}
            </p>
          ) : (
            <ul className="grid max-h-full min-w-0 grid-cols-1 gap-2.5 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
              {activeConfigs.map((item) => renderConfigCard(item))}
            </ul>
          )}
        </section>

      </div>

      {ccSwitchDialogItem ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-zinc-950/35 px-4">
          <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-zinc-900">导入到 CC Switch</p>
                <p className="mt-1 text-sm text-zinc-500">选择目标 App 后，网页会尝试直接唤起本地 CC Switch。</p>
              </div>
              <button type="button" className={smallBtn} onClick={closeCcSwitchDialog}>
                <FaTimesCircle aria-hidden />
                <span>关闭</span>
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              当前配置：<span className="font-semibold text-zinc-900">{ccSwitchDialogItem.name}</span>
            </div>

            <label className={labelClass}>目标 App</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CC_SWITCH_APPS.map((app) => {
                const active = ccSwitchTargetApp === app.value;
                return (
                  <button
                    key={app.value}
                    type="button"
                    className={
                      active
                        ? "rounded-xl border border-emerald-700 bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
                        : "rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50"
                    }
                    onClick={() => setCcSwitchTargetApp(app.value)}
                  >
                    {app.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => copyCcSwitchLink(ccSwitchDialogItem, ccSwitchTargetApp)}>
                <FaCopy aria-hidden />
                <span>复制链接</span>
              </button>
              <button type="button" className={btnPrimary} onClick={() => importToCcSwitch(ccSwitchDialogItem, ccSwitchTargetApp)}>
                <FaLink aria-hidden />
                <span>立即唤起</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {probeDialogItem ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-zinc-950/35 px-4">
          <div className="w-full max-w-5xl rounded-[30px] border border-zinc-200 bg-white p-4 shadow-2xl sm:p-5 dark:border-zinc-700 dark:bg-zinc-900">
            {(() => {
              const activeProbe = probeMap[probeDialogItem.id] || probeDialogItem.probe || defaultProbeResult();
              const currentModel = probeDialogItem.model || "";

              return (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="inline-flex items-center gap-2 text-base font-semibold text-zinc-900">
                        <span>模型识别结果</span>
                        <HelpHint text="读取当前配置可见的模型列表。这里只负责看有哪些模型，真正的速度对比在性能评测里。"/>
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {probeDialogItem.name}
                        {activeProbe.testedAt ? ` · ${toDateTimeLabel(activeProbe.testedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className={btnGhost} onClick={() => copyProbeModels(probeDialogItem, activeProbe)}>
                        <FaCopy aria-hidden />
                        <span>复制模型列表</span>
                      </button>
                      <button
                        type="button"
                        className={btnPrimary}
                        onClick={() => openBenchmarkDialog(probeDialogItem)}
                        disabled={activeProbe.supportedModels.length === 0}
                      >
                        <FaVial aria-hidden />
                        <span>打开性能评测</span>
                      </button>
                      <button type="button" className={smallBtn} onClick={closeProbeDialog}>
                        <FaTimesCircle aria-hidden />
                        <span>关闭</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(15rem,0.85fr)]">
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${statusPillClass(
                            activeProbe.status
                          )}`}
                        >
                          <StatusIcon status={activeProbe.status} />
                          <span>
                                  {activeProbe.status === "success"
                              ? "识别成功"
                              : activeProbe.status === "pending"
                                ? "识别中..."
                                : activeProbe.status === "error"
                                  ? "识别失败"
                                  : "未识别"}
                          </span>
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200">
                          共 {activeProbe.supportedModels.length} 个模型
                        </span>
                      </div>
                      <div className="mt-3 text-sm leading-6 text-zinc-600">{activeProbe.detail || "暂无识别详情"}</div>
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">当前模型</p>
                      <p className="mt-2 text-lg font-bold leading-7 break-words text-emerald-900 [overflow-wrap:anywhere]">
                        {currentModel || "未设置"}
                      </p>
                      <p className="mt-2 text-sm text-emerald-800">这里只保留复制与切换，性能评测放到独立窗口里做。</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-zinc-900">已识别模型</p>
                      <p className="text-xs text-zinc-500">
                        {probeModelCategory === "all"
                          ? `共 ${activeProbe.supportedModels.length} 个模型`
                          : `显示 ${activeProbe.supportedModels.filter((m) => inferModelCategory(m) === probeModelCategory).length} / ${activeProbe.supportedModels.length} 个模型`}
                      </p>
                    </div>
                    {/* 模型分类筛选 */}
                    <div className="mb-3 inline-flex flex-wrap items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/60">
                      {MODEL_CATEGORY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setProbeModelCategory(opt.value)}
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition ${
                            probeModelCategory === opt.value
                              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {activeProbe.supportedModels.length > 0 ? (
                      (() => {
                        const filteredProbeModels = activeProbe.supportedModels.filter(
                          (m) => probeModelCategory === "all" || inferModelCategory(m) === probeModelCategory
                        );
                        if (filteredProbeModels.length === 0) {
                          return <p className="text-sm text-zinc-500">当前分类下暂无模型</p>;
                        }
                        return (
                          <div className="grid max-h-[48vh] grid-cols-1 gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
                            {filteredProbeModels.map((model) => {
                          const isCurrent = currentModel === model;
                          const tags = inferModelTags(model);

                          return (
                            <div
                              key={model}
                              className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-2xl border px-3 py-3 ${
                                isCurrent ? "border-emerald-300 bg-emerald-50/70" : "border-zinc-200 bg-zinc-50"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-start gap-2">
                                  <p
                                    className="min-w-0 flex-1 text-[15px] font-semibold leading-6 break-words text-zinc-900 [overflow-wrap:anywhere]"
                                    title={model}
                                  >
                                    {model}
                                  </p>
                                  {isCurrent ? (
                                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                      当前
                                    </span>
                                  ) : null}
                                </div>

                                {tags.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.map((tag) => (
                                      <span
                                        key={`${model}-${tag}`}
                                        className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${getTagClassName(tag)}`}
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>

                              <div className="flex shrink-0 items-center gap-1.5 self-center lg:self-start">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-[11px] text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                  onClick={() => copySingleProbeModel(model)}
                                  title={`复制 ${model}`}
                                  aria-label={`复制 ${model}`}
                                >
                                  <FaCopy aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[11px] transition disabled:cursor-not-allowed disabled:opacity-45 ${
                                    isCurrent
                                      ? "border-emerald-200 bg-emerald-100 text-emerald-700 hover:border-emerald-200 hover:bg-emerald-100 hover:text-emerald-700"
                                      : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900"
                                  }`}
                                  onClick={() => applyProbeModel(probeDialogItem.id, model)}
                                  disabled={isCurrent}
                                  title={isCurrent ? `${model} 已是当前模型` : `切换到 ${model}`}
                                  aria-label={isCurrent ? `${model} 已是当前模型` : `切换到 ${model}`}
                                >
                                  <FaExchangeAlt aria-hidden />
                                </button>
                              </div>
                            </div>
                          );
                            })}
                          </div>
                        );
                      })()
                    ) : (
                      <p className="text-sm text-zinc-500">暂无可展示的模型列表</p>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {benchmarkDialogItem ? (
        <div className="fixed inset-0 z-30 overflow-hidden bg-zinc-950/40 px-3 py-4 sm:px-4 sm:py-8">
          <div className="flex min-h-full items-start justify-center">
            <div className="flex max-h-[calc(100vh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 sm:max-h-[calc(100vh-64px)]">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-4 py-4 sm:px-5">
                <div>
                  <p className="inline-flex items-center gap-2 text-base font-semibold text-zinc-900">
                    <span>性能评测</span>
                    <HelpHint text="对已识别到的模型做响应速度测试，方便你比较哪个模型更快、更稳，适合设为默认模型。" />
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {benchmarkDialogItem.name} · 已识别 {probeDialogModels.length} 个模型
                    {activeProbeDialogProbe.testedAt ? ` · 最近识别：${toDateTimeLabel(activeProbeDialogProbe.testedAt)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={btnGhost} onClick={() => copyProbeModels(benchmarkDialogItem, activeProbeDialogProbe)}>
                    <FaCopy aria-hidden />
                    <span>复制模型列表</span>
                  </button>
                  <button type="button" className={smallBtn} onClick={closeBenchmarkDialog}>
                    <FaTimesCircle aria-hidden />
                    <span>关闭</span>
                  </button>
                </div>
              </div>

              <div className="border-b border-zinc-200 bg-zinc-50/80 px-4 py-3 sm:px-5 dark:border-zinc-700 dark:bg-zinc-800/60">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">搜索模型</span>
                    <input
                      className={inputClass}
                      value={benchmarkSearch}
                      onChange={(e) => setBenchmarkSearch(e.target.value)}
                      placeholder="输入模型名或 tag，例如 gpt / thinking / embedding"
                    />
                  </label>

                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">测试次数</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {[1, 2, 3].map((round) => {
                        const active = benchmarkRounds === round;
                        return (
                          <button
                            key={round}
                            type="button"
                            className={
                              active
                                ? "rounded-full border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                                : "rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                            }
                            onClick={() => setBenchmarkRoundsInput(String(round))}
                          >
                            {round}次
                          </button>
                        );
                      })}
                      <input
                        className="w-14 rounded-xl border border-emerald-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                        value={benchmarkRoundsInput}
                        onChange={(e) => setBenchmarkRoundsInput(e.target.value.replace(/[^\d]/g, "").slice(0, 1))}
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={selectVisibleProbeModels}
                      disabled={visibleBenchmarkableModels.length === 0}
                    >
                      当前筛选全选
                    </button>
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={selectAllProbeModels}
                      disabled={probeDialogModels.filter((item) => item.benchmarkable).length === 0}
                    >
                      全选可测
                    </button>
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={clearSelectedProbeModels}
                      disabled={selectedProbeModels.length === 0}
                    >
                      清空选择
                    </button>
                    <button
                      type="button"
                      className={btnPrimary}
                      onClick={() => benchmarkModels(benchmarkDialogItem, benchmarkActionModels, benchmarkRounds)}
                      disabled={Boolean(activeBenchmarkBatch) || benchmarkActionModels.length === 0}
                    >
                      {activeBenchmarkBatch ? <FaSpinner className="animate-spin" aria-hidden /> : <FaBolt aria-hidden />}
                      <span>开始测试 {benchmarkActionModels.length}</span>
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600">
                  <span>当前模型：{benchmarkDialogItem.model || "未设置"}</span>
                  <span>可测试：{probeDialogModels.filter((item) => item.benchmarkable).length} 个</span>
                  <span>本次目标：{benchmarkActionModels.length} 个</span>
                  <span>
                    {activeBenchmarkBatch ? `本次完成：${benchmarkResults.length}/${activeBenchmarkBatch.total}` : `最新结果：${benchmarkResults.length} 个`}
                  </span>
                </div>
              </div>

              <div
                className={`grid min-h-0 flex-1 gap-4 overflow-hidden p-4 sm:p-5 ${
                  benchmarkListCollapsed
                    ? "xl:grid-cols-[minmax(17rem,0.34fr)_minmax(0,1fr)]"
                    : "xl:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)]"
                }`}
              >
                <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">模型列表</p>
                      <p className="text-xs text-zinc-500">
                        显示 {filteredProbeModels.length} / {probeDialogModels.length} 个模型
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
                        已选 {selectedProbeModels.length}
                      </div>
                      <button
                        type="button"
                        className={smallBtn}
                        onClick={() => setBenchmarkListCollapsed((prev) => !prev)}
                        aria-expanded={!benchmarkListCollapsed}
                      >
                        {benchmarkListCollapsed ? <FaChevronDown aria-hidden /> : <FaChevronUp aria-hidden />}
                        <span>{benchmarkListCollapsed ? "展开" : "折叠"}</span>
                      </button>
                    </div>
                  </div>

                  {activeBenchmarkBatch ? (
                    <div className="border-b border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          正在测试 {activeBenchmarkBatch.done} / {activeBenchmarkBatch.total} 个模型
                          {activeBenchmarkBatch.skipped > 0 ? `，已跳过 ${activeBenchmarkBatch.skipped}` : ""}
                        </div>
                        <div className="text-xs font-semibold">
                          {activeBenchmarkBatch.currentModel || "-"} · 第 {activeBenchmarkBatch.currentRound || 1}/{activeBenchmarkBatch.rounds} 次
                        </div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${activeBenchmarkProgressPercent}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-amber-700">总进度 {activeBenchmarkProgressPercent}%</div>
                    </div>
                  ) : null}

                  {benchmarkListCollapsed ? (
                    <div className="px-3 py-4 text-sm text-zinc-500">
                      模型列表已折叠。你可以手动展开继续多选或切换当前模型。
                    </div>
                  ) : filteredProbeModels.length > 0 ? (
                    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                      {filteredProbeModels.map((entry) => {
                        const selected = selectedProbeModels.includes(entry.model);
                        const benchmark = entry.benchmark;

                        return (
                          <div
                            key={entry.model}
                            className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-200 px-3 py-2 last:border-b-0 ${
                              entry.isCurrent ? "bg-emerald-50/60" : "bg-white"
                            }`}
                          >
                            <label className={`inline-flex items-center ${entry.benchmarkable ? "text-zinc-900" : "text-zinc-400"}`}>
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={!entry.benchmarkable}
                                onChange={() => toggleProbeModelSelection(entry.model)}
                                className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                              />
                            </label>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`truncate text-sm font-semibold ${entry.benchmarkable ? "text-zinc-900" : "text-zinc-400"}`}>
                                  {entry.model}
                                </span>
                                {entry.isCurrent ? (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                                    当前
                                  </span>
                                ) : null}
                                {!entry.benchmarkable ? (
                                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                                    不支持
                                  </span>
                                ) : null}
                              </div>

                              {entry.tags.length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {entry.tags.map((tag) => (
                                    <span
                                      key={`${entry.model}-${tag}`}
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${getTagClassName(tag)}`}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              <div className="mt-1 text-xs text-zinc-500">
                                {benchmark.speed
                                  ? `平均 ${formatDurationLabel(benchmark.speed.avgMs)} · 中位 ${formatDurationLabel(
                                      benchmark.speed.medianMs
                                    )} · 首字 ${formatDurationLabel(benchmark.speed.firstTokenMedianMs)} · 成功 ${formatSuccessRateLabel(
                                      benchmark.speed.successRate
                                    )}`
                                  : benchmark.detail || "暂无测试结果"}
                              </div>
                            </div>

                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                                entry.isCurrent
                                  ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                  : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50"
                              }`}
                              onClick={() => applyProbeModel(benchmarkDialogItem.id, entry.model)}
                              disabled={entry.isCurrent}
                              title={entry.isCurrent ? `${entry.model} 已是当前模型` : "设为当前模型"}
                              aria-label={entry.isCurrent ? `${entry.model} 已是当前模型` : "设为当前模型"}
                            >
                              <FaExchangeAlt aria-hidden />
                              <span>{entry.isCurrent ? "当前" : "设为当前"}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-3 py-6 text-sm text-zinc-500">当前搜索条件下没有可展示的模型</div>
                  )}
                </section>

                <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40">
                  <div className="border-b border-zinc-200 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">最新测试结果</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {activeBenchmarkBatch
                            ? `测试进行中：${benchmarkResults.length}/${activeBenchmarkBatch.total} 个模型已返回结果`
                            : activeBenchmarkSummary?.finishedAt
                              ? `更新时间：${toDateTimeLabel(activeBenchmarkSummary.finishedAt)}`
                              : "尚未开始性能评测"}
                        </p>
                      </div>
                      {activeBenchmarkSummary?.recommendedModel ? (
                        <button
                          type="button"
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                          onClick={() => setBenchmarkChartModel(activeBenchmarkSummary.recommendedModel || "")}
                        >
                          推荐：{activeBenchmarkSummary.recommendedModel}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {activeBenchmarkSummary ? (
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-8 sm:pb-10">
                      {failedBenchmarkResults.length > 0 ? (
                        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                          本次有 {failedBenchmarkResults.length} 个模型返回失败，表格里已用红色标出；把鼠标移到失败行或查看左侧列表，可看到错误原因。
                        </div>
                      ) : null}

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-3 py-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">成功返回</p>
                          <p className="mt-1 text-lg font-bold text-zinc-900">
                            {activeBenchmarkSummary.successModels}/{activeBenchmarkSummary.totalModels}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-3 py-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">最快模型</p>
                          <p className="mt-1 text-sm font-semibold text-zinc-900">{activeBenchmarkSummary.fastestModel || "-"}</p>
                          <p className="text-xs text-zinc-500">{formatDurationLabel(activeBenchmarkSummary.fastestMedianMs)}</p>
                        </div>
                        <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-3 py-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">首字最快</p>
                          <p className="mt-1 text-sm font-semibold text-zinc-900">{activeBenchmarkSummary.quickestFirstTokenModel || "-"}</p>
                          <p className="text-xs text-zinc-500">{formatDurationLabel(activeBenchmarkSummary.quickestFirstTokenMs)}</p>
                        </div>
                        <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-3 py-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">最稳模型</p>
                          <p className="mt-1 text-sm font-semibold text-zinc-900">{activeBenchmarkSummary.mostStableModel || "-"}</p>
                          <p className="text-xs text-zinc-500">波动 {formatDurationLabel(activeBenchmarkSummary.stabilityMs)}</p>
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">默认推荐</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-900">{activeBenchmarkSummary.recommendedModel || "-"}</p>
                          <p className="text-xs text-emerald-800">优先成功率，再看中位耗时和波动。</p>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">结果摘要</p>
                            <p className="mt-1 text-xs text-zinc-500">这里先看每个模型的汇总指标；点右侧详情按钮再看每一轮的数据。</p>
                          </div>
                          {activeBenchmarkChartResult ? (
                            <div className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
                              图表焦点：{activeBenchmarkChartResult.model}
                            </div>
                          ) : null}
                        </div>

                        {benchmarkResults.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                                <tr>
                                  <th className="sticky left-0 z-10 bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">模型</th>
                                  <th className="px-3 py-3">状态</th>
                                  <th className="px-3 py-3">平均</th>
                                  <th className="px-3 py-3">中位</th>
                                  <th className="px-3 py-3">首字中位</th>
                                  <th className="px-3 py-3">成功率</th>
                                  <th className="px-3 py-3">详情</th>
                                </tr>
                              </thead>
                              <tbody>
                                {benchmarkResults.map((result) => {
                                  const focused = activeBenchmarkChartResult?.model === result.model;
                                  const failed = result.status === "error";

                                  return (
                                    <tr
                                      key={result.model}
                                      className={`cursor-pointer border-t border-zinc-200 text-zinc-700 transition ${
                                        failed
                                          ? "bg-red-50/50 hover:bg-red-50 dark:bg-red-950/40 dark:hover:bg-red-950/60"
                                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                                      } ${
                                        focused
                                          ? "bg-emerald-50/60 dark:bg-emerald-950/30"
                                          : failed
                                            ? "bg-red-50/50 dark:bg-red-950/40"
                                            : "bg-white dark:bg-zinc-900"
                                      }`}
                                      onClick={() => setBenchmarkChartModel(result.model)}
                                    >
                                      <td
                                        className={`sticky left-0 z-10 px-4 py-3 align-top ${
                                          focused
                                            ? "bg-emerald-50/60 dark:bg-emerald-950/40"
                                            : failed
                                              ? "bg-red-50/50 dark:bg-red-950/50"
                                              : "bg-white dark:bg-zinc-900"
                                        }`}
                                      >
                                        <div className="font-semibold text-zinc-900">{result.model}</div>
                                        <div className="mt-1">
                                          <span
                                            className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                              failed ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-600"
                                            }`}
                                          >
                                            <StatusIcon status={result.status} />
                                            <span>{failed ? "失败" : "完成"}</span>
                                          </span>
                                        </div>
                                        {failed && result.detail ? (
                                          <div className="mt-1 max-w-xs break-words text-[11px] leading-5 text-red-700">{result.detail}</div>
                                        ) : null}
                                      </td>
                                      <td className="px-3 py-3 text-xs text-zinc-600">
                                        <span
                                          className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                                            failed ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                                          }`}
                                        >
                                          <StatusIcon status={result.status} />
                                          <span>{failed ? "失败" : "完成"}</span>
                                        </span>
                                      </td>
                                      <td className="px-3 py-3 text-xs text-zinc-600">{formatDurationLabel(result.speed?.avgMs)}</td>
                                      <td className="px-3 py-3 text-xs text-zinc-600">{formatDurationLabel(result.speed?.medianMs)}</td>
                                      <td className="px-3 py-3 text-xs text-zinc-600">
                                        {formatDurationLabel(result.speed?.firstTokenMedianMs)}
                                      </td>
                                      <td className="px-3 py-3 text-xs text-zinc-600">
                                        {formatSuccessRateLabel(result.speed?.successRate)}
                                      </td>
                                      <td className="px-3 py-3 text-xs text-zinc-600">
                                        <button
                                          type="button"
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setBenchmarkChartModel(result.model);
                                            setBenchmarkDetailModel(result.model);
                                          }}
                                          title={`查看 ${result.model} 详情`}
                                          aria-label={`查看 ${result.model} 详情`}
                                        >
                                          <FaInfoCircle aria-hidden />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="px-4 py-6 text-sm text-zinc-500">开始测试后，这里会展示每个模型的轮次明细。</div>
                        )}
                      </div>

                      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-3">
                          <div className="mb-3">
                            <p className="text-sm font-semibold text-zinc-900">模型对比</p>
                            <p className="mt-1 text-xs text-zinc-500">柱状图对比平均耗时与中位耗时。</p>
                          </div>
                          {benchmarkComparisonChartOption ? (
                            <ReactECharts option={benchmarkComparisonChartOption} style={{ height: 320, width: "100%" }} notMerge />
                          ) : (
                            <div className="flex h-80 items-center justify-center rounded-xl bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400">
                              暂无可绘制的图表数据
                            </div>
                          )}
                        </div>

                        <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-3">
                          <div className="mb-3">
                            <p className="text-sm font-semibold text-zinc-900">轮次走势</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {activeBenchmarkChartResult ? `${activeBenchmarkChartResult.model} 的每轮总耗时和首字时间。` : "点击上表中的模型查看详情。"}
                            </p>
                          </div>
                          {benchmarkRoundChartOption ? (
                            <ReactECharts option={benchmarkRoundChartOption} style={{ height: 320, width: "100%" }} notMerge />
                          ) : (
                            <div className="flex h-80 items-center justify-center rounded-xl bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400">
                              选择一个已有测速结果的模型后，这里显示轮次曲线
                            </div>
                          )}
                        </div>
                      </div>

                      {activeBenchmarkDetailResult ? (
                        <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/35 px-4">
                          <div className="max-h-[min(78vh,42rem)] w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
                            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-4">
                              <div>
                                <p className="text-base font-semibold text-zinc-900">{activeBenchmarkDetailResult.model}</p>
                                <p className="mt-1 text-sm text-zinc-500">查看该模型每一轮的总耗时、首字时间和错误信息。</p>
                              </div>
                              <button type="button" className={smallBtn} onClick={() => setBenchmarkDetailModel("")}>
                                <FaTimesCircle aria-hidden />
                                <span>关闭</span>
                              </button>
                            </div>

                            <div className="max-h-[calc(min(78vh,42rem)-5rem)] overflow-y-auto px-4 py-4">
                              <div className="grid gap-2 sm:grid-cols-4">
                                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">状态</p>
                                  <p className={`mt-1 text-sm font-semibold ${activeBenchmarkDetailResult.status === "error" ? "text-red-700" : "text-zinc-900"}`}>
                                    {activeBenchmarkDetailResult.status === "error" ? "失败" : "完成"}
                                  </p>
                                </div>
                                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">平均</p>
                                  <p className="mt-1 text-sm font-semibold text-zinc-900">{formatDurationLabel(activeBenchmarkDetailResult.speed?.avgMs)}</p>
                                </div>
                                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">中位</p>
                                  <p className="mt-1 text-sm font-semibold text-zinc-900">{formatDurationLabel(activeBenchmarkDetailResult.speed?.medianMs)}</p>
                                </div>
                                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">首字中位</p>
                                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                                    {formatDurationLabel(activeBenchmarkDetailResult.speed?.firstTokenMedianMs)}
                                  </p>
                                </div>
                              </div>

                              {activeBenchmarkDetailResult.detail ? (
                                <div
                                  className={`mt-3 rounded-2xl border px-3 py-2.5 text-sm leading-6 ${
                                    activeBenchmarkDetailResult.status === "error"
                                      ? "border-red-200 bg-red-50 text-red-800"
                                      : "border-zinc-200 bg-zinc-50 text-zinc-700"
                                  }`}
                                >
                                  {activeBenchmarkDetailResult.detail}
                                </div>
                              ) : null}

                              <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200">
                                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                                  <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                                    <tr>
                                      <th className="px-4 py-3">轮次</th>
                                      <th className="px-4 py-3">状态</th>
                                      <th className="px-4 py-3">总耗时</th>
                                      <th className="px-4 py-3">首字时间</th>
                                      <th className="px-4 py-3">错误信息</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {getBenchmarkRoundDetails(activeBenchmarkDetailResult).map((detail) => (
                                      <tr key={`${activeBenchmarkDetailResult.model}-detail-${detail.round}`} className="border-t border-zinc-200 bg-white">
                                        <td className="px-4 py-3 text-zinc-700">第 {detail.round} 轮</td>
                                        <td className="px-4 py-3">
                                          <span
                                            className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                              detail.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                            }`}
                                          >
                                            <StatusIcon status={detail.ok ? "success" : "error"} />
                                            <span>{detail.ok ? "成功" : "失败"}</span>
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-zinc-700">{detail.ok ? formatDurationLabel(detail.elapsedMs) : "-"}</td>
                                        <td className="px-4 py-3 text-zinc-700">{detail.ok ? formatDurationLabel(detail.firstTokenMs) : "-"}</td>
                                        <td className="px-4 py-3 text-xs leading-5 text-zinc-500">{detail.error || "-"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-sm text-zinc-500">选择模型并开始测试后，这里会展示最新结果、轮次明细和图表。</div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 transition-all duration-200 ${
          notice ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
        }`}
      >
        <div
          className={`pointer-events-auto flex max-w-[min(92vw,40rem)] items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur ${
            notice?.tone === "success"
              ? "border-emerald-300 bg-emerald-600/95 dark:border-emerald-700 dark:bg-emerald-700/95"
              : notice?.tone === "error"
                ? "border-red-300 bg-red-600/95 dark:border-red-700 dark:bg-red-700/95"
                : "border-sky-300 bg-sky-600/95 dark:border-sky-700 dark:bg-sky-700/95"
          }`}
          role={notice?.tone === "error" ? "alert" : "status"}
          aria-live={notice?.tone === "error" ? "assertive" : "polite"}
          data-notice-tone={notice?.tone || "hidden"}
        >
          {notice?.tone === "success" ? (
            <FaCheckCircle className="shrink-0 text-base" aria-hidden />
          ) : notice?.tone === "error" ? (
            <FaTimesCircle className="shrink-0 text-base" aria-hidden />
          ) : (
            <FaInfoCircle className="shrink-0 text-base" aria-hidden />
          )}
          <span className="min-w-0 flex-1">{notice?.message || ""}</span>
          {notice ? (
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-lg leading-none text-white/80 transition hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70"
              onClick={() => setNoticeState(null)}
              aria-label="关闭提示"
              title="关闭"
              data-testid="notice-close"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
