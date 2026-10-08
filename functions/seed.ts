import type { AdminUser, GatewayKey, Provider } from "./types";

/**
 * In-code fallback seeds. Dev environments are pre-loaded via kv.json;
 * these constants let login / gateway auth bootstrap a fresh KV store
 * without extra KV read budget.
 */

export const MODELS = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-5", "claude-3-7-sonnet"];

export const SEED_PROVIDERS: Provider[] = [
  {
    id: "prov_mock_openai",
    name: "Mock OpenAI · 主节点",
    protocol: "openai",
    baseUrl: "",
    apiKey: "",
    models: MODELS,
    priority: 1,
    enabled: true,
    mock: true,
    failRate: 0.35,
    latencyMs: 260,
    createdAt: 0,
  },
  {
    id: "prov_mock_anthropic",
    name: "Mock Anthropic · 备份节点",
    protocol: "anthropic",
    baseUrl: "",
    apiKey: "",
    models: MODELS,
    priority: 2,
    enabled: true,
    mock: true,
    failRate: 0.05,
    latencyMs: 420,
    createdAt: 0,
  },
  {
    id: "prov_real_template",
    name: "OpenAI 官方（真实上游示例，未启用）",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    models: ["gpt-4o", "gpt-4o-mini"],
    priority: 3,
    enabled: false,
    createdAt: 0,
  },
];

export const SEED_KEYS: GatewayKey[] = [
  {
    id: "key_demo_main",
    name: "演示密钥 · 全模型",
    key: "sk-gw-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
    allowedModels: "all",
    enabled: true,
    rateLimitPerMin: 0,
    createdAt: 0,
    lastUsedAt: null,
  },
];

export const SEED_USERS: AdminUser[] = [
  {
    username: "admin",
    name: "网关管理员",
    role: "owner",
    salt: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    // PBKDF2-SHA256, 100000 iterations, password: admin123
    hash: "db3ef93c37169e5239c3959a8a624eecbd5968432e32299f71551e75b5060036",
  },
];
