/* Shared types between console UI and the Edge Routine gateway. */

export type Protocol = "openai" | "anthropic";

export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
  enabled: boolean;
  mock?: boolean;
  failRate?: number;
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

export interface Stats {
  total24h: number;
  success24h: number;
  failovers: number;
  injectionHits: number;
  blocked: number;
  avgLatency: number;
  tokens: number;
  providers: number;
  activeKeys: number;
  hourly: { hour: number; requests: number; failures: number }[];
  byProvider: Record<string, { name: string; requests: number; failures: number }>;
  health: HealthMap;
}

export interface AdminUser {
  username: string;
  name: string;
  role: "owner" | "viewer";
}
