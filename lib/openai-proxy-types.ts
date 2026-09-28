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
  // 循环测试逐模型扫描：只测这一个模型，跳过瞬时错误整体重试并收紧总时限，
  // 避免个别慢模型把整轮扫描拖垮、也避免同一站点被连续打满 RPM
  sweep?: boolean;
  // 自定义测试提问词：留空回落服务端默认的「你是谁」，避免发空请求
  prompt?: string;
  // 客户端断开（立即暂停/关闭页面）时透传的信号：中断在飞的上游请求，不再白烧 token
  signal?: AbortSignal;
};

export type OpenAIProxyTestResponse = {
  ok: boolean;
  result: {
    status: "success" | "error";
    message: string;
    detail?: string;
    // 候选链命中时记录实际通过的模型，可能不同于配置里的模型
    model?: string;
    responseText?: string;
    responseSource?: "stream" | "chat" | "responses" | "messages";
    testedAt: string;
    // 本次测试（含候选链与重试）的总耗时，供循环测试展示
    elapsedMs?: number;
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
