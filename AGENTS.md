# AGENTS.md

供 ZCode agent 在 `/opt/ApiKeyHub`（项目名：**AI Key Vault / ApiKeyHub**）中工作时遵循的工作区说明。

## 语言与文档要求

- 面向用户的所有回复默认使用**简体中文**。
- 新增或生成的说明文档、交接文档、提交说明、变更摘要、用户可见文案默认使用**简体中文**。
- 代码标识符、第三方 API 名称、命令、路径、配置键、协议名等保留原文，不强行翻译。
- 如果上游规范或库文档必须使用英文原词，可以保留英文术语，但解释说明应使用中文。

## 项目简介

这是一个小型单页 Next.js 应用，用来管理 OpenAI 兼容的 AI API Key 配置：项目侧保存配置、粘贴解析 `curl` / JSON / `ccswitch://` / `cc-switch` SQL、连通性测试、模型列表探测、模型延迟评测。配置持久化在项目 `data/configs.json`；服务端另提供同源 OpenAI 代理，用于绕过浏览器直接请求上游服务时的 CORS 限制。主题偏好仍保存在浏览器 `localStorage`。

技术栈：**Next.js 16 + React 19 + TypeScript（strict）+ Tailwind CSS v4 + ECharts**。构建输出模式为 `standalone`（见 `next.config.ts`）。

## 目录结构

- `app/page.tsx`：完整客户端 UI（一个较大的 `"use client"` 组件）。大多数功能改动都在这里。
- `app/layout.tsx`：根布局、字体、主题初始化脚本、元数据。
- `app/globals.css`：Tailwind v4 引入与语义化颜色变量（见“主题与 UI 约定”）。
- `app/api/configs/route.ts`：配置持久化 API（`GET` / `PUT`），原子读写 `data/configs.json`。这是唯一允许落盘配置的服务端路由。
- `app/api/openai/{test,probe,benchmark}/route.ts`：三个很薄的 POST 路由处理器。只负责解析 JSON body、调用 `lib/openai-proxy.ts`、返回 JSON。都设置 `export const runtime = "nodejs"`。
- `lib/openai-proxy.ts`：所有上游请求逻辑：Base URL 规范化、API 格式选择、stream/chat/`/responses` fallback 链、模型探测（`/models` + 候选模型探测）、评测轮次。供 API 路由调用。
- `lib/openai-proxy-types.ts`：客户端与服务端共享的请求/响应类型。
- `lib/cc-switch-sql.ts`：导入用 SQL / 文本 / `ccswitch://` 解析器，仅由 `app/page.tsx` 使用。
- `data/`：运行时配置目录；仅提交 `.gitkeep`，`configs.json` 不得入库。
- `proxy.ts`：Next middleware（默认导出 `proxy`），用于清理旧 service worker 与 Vite 风格 dev 路径。只有迁移清理逻辑需要变化时才修改。
- `public/`：静态资源；`logo.png` 是应用图标。

## 常用命令

```bash
npm install
npm run dev          # 启动开发服务：http://localhost:3000
npm run build        # 生产构建（standalone 输出）
npm run start        # 启动生产构建
npm run lint         # eslint（flat config 在 eslint.config.mjs）

npm run docker:deploy   # docker compose up -d --build
npm run docker:logs     # 跟随容器日志
npm run docker:down     # 停止容器
```

当前没有配置测试框架。如需只做 TypeScript 类型检查，可运行 `npx tsc --noEmit`（`build` 也会执行类型检查）。

## 架构规则

- **配置存储。** `app/api/configs/` 是唯一允许持久化配置的服务端路由，负责将配置原子写入项目 `data/configs.json`。其他服务端路由不得存储 Key 或配置；客户端（`app/page.tsx`）负责配置状态并通过该 API 同步。
- **导入路径：** 使用 `@/*` 路径别名（映射到仓库根目录，见 `tsconfig.json`），例如：`import { runOpenAITest } from "@/lib/openai-proxy"`。
- **API 契约：** 三个端点的请求/响应结构定义在 `lib/openai-proxy-types.ts`。如果改字段，必须同步更新路由处理器与 `app/page.tsx` 中的客户端调用点（`/api/openai/{test,probe,benchmark}`）。
- **上游请求** 通过 `fetch` + `AbortController` 超时实现（见 `lib/openai-proxy.ts` 中的 `fetchWithTimeout`）。自动测试的默认尝试顺序有意设计为：stream → chat → `/responses`，带 fallback 判断；除非明确重设计，否则不要随意改顺序。

## 持久化与客户端 Key 注意事项

- 配置保存在项目 `data/configs.json`，由 `app/api/configs/route.ts` 原子写入。文件包含 API Key，必须保持在 `.gitignore` 与 `.dockerignore` 中，禁止输出到日志或提交到 Git。
- 主题模式保存在 `"ai-key-vault-theme-v1"`（`"system" | "light" | "dark"`）。`app/layout.tsx` 中的内联 `themeInitScript` 会在水合前给 `<html>` 加 `.dark`，避免闪烁；它必须和 CSS dark variant 保持一致。
- Key 由项目配置文件保存，测试/探测/评测时会 POST 到同源代理。不要添加任何会输出 `apiKey` 的日志。

## 主题与 UI 约定

- Tailwind v4 通过 `app/globals.css` 中的 `@import "tailwindcss"` 配置。dark variant 通过 `@custom-variant dark (&:where(.dark, .dark *))` 重映射，跟随 `<html>` 上的 `.dark` 类，**不是** `prefers-color-scheme`。
- 颜色使用语义化 CSS 变量（`--bg-page`、`--bg-card`、`--text-strong`、`--accent` 等），分别定义在 `:root` 与 `.dark`。优先使用这些 token（如 Tailwind 类 `bg-bg-page`、`text-text-strong`），不要优先写死 `zinc-*` 工具类。
- `app/globals.css` 里有一段 `.dark` 覆盖规则，会把硬编码的浅色 Tailwind 类（如 `.dark .bg-white`）映射到暗色 token。新增 JSX 如果用了原始 `zinc-*` 类，要么补 `dark:` 变体，要么扩展覆盖规则，否则暗色模式会显示异常。
- 字体：通过 `next/font/google` 使用 Geist + Geist Mono（变量为 `--font-geist-sans` / `--font-geist-mono`）。
- 图标：`react-icons/fa`。图表：`echarts-for-react`，动态导入。

## Docker

`Dockerfile` 是基于 `node:22-alpine` 的两阶段构建，会复制 standalone 输出，并以非 root 的 `nextjs` 用户在 3000 端口运行 `node server.js`。`docker-compose.yml` 构建镜像 `ai-key-manage:latest` 并映射 `3000:3000`、挂载项目 `data/` 到容器 `/app/data`。`.dockerignore` 会排除 `.git`、`.next`、`.codex`、`node_modules`、`data/` 以及 Docker/compose 文件本身。
