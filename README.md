# LLM Gateway · 边缘大模型网关

基于 **Aliyun ESA Functions & Pages**（Edge Routine）构建的多供应商大模型网关：一个边缘端点统一接入 OpenAI / Anthropic 兼容上游，内置优先级路由、自动故障转移、熔断、限流、提示词注入防护与统一密钥管理。

## 核心特性

- **多供应商统一接入**：每个 Provider 配置协议（OpenAI / Anthropic）、baseUrl、API Key、模型列表、优先级与启用开关
- **优先级路由 + 自动故障转移**：按优先级依次尝试上游，可配置最大重试次数、超时与重试状态码
- **熔断与健康状态**：连续失败达到阈值自动熔断，冷却期后恢复；健康状态分 `healthy` / `degraded` / `down`
- **限流**：网关密钥级 `rateLimitPerMin`（isolate 内存计数实现）
- **提示词注入防护**：正则模式匹配 + `block` / `sanitize` / `warn` 三种处置策略，可选系统模板注入
- **协议转换**：OpenAI ↔ Anthropic 请求/响应/流式双向转换；兼容 OpenAI Responses API
- **统一密钥管理**：网关密钥支持模型白名单、限流、启用/停用与轮换
- **控制台**：Dashboard、Providers、Keys、Policies、Logs、Playground 六大页面

## API

### 数据面（网关密钥鉴权：`Authorization: Bearer sk-gw-…` 或 `x-api-key`）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/chat/completions` | OpenAI Chat Completions（含流式） |
| `POST` | `/api/v1/messages` | Anthropic Messages（含流式） |
| `POST` | `/api/v1/responses` | OpenAI Responses API 兼容层（为 Vercel AI SDK / openai Responses SDK 类客户端提供 shim） |
| `GET` | `/api/v1/models` | 聚合模型列表 |

调用示例（本地开发，Vite 5173 的 `/api` ）：

```sh
# OpenAI 协议
curl http://localhost:5173/api/v1/chat/completions \
  -H "Authorization: Bearer sk-gw-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'

# Anthropic 协议（SDK 类客户端自动使用 x-api-key）
curl http://localhost:5173/api/v1/messages \
  -H "x-api-key: sk-gw-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-5-sonnet","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}'
```

### 控制面（会话令牌保护，仅控制台使用）

- `POST /api/admin/login`、`GET /api/admin/me`、`POST /api/admin/change-password`
- `GET /api/admin/status`、`POST /api/admin/setup`（首次初始化管理员）
- `CRUD /api/admin/providers[/:id]`、`POST /api/admin/providers/discover-models`（探测上游 `GET /v1/models` 自动识别模型，失败回退手动填写）
- `CRUD /api/admin/keys[/:id]`、`POST /api/admin/keys/:id/rotate`
- `GET/PUT /api/admin/policies`、`GET/DELETE /api/admin/logs`
- `GET /api/admin/stats`、`POST /api/admin/reset-health`、`POST /api/admin/test`

## 技术栈

- **前端**：Vite 5 · React 18 · TypeScript · Tailwind CSS v4 · shadcn/ui (Radix) · TanStack Query · React Router (Hash)
- **边缘后端**：ESA Edge Routine（`functions/`）· EdgeKV 配置存储 · WebCrypto（PBKDF2-SHA256 + HMAC 会话令牌），无第三方后端依赖
- **字体**：`@fontsource` 自托管

## 目录结构

```
functions/        边缘函数（数据面 + 控制面，真正的网关后端）
  index.ts        ESA Edge Routine 入口：CORS 预检 + 路由分发
  gateway.ts      数据面核心：鉴权、限流、优先级路由、故障转移、熔断、日志
  protocols.ts    OpenAI ↔ Anthropic 双向协议转换
  responses.ts    OpenAI Responses API 兼容层
  injection.ts    提示词注入防护
  crypto.ts       PBKDF2 / HMAC 会话令牌 / 常量时间比较
  store.ts        EdgeKV 访问层（namespace "gw"）
  admin.ts        控制面 handlers
  mock.ts         内置 mock 上游（演示故障转移/协议转换）
  types.ts        共享类型
src/
  pages/          控制台页面（按路由懒加载）
  components/     ui/ 基础组件 + 业务组件
  hooks/          鉴权等 hooks
  lib/            api 客户端与共享类型
  test/           单元测试（Vitest + jsdom）
public/           favicon、llms.txt、robots.txt
```

## 本地开发

前置：Node.js ≥ 18、[ESA CLI](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages/)、Deno（`esa dev` 运行时）。

```sh
npm ci                            # 安装依赖
python temp/seed-dev-kv/seed.py   # 首次：把 kv.json 种子写入本地 mock KV
npx esa dev -p 18080              # 终端 A：启动边缘函数（含 mock KV）
npm run dev                       # 终端 B：Vite dev server，/api 代理到 18080
```

打开 http://localhost:5173 ，首次访问会进入**初始化管理员**流程：设置你自己的用户名与密码即可进入控制台（不内置默认账号）。

`kv.json` 种子数据默认含一个演示网关密钥、故障转移与注入防护默认策略，可在控制台中修改。

## 质量校验

```sh
npm run lint       # ESLint（0 error）
npm test           # Vitest 单测
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p functions/tsconfig.json --noEmit
npm run build      # 生产构建（路由级代码分割 + vendor 分包）
```

测试覆盖（`npm test`）：

| 测试文件 | 用例 | 覆盖模块 |
|---|---|---|
| `src/test/protocols.test.ts` | 6 | `upstreamUrl`（/v1 去重）、`modelsUrl` |
| `src/test/responses.test.ts` | 8 | Responses ↔ Chat Completions 请求/响应/流式转换 |
| `src/test/vite-error-plugin.test.ts` | 23 | `.vesa/vite-error-plugin.js` 注入与运行时行为 |
| `src/test/example.test.ts` | 1 | 占位示例 |

## 部署（ESA Functions & Pages）

```sh
esa-cli login
esa-cli deploy        # 使用 esa.jsonc 的 entry 与 dist 静态资源
```

`esa.jsonc` 已配置 `functions/index.ts` 为入口、`dist` 为静态资源目录、SPA 404 回退。`kv.json` 为首次部署时可导入的 KV 初始数据（默认只带一个网关密钥，管理员账号由首次初始化创建）。

## 安全说明

- 上游 API Key 只存于边缘 KV，转发时注入，不会下发到浏览器。
- 控制台密码使用 PBKDF2-SHA256（10 万次迭代）校验；会话为 HMAC 签名的 12 小时短时令牌。
- 网关密钥 `sk-gw-…` 完整值仅在创建 / 轮换时展示一次。
- 注入防护支持 `block` / `sanitize` / `warn` 三种处置策略。
