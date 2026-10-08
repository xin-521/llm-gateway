import type { GatewayKey } from "./types";

/**
 * In-code fallback seed for the demo gateway key. The admin account is NOT
 * seeded: a fresh install runs the first-run setup flow so the operator picks
 * their own username/password. Providers are configured entirely from the
 * console.
 */

export const SEED_KEYS: GatewayKey[] = [
  {
    id: "key_demo_main",
    name: "默认密钥 · 全模型",
    key: "sk-gw-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
    allowedModels: "all",
    enabled: true,
    rateLimitPerMin: 0,
    createdAt: 0,
    lastUsedAt: null,
  },
];
