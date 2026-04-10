const APP_LABELS = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
} as const;

const PROVIDER_INSERT_RE = /INSERT\s+INTO\s+"?providers"?\s*/gi;
const BASE_URL_KEYS = [
  "OPENAI_BASE_URL",
  "GOOGLE_GEMINI_BASE_URL",
  "GEMINI_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "baseURL",
  "baseUrl",
  "base_url",
  "url",
  "endpoint",
] as const;
const API_KEY_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "apiKey",
  "api_key",
  "key",
  "token",
] as const;
const MODEL_KEYS = ["GEMINI_MODEL", "model", "defaultModel", "default_model"] as const;

export type CcSwitchSqlAppType = keyof typeof APP_LABELS;

export type CcSwitchSqlProvider = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  appType?: CcSwitchSqlAppType;
};

type SqlSegment = {
  content: string;
  endIndex: number;
};

type SqlInsertStatement = {
  columns: string[];
  values: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function normalizeBaseUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!/^https?:\/\//i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

function cleanKey(raw: string): string {
  return raw.replace(/^Bearer\s+/i, "").trim();
}

function normalizeModel(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

function normalizeAppType(raw: string): CcSwitchSqlAppType | undefined {
  const normalized = raw.trim().toLowerCase();
  return normalized in APP_LABELS ? (normalized as CcSwitchSqlAppType) : undefined;
}

function getStringByKeys(source: unknown, keys: readonly string[]): string {
  if (!isRecord(source)) return "";

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function collectRegexMatches(input: string, regex: RegExp, group = 1): string[] {
  const out: string[] = [];
  for (const match of input.matchAll(regex)) {
    const value = match[group]?.trim();
    if (value) out.push(value);
  }
  return uniqueStrings(out);
}

function readParenthesizedSegment(input: string, startIndex: number): SqlSegment | null {
  if (input[startIndex] !== "(") return null;

  let depth = 0;
  let inString = false;

  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      if (char === "'") {
        if (input[index + 1] === "'") {
          index += 1;
          continue;
        }
        inString = false;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          content: input.slice(startIndex + 1, index),
          endIndex: index,
        };
      }
    }
  }

  return null;
}

function splitSqlList(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      current += char;
      if (char === "'") {
        if (input[index + 1] === "'") {
          current += "'";
          index += 1;
          continue;
        }
        inString = false;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) out.push(current.trim());
  return out;
}

function decodeSqlValue(token: string): string {
  const normalized = token.trim();
  if (!normalized || /^null$/i.test(normalized)) return "";
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    return normalized.slice(1, -1).replace(/''/g, "'");
  }
  return normalized;
}

function decodeSqlIdentifier(token: string): string {
  return token.trim().replace(/^"|"$/g, "");
}

function collectInsertStatements(input: string): SqlInsertStatement[] {
  const out: SqlInsertStatement[] = [];

  for (const match of input.matchAll(PROVIDER_INSERT_RE)) {
    let cursor = match.index + match[0].length;

    while (cursor < input.length && /\s/.test(input[cursor])) {
      cursor += 1;
    }

    const columnSegment = readParenthesizedSegment(input, cursor);
    if (!columnSegment) continue;

    cursor = columnSegment.endIndex + 1;
    while (cursor < input.length && /\s/.test(input[cursor])) {
      cursor += 1;
    }

    const valuesMatch = input.slice(cursor).match(/^VALUES\b/i);
    if (!valuesMatch) continue;

    cursor += valuesMatch[0].length;
    while (cursor < input.length && /\s/.test(input[cursor])) {
      cursor += 1;
    }

    const valueSegment = readParenthesizedSegment(input, cursor);
    if (!valueSegment) continue;

    const columns = splitSqlList(columnSegment.content).map(decodeSqlIdentifier);
    const values = splitSqlList(valueSegment.content).map(decodeSqlValue);
    if (columns.length !== values.length || columns.length === 0) continue;

    out.push({ columns, values });
  }

  return out;
}

function parseJsonObject(input: string): Record<string, unknown> | null {
  if (!input.trim()) return null;

  try {
    const parsed = JSON.parse(input) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractConfigText(settings: Record<string, unknown>): string {
  return typeof settings.config === "string" ? settings.config : "";
}

function extractBaseUrl(settings: Record<string, unknown>, fallbackUrl: string): string {
  const configText = extractConfigText(settings);
  const configMatches = collectRegexMatches(configText, /(?:^|\n)\s*base_url\s*=\s*"([^"\n]+)"/g);

  return normalizeBaseUrl(
    firstNonEmptyString(
      getStringByKeys(settings.auth, BASE_URL_KEYS),
      getStringByKeys(settings.env, BASE_URL_KEYS),
      getStringByKeys(settings.options, BASE_URL_KEYS),
      getStringByKeys(settings, BASE_URL_KEYS),
      configMatches[0],
      fallbackUrl
    )
  );
}

function extractApiKey(settings: Record<string, unknown>): string {
  return cleanKey(
    firstNonEmptyString(
      getStringByKeys(settings.auth, API_KEY_KEYS),
      getStringByKeys(settings.env, API_KEY_KEYS),
      getStringByKeys(settings.options, API_KEY_KEYS),
      getStringByKeys(settings, API_KEY_KEYS)
    )
  );
}

function extractFirstModelFromMap(input: unknown): string {
  if (!isRecord(input)) return "";
  const [firstKey = ""] = Object.keys(input);
  return firstKey.trim();
}

function extractModel(settings: Record<string, unknown>): string {
  const configText = extractConfigText(settings);
  const configMatches = collectRegexMatches(configText, /(?:^|\n)\s*model\s*=\s*"([^"\n]+)"/g);

  return normalizeModel(
    firstNonEmptyString(
      getStringByKeys(settings.env, MODEL_KEYS),
      getStringByKeys(settings, MODEL_KEYS),
      getStringByKeys(settings.options, MODEL_KEYS),
      configMatches[0],
      extractFirstModelFromMap(settings.models)
    )
  );
}

function buildDisplayName(rawName: string, rawId: string, appType?: CcSwitchSqlAppType): string {
  const baseName = firstNonEmptyString(rawName, rawId);
  if (!baseName) return "";
  if (!appType) return baseName;
  return `${baseName} (${APP_LABELS[appType]})`;
}

function parseProviderStatement(statement: SqlInsertStatement): CcSwitchSqlProvider | null {
  const row = Object.fromEntries(statement.columns.map((column, index) => [column, statement.values[index] || ""]));
  const appType = normalizeAppType(row.app_type || "");
  const settings = parseJsonObject(row.settings_config || "");
  if (!settings) return null;

  const baseUrl = extractBaseUrl(settings, row.website_url || "");
  const apiKey = extractApiKey(settings);
  if (!baseUrl || !apiKey) return null;

  return {
    name: buildDisplayName(row.name || "", row.id || "", appType),
    baseUrl,
    apiKey,
    model: extractModel(settings),
    appType,
  };
}

function dedupeProviders(items: CcSwitchSqlProvider[]): CcSwitchSqlProvider[] {
  const seen = new Set<string>();
  const out: CcSwitchSqlProvider[] = [];

  for (const item of items) {
    const dedupeKey = `${item.baseUrl}__${item.apiKey}__${item.model}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(item);
  }

  return out;
}

export function parseCcSwitchSqlProviders(input: string): CcSwitchSqlProvider[] {
  if (!/INSERT\s+INTO\s+"?providers"?/i.test(input)) return [];

  const providers = collectInsertStatements(input)
    .map(parseProviderStatement)
    .filter((item): item is CcSwitchSqlProvider => Boolean(item));

  return dedupeProviders(providers);
}
