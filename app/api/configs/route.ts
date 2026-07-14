import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ConfigDocument = {
  version: 1;
  configs: unknown[];
};

const CONFIG_DIRECTORY = join(process.cwd(), "data");
const CONFIG_FILE = join(CONFIG_DIRECTORY, "configs.json");

function isConfigDocument(value: unknown): value is ConfigDocument {
  if (typeof value !== "object" || value === null || !("configs" in value)) return false;

  return Array.isArray(value.configs);
}

async function readConfigDocument(): Promise<ConfigDocument> {
  try {
    const content = await readFile(CONFIG_FILE, "utf8");
    const document: unknown = JSON.parse(content);
    return isConfigDocument(document) ? { version: 1, configs: document.configs } : { version: 1, configs: [] };
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { version: 1, configs: [] };
    }

    throw error;
  }
}

async function writeConfigDocument(document: ConfigDocument): Promise<void> {
  await mkdir(CONFIG_DIRECTORY, { recursive: true, mode: 0o700 });

  const temporaryFile = join(CONFIG_DIRECTORY, `configs-${randomUUID()}.tmp`);
  await writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryFile, CONFIG_FILE);
}

export async function GET() {
  try {
    return NextResponse.json(await readConfigDocument());
  } catch {
    return NextResponse.json({ error: "读取项目配置失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const document: unknown = await request.json();
    if (!isConfigDocument(document)) {
      return NextResponse.json({ error: "配置格式无效" }, { status: 400 });
    }

    const normalizedDocument: ConfigDocument = { version: 1, configs: document.configs };
    await writeConfigDocument(normalizedDocument);
    return NextResponse.json(normalizedDocument);
  } catch {
    return NextResponse.json({ error: "保存项目配置失败" }, { status: 500 });
  }
}
