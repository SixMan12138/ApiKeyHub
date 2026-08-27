export type OpenAIProxyApiFormat = "auto" | "chat" | "responses" | "messages";

export type OpenAIProxyBaseRequest = {
  baseUrl: string;
  apiKey: string;
};

export type OpenAIProxyTestRequest = OpenAIProxyBaseRequest & {
  model?: string;
  apiFormat?: OpenAIProxyApiFormat;
  // 探测到的站点模型列表：配置未填模型时按序尝试，避免拿写死的默认模型撞渠道分组
  fallbackModels?: string[];
};

export type OpenAIProxyTestResponse = {
  ok: boolean;
  result: {
    status: "success" | "error";
    message: string;
    detail?: string;
    responseText?: string;
    responseSource?: "stream" | "chat" | "responses" | "messages";
    testedAt: string;
  };
};

export type OpenAIProxyProbeRequest = OpenAIProxyBaseRequest & {
  currentModel?: string;
};

export type OpenAIProxyProbeResponse = {
  ok: boolean;
  result: {
    status: "success" | "error";
    supportedModels: string[];
    recommendedModel?: string;
    detail?: string;
    testedAt: string;
  };
};

export type OpenAIProxyBenchmarkRoundRequest = OpenAIProxyBaseRequest & {
  model: string;
};

export type OpenAIProxyBenchmarkRoundResponse = {
  ok: boolean;
  sample?: {
    elapsedMs: number;
    firstTokenMs?: number;
  };
  error?: string;
};
