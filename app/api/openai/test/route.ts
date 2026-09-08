import { NextRequest, NextResponse } from "next/server";

import { runOpenAITest } from "@/lib/openai-proxy";
import type { OpenAIProxyTestRequest } from "@/lib/openai-proxy-types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<OpenAIProxyTestRequest>;
    const fallbackModels = Array.isArray(body.fallbackModels)
      ? body.fallbackModels
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 16)
      : [];

    return NextResponse.json(
      await runOpenAITest({
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
        apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
        model: typeof body.model === "string" ? body.model : "",
        apiFormat: body.apiFormat === "chat" || body.apiFormat === "responses" || body.apiFormat === "messages" ? body.apiFormat : "auto",
        fallbackModels,
        sweep: body.sweep === true,
      }),
    );
  } catch {
    return NextResponse.json({ message: "请求体不是合法 JSON" }, { status: 400 });
  }
}
