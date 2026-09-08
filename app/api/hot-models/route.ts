import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type HotModelDocument = {
  version: 1;
  // 关闭时循环测试仍走全量扫描，列表只是先存着
  enabled: boolean;
  models: string[];
};

const DATA_DIRECTORY = join(process.cwd(), "data");
const HOT_MODEL_FILE = join(DATA_DIRECTORY, "hot-models.json");
const MAX_HOT_MODELS = 200;

function normalizeDocument(value: unknown): HotModelDocument {
  if (typeof value !== "object" || value === null) {
    return { version: 1, enabled: false, models: [] };
  }

  const record = value as Record<string, unknown>;
  const models = Array.isArray(record.models)
    ? record.models
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  // 保持用户挑选顺序（循环测试按这个顺序排优先级），只做大小写敏感去重
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model)) continue;
    seen.add(model);
    deduped.push(model);
    if (deduped.length >= MAX_HOT_MODELS) break;
  }

  return { version: 1, enabled: record.enabled === true, models: deduped };
}

async function readHotModelDocument(): Promise<HotModelDocument> {
  try {
    const content = await readFile(HOT_MODEL_FILE, "utf8");
    return normalizeDocument(JSON.parse(content));
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { version: 1, enabled: false, models: [] };
    }

    throw error;
  }
}

async function writeHotModelDocument(document: HotModelDocument): Promise<void> {
  await mkdir(DATA_DIRECTORY, { recursive: true, mode: 0o700 });

  const temporaryFile = join(DATA_DIRECTORY, `hot-models-${randomUUID()}.tmp`);
  await writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryFile, HOT_MODEL_FILE);
}

export async function GET() {
  try {
    return NextResponse.json(await readHotModelDocument());
  } catch {
    return NextResponse.json({ error: "读取热点模型失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let document: unknown;
  try {
    document = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  try {
    const normalizedDocument = normalizeDocument(document);
    await writeHotModelDocument(normalizedDocument);
    return NextResponse.json(normalizedDocument);
  } catch {
    return NextResponse.json({ error: "保存热点模型失败" }, { status: 500 });
  }
}
