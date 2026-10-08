export type Protocol = "openai" | "anthropic";

/**
 * EdgeKV is injected by the Aliyun ESA Edge Routine runtime. Declared here so
 * the functions compile standalone (the local dev harness in `.dev/mock/kv.js`
 * provides the same interface).
 */
declare global {
  class EdgeKV {
    static port: number;
    constructor(options: { namespace?: string; namespaceId?: string });
    get(key: string, options?: { type?: "text" | "json" | "stream" | "arrayBuffer" }): Promise<string | null>;
    put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Response
    ): Promise<void>;
    delete(key: string): Promise<void>;
  }
}

export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
  enabled: boolean;
  /** demo-only: built-in mock upstream */
  mock?: boolean;
  /** demo-only: simulated failure probability 0..1 */
  failRate?: number;
  /** demo-only: simulated latency in ms */
  latencyMs?: number;
  extraHeaders?: Record<string, string>;
  createdAt: number;
}

export interface GatewayKey {
  id: string;
  name: string;
  key: string;
  allowedModels: string[] | "all";
  enabled: boolean;
  rateLimitPerMin: number;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface AdminUser {
  username: string;
  name: string;
  role: "owner" | "viewer";
  salt: string;
  hash: string;
}

export interface FailoverPolicy {
  maxAttempts: number;
  timeoutMs: number;
  retryOnStatus: number[];
  circuitFailThreshold: number;
  circuitCooldownMs: number;
}

export interface InjectionPolicy {
  enabled: boolean;
  action: "block" | "sanitize" | "warn";
  patterns: string[];
  systemTemplateEnabled: boolean;
  systemTemplate: string;
}

export interface Policies {
  failover: FailoverPolicy;
  injection: InjectionPolicy;
  loggingEnabled: boolean;
}

export type HealthState = "healthy" | "degraded" | "down";

export interface HealthEntry {
  state: HealthState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  totalRequests: number;
  totalFailures: number;
  lastLatencyMs: number | null;
}

export type HealthMap = Record<string, HealthEntry>;

export interface Attempt {
  providerId: string;
  providerName: string;
  status: number | "error";
  ms: number;
  error?: string;
}

export interface LogEntry {
  id: string;
  ts: number;
  endpoint: string;
  clientProtocol: Protocol;
  model: string;
  keyId: string;
  keyName: string;
  status: number;
  servedBy: string | null;
  servedByName: string | null;
  attempts: Attempt[];
  failoverCount: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  injectionHits: string[];
  blocked: boolean;
  stream: boolean;
}
