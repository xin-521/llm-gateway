# LLM Gateway · 边缘大模型网关控制台

基于 **Aliyun ESA Functions & Pages**（Edge Routine）构建的多供应商大模型网关：一个边缘端点统一接入 OpenAI / Anthropic 兼容上游，内置优先级路由、自动故障转移、熔断、提示词注入防护与统一密钥管理，配套一个可商用的深色控制台。

- 数据面（标准协议，客户端直接调用）
  - `POST /api/v1/chat/completions` — OpenAI Chat Completions
  - `POST /api/v1/messages` — Anthropic Messages
  - `GET  /api/v1/models` — 模型列表
- 控制面（会话令牌保护，仅控制台使用）
  - `POST /api/admin/login`、`GET /api/admin/me`、`POST /api/admin/change-password`
  - `GET /api/admin/status`、`POST /api/admin/setup`（首次初始化管理员）
  - `CRUD /api/admin/providers[/:id]`、`POST /api/admin/providers/discover-models`（探测上游 `GET /v1/models` 自动识别模型，失败回退手动填写）
  - `CRUD /api/admin/keys[/:id]`、`POST /api/admin/keys/:id/rotate`
  - `GET/PUT /api/admin/policies`、`GET/DELETE /api/admin/logs`
  - `GET /api/admin/stats`、`POST /api/admin/reset-health`、`POST /api/admin/test`

## 技术栈

- **前端**：Vite 5 · React 18 · TypeScript · Tailwind CSS v4 · shadcn/ui (Radix) · TanStack Query · React Router (Hash)
- **边缘后端**：ESA Edge Routine（`functions/`）· EdgeKV 配置存储 · PBKDF2-SHA256 + HMAC 会话令牌
- **字体**：`@fontsource` 自托管（国内可直连，无需 Google Fonts）

## 目录结构

```
functions/        边缘函数（数据面 + 控制面）
src/
  pages/          控制台页面（按路由懒加载）
  components/     ui/ 基础组件 + 业务组件
  hooks/          鉴权等 hooks
  lib/            api 客户端与共享类型
  test/           单元测试
.vesa/            Vite 插件（错误上报 / 设计模式）
.dev/mock/        本地 esa dev 的 KV / Cache 模拟实现
```

## 本地开发

前置：Node.js ≥ 18、[ESA CLI](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages/)、Deno（`esa dev` 运行时）。

```sh
npm ci                 # 安装依赖（国内已指向 npmmirror）
python temp/seed-dev-kv/seed.py   # 首次：把 kv.json 种子写入本地 mock KV
npx esa dev -p 18080   # 终端 A：启动边缘函数（含 mock KV）
npm run dev            # 终端 B：Vite dev server，/api 代理到 18080
```

打开 http://localhost:5173 ，首次访问会进入**初始化管理员**流程：设置你自己的用户名与密码即可进入控制台（不再内置 admin/admin123）。

## 质量校验

```sh
npm run lint       # ESLint（0 error）
npm test           # Vitest 单测
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p functions/tsconfig.json --noEmit
npm run build      # 生产构建（路由级代码分割 + vendor 分包）
```

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
