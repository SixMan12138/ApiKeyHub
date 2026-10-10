/** WebDAV 备份与同步（首发对接坚果云）：服务端实现，零第三方依赖，基于 Node 原生 fetch。
 *
 * 设计要点：
 * - 连接凭据与加密口令落盘 data/webdav.json（mode 0600，tmp+rename 原子写），接口只回掩码，不回明文。
 * - 上传前默认用 AES-256-GCM 加密（口令经 scrypt 派生密钥），云端文件为 .json.enc 信封。
 * - 云端结构：<remoteDir>/latest.json(.enc) + <remoteDir>/backups/apikeyhub-<北京时间戳>.json(.enc)。
 * - 坚果云兼容：MKCOL 逐级创建、PROPFIND 带 Depth 头并解析 XML、429 频率限制给友好提示。
 */

import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIRECTORY = join(process.cwd(), "data");
const CONFIG_FILE = join(DATA_DIRECTORY, "configs.json");
const HOT_MODELS_FILE = join(DATA_DIRECTORY, "hot-models.json");
const SETTINGS_FILE = join(DATA_DIRECTORY, "webdav.json");
const RESTORE_BACKUP_DIRECTORY = join(DATA_DIRECTORY, "restore-backup");

const REQUEST_TIMEOUT_MS = 25000;
const BUNDLE_FORMAT = "apikeyhub-backup";
const ENCRYPTED_FORMAT = "apikeyhub-backup-encrypted";
const BACKUPS_FOLDER = "backups";
const LATEST_FILE_NAME = "latest.json";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export const MAX_WEBDAV_KEEP = 50;
export const WEBDAV_HINT =
  "坚果云：在「安全选项 → 第三方应用管理 → 添加应用密码」生成应用密码，地址填 https://dav.jianguoyun.com/dav，账号填登录邮箱。免费版限 600 次请求/30 分钟。";

export type WebDavSettings = {
  version: 1;
  baseUrl: string;
  username: string;
  /** 坚果云应用密码，只落盘在后端 */
  password: string;
  remoteDir: string;
  encrypt: boolean;
  /** 加密口令，只落盘在后端 */
  passphrase: string;
  keep: number;
  updatedAt: string;
  lastBackupAt: string;
  lastBackupFile: string;
};

export type WebDavSettingsView = {
  baseUrl: string;
  username: string;
  remoteDir: string;
  encrypt: boolean;
  keep: number;
  updatedAt: string;
  lastBackupAt: string;
  lastBackupFile: string;
  hasPassword: boolean;
  hasPassphrase: boolean;
};

export type WebDavEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  lastModified: string;
  size: number;
};

export type BackupBundle = {
  format: typeof BUNDLE_FORMAT;
  version: 1;
  createdAt: string;
  configs: unknown[];
  hotModels: {
    enabled: boolean;
    models: string[];
    testPrompt: string;
  };
};

export const DEFAULT_WEBDAV_SETTINGS: WebDavSettings = {
  version: 1,
  baseUrl: "https://dav.jianguoyun.com/dav",
  username: "",
  password: "",
  remoteDir: "/ApiKeyHub",
  encrypt: true,
  passphrase: "",
  keep: 10,
  updatedAt: "",
  lastBackupAt: "",
  lastBackupFile: ""
};

/* ------------------------------------------------------------------ 工具 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clampKeep(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.parseInt(asString(value), 10);
  if (!Number.isFinite(numeric)) return DEFAULT_WEBDAV_SETTINGS.keep;
  return Math.min(MAX_WEBDAV_KEEP, Math.max(1, Math.round(numeric)));
}

/** 归一化远程目录：必须以 / 开头、不以 / 结尾、不允许 .. 片段 */
export function normalizeRemoteDir(value: string): string {
  const trimmed = value.trim() || DEFAULT_WEBDAV_SETTINGS.remoteDir;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
  const segments = withoutTrailingSlash.split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) return DEFAULT_WEBDAV_SETTINGS.remoteDir;
  return segments.length ? `/${segments.join("/")}` : DEFAULT_WEBDAV_SETTINGS.remoteDir;
}

/** 归一化服务器地址：去掉结尾斜杠 */
export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_WEBDAV_SETTINGS.baseUrl;
  return trimmed.replace(/\/+$/, "");
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value);
}

function formatStamp(date: Date): string {
  // 文件名用北京时间，方便在坚果云网页端按时间辨认
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}` +
    `-${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}${pad(shifted.getUTCSeconds())}`
  );
}

export function buildBackupFileName(date: Date, encrypted: boolean): string {
  return `apikeyhub-${formatStamp(date)}.json${encrypted ? ".enc" : ""}`;
}

/* ------------------------------------------------------- 设置读写与掩码 */

export function normalizeWebDavSettings(value: unknown): WebDavSettings {
  const record = asRecord(value);
  if (!record) return { ...DEFAULT_WEBDAV_SETTINGS };

  return {
    version: 1,
    baseUrl: normalizeBaseUrl(asString(record.baseUrl)),
    username: asString(record.username).trim(),
    password: asString(record.password),
    remoteDir: normalizeRemoteDir(asString(record.remoteDir)),
    encrypt: record.encrypt !== false,
    passphrase: asString(record.passphrase),
    keep: clampKeep(record.keep),
    updatedAt: asString(record.updatedAt),
    lastBackupAt: asString(record.lastBackupAt),
    lastBackupFile: asString(record.lastBackupFile)
  };
}

export async function readWebDavSettings(): Promise<WebDavSettings> {
  try {
    const content = await readFile(SETTINGS_FILE, "utf8");
    return normalizeWebDavSettings(JSON.parse(content) as unknown);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { ...DEFAULT_WEBDAV_SETTINGS };
    }
    throw error;
  }
}

export async function writeWebDavSettings(settings: WebDavSettings): Promise<void> {
  await mkdir(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  const temporaryFile = join(DATA_DIRECTORY, `webdav-${randomUUID()}.tmp`);
  await writeFile(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryFile, SETTINGS_FILE);
}

/** 对外只暴露可展示字段，密码/口令一律用 has* 布尔代替 */
export function toWebDavSettingsView(settings: WebDavSettings): WebDavSettingsView {
  return {
    baseUrl: settings.baseUrl,
    username: settings.username,
    remoteDir: settings.remoteDir,
    encrypt: settings.encrypt,
    keep: settings.keep,
    updatedAt: settings.updatedAt,
    lastBackupAt: settings.lastBackupAt,
    lastBackupFile: settings.lastBackupFile,
    hasPassword: Boolean(settings.password),
    hasPassphrase: Boolean(settings.passphrase)
  };
}

/* ------------------------------------------------------------- WebDAV IO */

function authorizationHeader(settings: WebDavSettings): string {
  const raw = `${settings.username}:${settings.password}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function encodeRemotePath(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment ? encodeURIComponent(segment) : segment))
    .join("/");
}

export function joinRemotePath(...parts: string[]): string {
  const merged = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  return normalizeRemoteDir(merged);
}

function remoteUrl(settings: WebDavSettings, path: string): string {
  return `${settings.baseUrl}${encodeRemotePath(path)}`;
}

function describeStatus(status: number, method: string): string {
  if (status === 401) return "认证失败：账号或应用密码不正确（坚果云需使用「第三方应用管理」生成的应用密码，不是登录密码）";
  if (status === 403) return "服务器拒绝访问该目录，请检查应用密码的权限";
  if (status === 404) return "云端路径不存在（404）";
  if (status === 405 && method === "MKCOL") return "目录已存在";
  if (status === 409) return "云端父目录不存在，无法创建子目录";
  if (status === 412) return "云端文件已被其他设备修改，请刷新后重试";
  if (status === 423) return "云端文件被锁定，请稍后重试";
  if (status === 429) return "坚果云请求频率超限（免费版 600 次/30 分钟），请稍后再试";
  if (status === 507) return "坚果云空间不足";
  return `WebDAV 返回 HTTP ${status}（${method}）`;
}

type WebDavRequestOptions = {
  body?: string;
  depth?: string;
  contentType?: string;
};

async function webdavRequest(
  settings: WebDavSettings,
  method: string,
  path: string,
  options: WebDavRequestOptions = {}
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    Authorization: authorizationHeader(settings),
    Accept: "*/*"
  };
  if (options.depth) headers.Depth = options.depth;
  if (options.contentType) headers["Content-Type"] = options.contentType;

  let response: Response;
  try {
    response = await fetch(remoteUrl(settings, path), {
      method,
      headers,
      body: options.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store"
    });
  } catch {
    throw new Error(`无法连接 WebDAV 服务器（${settings.baseUrl}），请检查地址、网络或代理设置`);
  }

  const text = await response.text().catch(() => "");
  return { status: response.status, body: text };
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>';

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function parsePropfindEntries(xml: string, collectionPath: string): WebDavEntry[] {
  const responseBlocks = xml.match(/<[a-zA-Z0-9]*:?response[\s>][\s\S]*?<\/[a-zA-Z0-9]*:?response>/g) || [];
  const entries: WebDavEntry[] = [];

  for (const block of responseBlocks) {
    const hrefMatch = block.match(/<[a-zA-Z0-9]*:?href[^>]*>([^<]*)<\/[a-zA-Z0-9]*:?href>/);
    if (!hrefMatch) continue;

    const href = decodeHref(hrefMatch[1].trim());
    const isCollection = /<[a-zA-Z0-9]*:?collection\s*\/?>/.test(block) || /\/$/.test(href);
    const lastModifiedMatch = block.match(/<[a-zA-Z0-9]*:?getlastmodified[^>]*>([^<]*)<\/[a-zA-Z0-9]*:?getlastmodified>/);
    const sizeMatch = block.match(/<[a-zA-Z0-9]*:?getcontentlength[^>]*>([^<]*)<\/[a-zA-Z0-9]*:?getcontentlength>/);

    // href 可能是完整 URL 或绝对路径，统一取路径部分
    let hrefPath = href;
    try {
      hrefPath = href.startsWith("http") ? new URL(href).pathname : href;
    } catch {
      hrefPath = href;
    }

    const normalizedHref = hrefPath.replace(/\/+$/, "");
    const normalizedCollection = collectionPath.replace(/\/+$/, "");
    if (!normalizedHref || normalizedHref === normalizedCollection) continue;

    const name = normalizedHref.slice(normalizedHref.lastIndexOf("/") + 1);
    if (!name) continue;

    const modified = lastModifiedMatch ? new Date(lastModifiedMatch[1].trim()) : null;
    const size = sizeMatch ? Number.parseInt(sizeMatch[1], 10) : 0;

    entries.push({
      name,
      path: `${normalizedCollection}/${name}`,
      isDirectory: isCollection,
      lastModified: modified && !Number.isNaN(modified.getTime()) ? modified.toISOString() : "",
      size: Number.isFinite(size) ? size : 0
    });
  }

  return entries;
}

/** 逐级确保远程目录存在；返回是否新建过 */
async function ensureRemoteCollection(settings: WebDavSettings, remoteDir: string): Promise<boolean> {
  const segments = normalizeRemoteDir(remoteDir).split("/").filter(Boolean);
  let current = "";
  let created = false;

  for (const segment of segments) {
    current = `${current}/${segment}`;
    const probe = await webdavRequest(settings, "PROPFIND", current, { depth: "0", body: PROPFIND_BODY, contentType: "application/xml; charset=utf-8" });

    if (probe.status === 207 || probe.status === 200) continue;
    if (probe.status === 404) {
      const created404 = await webdavRequest(settings, "MKCOL", current);
      // 405/301 表示已存在（并发创建），视为成功
      if (created404.status !== 201 && created404.status !== 405 && created404.status !== 301) {
        throw new Error(`创建云端目录失败：${describeStatus(created404.status, "MKCOL")}`);
      }
      created = true;
      continue;
    }

    throw new Error(describeStatus(probe.status, "PROPFIND"));
  }

  return created;
}

async function listCollection(settings: WebDavSettings, remoteDir: string): Promise<WebDavEntry[]> {
  const response = await webdavRequest(settings, "PROPFIND", remoteDir, {
    depth: "1",
    body: PROPFIND_BODY,
    contentType: "application/xml; charset=utf-8"
  });

  if (response.status === 404) return [];
  if (response.status !== 207 && response.status !== 200) {
    throw new Error(describeStatus(response.status, "PROPFIND"));
  }

  return parsePropfindEntries(response.body, remoteDir);
}

async function putRemoteText(settings: WebDavSettings, path: string, content: string): Promise<void> {
  const response = await webdavRequest(settings, "PUT", path, {
    body: content,
    contentType: "application/json; charset=utf-8"
  });
  if (response.status !== 201 && response.status !== 204 && response.status !== 200) {
    throw new Error(`上传失败：${describeStatus(response.status, "PUT")}`);
  }
}

async function getRemoteText(settings: WebDavSettings, path: string): Promise<string> {
  const response = await webdavRequest(settings, "GET", path);
  if (response.status === 404) throw new Error("云端文件不存在，请先备份或刷新列表");
  if (response.status !== 200) throw new Error(`下载失败：${describeStatus(response.status, "GET")}`);
  return response.body;
}

async function deleteRemotePath(settings: WebDavSettings, path: string): Promise<void> {
  const response = await webdavRequest(settings, "DELETE", path);
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw new Error(`删除失败：${describeStatus(response.status, "DELETE")}`);
  }
}

/* --------------------------------------------------------------- 加解密 */

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

export function encryptBackupJson(plainText: string, passphrase: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${JSON.stringify(
    {
      format: ENCRYPTED_FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      kdf: { name: "scrypt", salt: salt.toString("base64"), N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keyLength: KEY_LENGTH },
      cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), authTag: authTag.toString("base64") },
      payload: encrypted.toString("base64")
    },
    null,
    2
  )}\n`;
}

export function decryptBackupJson(cipherText: string, passphrase: string): string {
  const record = asRecord(JSON.parse(cipherText) as unknown);
  const kdf = asRecord(record?.kdf);
  const cipherInfo = asRecord(record?.cipher);
  const saltText = asString(kdf?.salt);
  const ivText = asString(cipherInfo?.iv);
  const tagText = asString(cipherInfo?.authTag);
  const payload = asString(record?.payload);

  if (!saltText || !ivText || !tagText || !payload) {
    throw new Error("云端文件格式无法识别，可能不是本应用生成的备份");
  }

  try {
    const key = deriveKey(passphrase, Buffer.from(saltText, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("解密失败：加密口令不正确，或云端文件已损坏");
  }
}

/* ----------------------------------------------------------- 本地数据包 */

export async function readLocalDataSummary(): Promise<{ configs: number; hotModels: number }> {
  const bundle = await buildBackupBundleSafe();
  return { configs: bundle.configs.length, hotModels: bundle.hotModels.models.length };
}

async function buildBackupBundleSafe(): Promise<BackupBundle> {
  let configs: unknown[] = [];
  let hotModels: BackupBundle["hotModels"] = { enabled: false, models: [], testPrompt: "" };

  try {
    const stored = JSON.parse(await readFile(CONFIG_FILE, "utf8")) as unknown;
    const record = asRecord(stored);
    if (record && Array.isArray(record.configs)) configs = record.configs;
  } catch {
    configs = [];
  }

  try {
    const stored = JSON.parse(await readFile(HOT_MODELS_FILE, "utf8")) as unknown;
    const record = asRecord(stored);
    if (record) {
      hotModels = {
        enabled: record.enabled === true,
        models: Array.isArray(record.models) ? record.models.filter((item): item is string => typeof item === "string") : [],
        testPrompt: asString(record.testPrompt)
      };
    }
  } catch {
    // 热点模型是增强项，读不到就按空处理
  }

  return { format: BUNDLE_FORMAT, version: 1, createdAt: new Date().toISOString(), configs, hotModels };
}

export async function buildBackupBundle(): Promise<BackupBundle> {
  return buildBackupBundleSafe();
}

function extractBundlePayload(raw: unknown): { configs: unknown[]; hotModels: BackupBundle["hotModels"] } {
  const record = asRecord(raw);
  if (!record) throw new Error("云端备份内容无法解析");

  const configsRaw = record.configs;
  const configsRecord = asRecord(configsRaw);
  const configs = Array.isArray(configsRaw)
    ? configsRaw
    : configsRecord && Array.isArray(configsRecord.configs)
      ? configsRecord.configs
      : null;
  if (!configs) throw new Error("云端备份里没有识别到配置列表");

  const hotRecord = asRecord(record.hotModels);
  const hotModels: BackupBundle["hotModels"] = {
    enabled: hotRecord?.enabled === true,
    models: hotRecord && Array.isArray(hotRecord.models) ? hotRecord.models.filter((item): item is string => typeof item === "string") : [],
    testPrompt: asString(hotRecord?.testPrompt)
  };

  return { configs, hotModels };
}

/** 用云端备份覆盖本地数据；覆盖前把现有文件复制到 data/restore-backup/ 便于回退 */
export async function applyBackupBundle(raw: unknown): Promise<{ configs: number; hotModels: number; localBackupDir: string }> {
  const { configs, hotModels } = extractBundlePayload(raw);

  await mkdir(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  await mkdir(RESTORE_BACKUP_DIRECTORY, { recursive: true, mode: 0o700 });
  const stamp = formatStamp(new Date());
  await Promise.all([
    copyFile(CONFIG_FILE, join(RESTORE_BACKUP_DIRECTORY, `configs-${stamp}.json`)).catch(() => undefined),
    copyFile(HOT_MODELS_FILE, join(RESTORE_BACKUP_DIRECTORY, `hot-models-${stamp}.json`)).catch(() => undefined)
  ]);

  const configTemporary = join(DATA_DIRECTORY, `configs-${randomUUID()}.tmp`);
  await writeFile(configTemporary, `${JSON.stringify({ version: 1, configs }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(configTemporary, CONFIG_FILE);

  const hotTemporary = join(DATA_DIRECTORY, `hot-models-${randomUUID()}.tmp`);
  await writeFile(hotTemporary, `${JSON.stringify({ version: 1, ...hotModels }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(hotTemporary, HOT_MODELS_FILE);

  return { configs: configs.length, hotModels: hotModels.models.length, localBackupDir: "data/restore-backup" };
}

/* ----------------------------------------------------------- 高层动作 */

function requireCredentials(settings: WebDavSettings): void {
  if (!settings.username.trim() || !settings.password) {
    throw new Error("请先填写坚果云账号与应用密码，并保存配置");
  }
}

export async function testWebDavConnection(settings: WebDavSettings): Promise<{ remoteDir: string; created: boolean; entries: number }> {
  requireCredentials(settings);

  const probe = await webdavRequest(settings, "PROPFIND", "/", { depth: "0", body: PROPFIND_BODY, contentType: "application/xml; charset=utf-8" });
  if (probe.status !== 207 && probe.status !== 200) {
    throw new Error(describeStatus(probe.status, "PROPFIND"));
  }

  const created = await ensureRemoteCollection(settings, settings.remoteDir);
  const entries = await listCollection(settings, settings.remoteDir);
  return { remoteDir: settings.remoteDir, created, entries: entries.length };
}

export async function createRemoteBackup(settings: WebDavSettings): Promise<{ file: string; latestFile: string; encrypted: boolean; size: number; pruned: string[] }> {
  requireCredentials(settings);
  if (settings.encrypt && !settings.passphrase.trim()) {
    throw new Error("已开启加密上传，请先设置加密口令（或关闭加密）");
  }

  await ensureRemoteCollection(settings, settings.remoteDir);
  const backupsDir = joinRemotePath(settings.remoteDir, BACKUPS_FOLDER);
  await ensureRemoteCollection(settings, backupsDir);

  const bundle = await buildBackupBundle();
  const plainText = `${JSON.stringify(bundle, null, 2)}\n`;
  const content = settings.encrypt ? encryptBackupJson(plainText, settings.passphrase) : plainText;

  const fileName = buildBackupFileName(new Date(bundle.createdAt), settings.encrypt);
  const latestName = `${LATEST_FILE_NAME}${settings.encrypt ? ".enc" : ""}`;

  await putRemoteText(settings, joinRemotePath(backupsDir, fileName), content);
  await putRemoteText(settings, joinRemotePath(settings.remoteDir, latestName), content);

  const pruned = await pruneRemoteBackups(settings, backupsDir, settings.keep);

  const nextSettings: WebDavSettings = { ...settings, lastBackupAt: bundle.createdAt, lastBackupFile: fileName };
  await writeWebDavSettings(nextSettings);

  return { file: fileName, latestFile: latestName, encrypted: settings.encrypt, size: Buffer.byteLength(content, "utf8"), pruned };
}

async function pruneRemoteBackups(settings: WebDavSettings, backupsDir: string, keep: number): Promise<string[]> {
  const entries = (await listCollection(settings, backupsDir))
    .filter((entry) => !entry.isDirectory && entry.name.startsWith("apikeyhub-"))
    .sort((left, right) => right.name.localeCompare(left.name));

  const removed: string[] = [];
  for (const entry of entries.slice(clampKeep(keep))) {
    await deleteRemotePath(settings, entry.path);
    removed.push(entry.name);
  }
  return removed;
}

export async function listRemoteBackups(settings: WebDavSettings): Promise<WebDavEntry[]> {
  requireCredentials(settings);
  const backupsDir = joinRemotePath(settings.remoteDir, BACKUPS_FOLDER);
  const [rootEntries, backupsEntries] = await Promise.all([
    listCollection(settings, settings.remoteDir),
    listCollection(settings, backupsDir)
  ]);

  // latest.* 在云端根目录，apikeyhub-* 在 backups 子目录
  const latest = rootEntries.find((entry) => !entry.isDirectory && /^latest\.json(\.enc)?$/.test(entry.name));
  const files = backupsEntries
    .filter((entry) => !entry.isDirectory && entry.name.startsWith("apikeyhub-"))
    .sort((left, right) => right.name.localeCompare(left.name));

  return latest ? [{ ...latest, path: joinRemotePath(settings.remoteDir, latest.name) }, ...files] : files;
}

function assertSafeFileName(fileName: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) throw new Error("备份文件名不合法");
}

export async function restoreRemoteBackup(
  settings: WebDavSettings,
  options: { file?: string } = {}
): Promise<{ file: string; encrypted: boolean; configs: number; hotModels: number; localBackupDir: string }> {
  requireCredentials(settings);

  const requested = options.file?.trim() || "";
  if (requested) assertSafeFileName(requested);

  // 文件名 -> 远程路径：latest.* 在根目录，apikeyhub-* 在 backups 子目录
  const candidates = requested
    ? [
        /^latest\.json(\.enc)?$/.test(requested)
          ? joinRemotePath(settings.remoteDir, requested)
          : joinRemotePath(settings.remoteDir, BACKUPS_FOLDER, requested)
      ]
    : [joinRemotePath(settings.remoteDir, `${LATEST_FILE_NAME}.enc`), joinRemotePath(settings.remoteDir, LATEST_FILE_NAME)];

  let content = "";
  let usedPath = "";
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      content = await getRemoteText(settings, candidate);
      usedPath = candidate;
      break;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error("下载云端备份失败");
    }
  }

  if (!usedPath) throw lastError || new Error("云端没有可恢复的备份文件");

  const trimmed = content.trim();
  const encrypted = trimmed.startsWith(`{"format": "${ENCRYPTED_FORMAT}"`) || /"format"\s*:\s*"apikeyhub-backup-encrypted"/.test(trimmed.slice(0, 400));
  let rawText = trimmed;

  if (encrypted) {
    if (!settings.passphrase.trim()) throw new Error("该备份已加密，请先填写加密口令");
    rawText = decryptBackupJson(trimmed, settings.passphrase);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error("云端备份内容不是合法 JSON，恢复已中止");
  }

  const applied = await applyBackupBundle(parsed);
  return {
    file: usedPath.slice(usedPath.lastIndexOf("/") + 1),
    encrypted,
    configs: applied.configs,
    hotModels: applied.hotModels,
    localBackupDir: applied.localBackupDir
  };
}

export async function deleteRemoteBackup(settings: WebDavSettings, fileName: string): Promise<void> {
  requireCredentials(settings);
  assertSafeFileName(fileName);
  await deleteRemotePath(settings, joinRemotePath(settings.remoteDir, BACKUPS_FOLDER, fileName));
}
