/** WebDAV 备份与同步接口（首发对接坚果云）。
 *
 *  GET  /api/webdav       读取连接配置（密码只回 has* 掩码）与本地数据统计
 *  PUT  /api/webdav       保存连接配置（password/passphrase 留空表示保持原值）
 *  POST /api/webdav       { action: "test" | "backup" | "list" | "restore" | "delete", file?, settings? }
 *
 * action 里的 settings 是「未保存的临时覆盖」，用于「改完地址先测试再保存」的场景；
 * 其中空字符串的 password/passphrase 表示沿用已保存的凭据。
 */

import { NextResponse } from "next/server";
import {
  DEFAULT_WEBDAV_SETTINGS,
  WEBDAV_HINT,
  createRemoteBackup,
  deleteRemoteBackup,
  isHttpUrl,
  listRemoteBackups,
  normalizeBaseUrl,
  normalizeRemoteDir,
  normalizeWebDavSettings,
  readLocalDataSummary,
  readWebDavSettings,
  restoreRemoteBackup,
  testWebDavConnection,
  toWebDavSettingsView,
  writeWebDavSettings,
  type WebDavSettings
} from "@/lib/webdav-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 用请求里的可选字段覆盖已保存配置；空密码/空口令表示沿用原值 */
function mergeSettings(stored: WebDavSettings, input: unknown): { settings: WebDavSettings; error?: string } {
  const record = asRecord(input);
  if (!record) return { settings: { ...stored } };

  const next: WebDavSettings = { ...stored };

  if (typeof record.baseUrl === "string" && record.baseUrl.trim()) {
    const baseUrl = normalizeBaseUrl(record.baseUrl);
    if (!isHttpUrl(baseUrl)) return { settings: next, error: "服务器地址需要以 http:// 或 https:// 开头" };
    next.baseUrl = baseUrl;
  }

  if (typeof record.username === "string") next.username = record.username.trim();
  if (typeof record.password === "string" && record.password) next.password = record.password;
  if (record.clearPassword === true) next.password = "";

  if (typeof record.remoteDir === "string" && record.remoteDir.trim()) next.remoteDir = normalizeRemoteDir(record.remoteDir);
  if (typeof record.encrypt === "boolean") next.encrypt = record.encrypt;
  if (typeof record.passphrase === "string" && record.passphrase) next.passphrase = record.passphrase;
  if (record.clearPassphrase === true) next.passphrase = "";
  if (record.keep !== undefined) next.keep = normalizeWebDavSettings({ keep: record.keep }).keep;

  return { settings: next };
}

export async function GET() {
  try {
    const settings = await readWebDavSettings();
    const local = await readLocalDataSummary();
    return NextResponse.json({
      settings: toWebDavSettingsView(settings),
      local,
      hint: WEBDAV_HINT,
      defaults: {
        baseUrl: DEFAULT_WEBDAV_SETTINGS.baseUrl,
        remoteDir: DEFAULT_WEBDAV_SETTINGS.remoteDir,
        keep: DEFAULT_WEBDAV_SETTINGS.keep
      }
    });
  } catch {
    return NextResponse.json({ error: "读取 WebDAV 配置失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body: unknown = await request.json();
    const stored = await readWebDavSettings();
    const merged = mergeSettings(stored, body);
    if (merged.error) return NextResponse.json({ error: merged.error }, { status: 400 });

    const nextSettings: WebDavSettings = { ...merged.settings, updatedAt: new Date().toISOString() };
    await writeWebDavSettings(nextSettings);
    return NextResponse.json({ settings: toWebDavSettingsView(nextSettings) });
  } catch {
    return NextResponse.json({ error: "保存 WebDAV 配置失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  const record = asRecord(body);
  const action = asStringValue(record?.action);
  const file = asStringValue(record?.file);

  try {
    const stored = await readWebDavSettings();
    const merged = mergeSettings(stored, record?.settings);
    if (merged.error) return NextResponse.json({ error: merged.error }, { status: 400 });
    const settings = merged.settings;

    if (action === "test") {
      const result = await testWebDavConnection(settings);
      return NextResponse.json({
        message: result.created
          ? `连接成功，已创建云端目录 ${result.remoteDir}（现有 ${result.entries} 项）`
          : `连接成功，云端目录 ${result.remoteDir} 现有 ${result.entries} 项`
      });
    }

    if (action === "backup") {
      const result = await createRemoteBackup(settings);
      const saved = await readWebDavSettings();
      return NextResponse.json({
        message: `备份完成：${result.file}（${result.encrypted ? "已加密" : "未加密"}，${(result.size / 1024).toFixed(1)} KB）`,
        file: result.file,
        latestFile: result.latestFile,
        encrypted: result.encrypted,
        size: result.size,
        pruned: result.pruned,
        settings: toWebDavSettingsView(saved)
      });
    }

    if (action === "list") {
      const items = await listRemoteBackups(settings);
      return NextResponse.json({ items, message: items.length ? `云端共 ${items.length} 个文件` : "云端暂无备份" });
    }

    if (action === "restore") {
      const result = await restoreRemoteBackup(settings, { file });
      return NextResponse.json({
        message: `已从 ${result.file} 恢复 ${result.configs} 条配置、${result.hotModels} 个热点模型（覆盖前数据已存到 ${result.localBackupDir}）`,
        file: result.file,
        encrypted: result.encrypted,
        configs: result.configs,
        hotModels: result.hotModels,
        localBackupDir: result.localBackupDir
      });
    }

    if (action === "delete") {
      if (!file) return NextResponse.json({ error: "缺少要删除的文件名" }, { status: 400 });
      await deleteRemoteBackup(settings, file);
      return NextResponse.json({ message: `已删除云端备份 ${file}` });
    }

    return NextResponse.json({ error: `不支持的操作：${action || "(空)"}` }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "WebDAV 操作失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
