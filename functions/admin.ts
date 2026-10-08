import {
  clearLogs,
  getLogs,
  getPolicies,
  getProviders,
  getSecret,
  getHealth,
  getKeys,
  getUsers,
  saveProviders,
  saveKeys,
  savePolicies,
  saveHealth,
  saveUsers,
} from "./store";
import { pbkdf2Hex, randomHex, signToken, verifyToken, safeEqual } from "./crypto";
import { newGatewayKey, authGatewayKey, handleModels } from "./gateway";
import type { AdminUser, GatewayKey, Policies, Provider } from "./types";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/* ---------------- auth ---------------- */

async function requireAdmin(request: Request): Promise<{ user?: AdminUser; error?: Response }> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: err("Unauthorized", 401) };
  const secret = await getSecret();
  const payload = await verifyToken(secret, token);
  if (!payload) return { error: err("Invalid or expired session", 401) };
  const users = await getUsers();
  const user = users.find((u) => u.username === payload.sub);
  if (!user) return { error: err("User not found", 401) };
  return { user };
}

export async function handleLogin(request: Request): Promise<Response> {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON");
  }
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const users = await getUsers();
  let user = users.find((u) => u.username === username);
  if (!user && users.length === 0) {
    // Bootstrap admin on a completely empty KV store, and persist it so that
    // subsequent token verification (requireAdmin -> getUsers) can find it.
    const { SEED_USERS } = await import("./seed");
    user = SEED_USERS.find((u) => u.username === username);
    if (user) await saveUsers(SEED_USERS);
  }
  if (!user || !password) return err("Invalid username or password", 401);
  const hash = await pbkdf2Hex(password, user.salt);
  if (!safeEqual(hash, user.hash)) return err("Invalid username or password", 401);
  const secret = await getSecret();
  const token = await signToken(secret, {
    sub: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  });
  return json({ token, user: { username: user.username, name: user.name, role: user.role } });
}

export async function handleMe(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const u = auth.user!;
  return json({ username: u.username, name: u.name, role: u.role });
}

export async function handleChangePassword(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  let body: { oldPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON");
  }
  const users = await getUsers();
  const user = users.find((u) => u.username === auth.user!.username);
  if (!user) return err("User not found", 404);
  const oldHash = await pbkdf2Hex(String(body.oldPassword ?? ""), user.salt);
  if (!safeEqual(oldHash, user.hash)) return err("Old password incorrect", 403);
  const next = String(body.newPassword ?? "");
  if (next.length < 8) return err("New password must be at least 8 characters");
  user.salt = randomHex(16);
  user.hash = await pbkdf2Hex(next, user.salt);
  await saveUsers(users);
  return json({ ok: true });
}

/* ---------------- providers ---------------- */

function sanitizeProviderInput(b: Record<string, unknown>, existing?: Provider): Partial<Provider> {
  const out: Partial<Provider> = {};
  if (typeof b.name === "string") out.name = b.name.slice(0, 64);
  if (b.protocol === "openai" || b.protocol === "anthropic") out.protocol = b.protocol;
  if (typeof b.baseUrl === "string") out.baseUrl = b.baseUrl.slice(0, 256);
  if (typeof b.apiKey === "string") out.apiKey = b.apiKey.slice(0, 256);
  if (Array.isArray(b.models)) out.models = b.models.map(String).slice(0, 40);
  if (typeof b.priority === "number") out.priority = b.priority;
  if (typeof b.enabled === "boolean") out.enabled = b.enabled;
  if (typeof b.mock === "boolean") out.mock = b.mock;
  if (typeof b.failRate === "number") out.failRate = Math.min(1, Math.max(0, b.failRate));
  if (typeof b.latencyMs === "number") out.latencyMs = Math.max(0, b.latencyMs);
  if (b.extraHeaders && typeof b.extraHeaders === "object") {
    out.extraHeaders = b.extraHeaders as Record<string, string>;
  }
  if (existing) {
    // keep old key when the console sends back the masked placeholder
    if (out.apiKey === "••••••••" || out.apiKey === "") delete out.apiKey;
  }
  return out;
}

export function maskProvider(p: Provider): Provider {
  return {
    ...p,
    apiKey: p.apiKey ? `${p.apiKey.slice(0, 6)}••••••••` : "",
  };
}

export async function handleProviders(request: Request, subPath: string, method: string): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  if (method === "GET" && !subPath) {
    const list = await getProviders();
    return json(list.map(maskProvider));
  }

  if (method === "POST" && !subPath) {
    const b = await request.json().catch(() => ({}));
    const list = await getProviders();
    const p: Provider = {
      id: `prov_${Date.now()}_${randomHex(3)}`,
      name: String(b.name ?? "Untitled"),
      protocol: b.protocol === "anthropic" ? "anthropic" : "openai",
      baseUrl: String(b.baseUrl ?? ""),
      apiKey: String(b.apiKey ?? ""),
      models: Array.isArray(b.models) ? b.models.map(String) : [],
      priority: typeof b.priority === "number" ? b.priority : list.length + 1,
      enabled: b.enabled !== false,
      mock: !!b.mock,
      failRate: typeof b.failRate === "number" ? Math.min(1, Math.max(0, b.failRate)) : 0,
      latencyMs: typeof b.latencyMs === "number" ? b.latencyMs : 300,
      extraHeaders: (b.extraHeaders as Record<string, string>) ?? undefined,
      createdAt: Date.now(),
    };
    if (!p.mock && !p.baseUrl) return err("baseUrl is required for real providers");
    list.push(p);
    await saveProviders(list);
    return json(maskProvider(p), 201);
  }

  if (method === "PUT" && subPath) {
    const list = await getProviders();
    const idx = list.findIndex((p) => p.id === subPath);
    if (idx === -1) return err("Provider not found", 404);
    const b = await request.json().catch(() => ({}));
    list[idx] = { ...list[idx], ...sanitizeProviderInput(b, list[idx]) };
    await saveProviders(list);
    return json(maskProvider(list[idx]));
  }

  if (method === "DELETE" && subPath) {
    const list = await getProviders();
    const next = list.filter((p) => p.id !== subPath);
    await saveProviders(next);
    return json({ ok: true });
  }

  return err("Not found", 404);
}

/* ---------------- keys ---------------- */

export function maskKey(k: GatewayKey): GatewayKey {
  return { ...k, key: `${k.key.slice(0, 14)}••••${k.key.slice(-4)}` };
}

export async function handleKeys(request: Request, subPath: string, method: string): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  if (method === "GET" && !subPath) {
    return json((await getKeys()).map(maskKey));
  }

  if (method === "POST" && !subPath) {
    const b = await request.json().catch(() => ({}));
    const list = await getKeys();
    const k: GatewayKey = {
      id: `key_${Date.now()}_${randomHex(3)}`,
      name: String(b.name ?? "Untitled key"),
      key: newGatewayKey(),
      allowedModels: b.allowedModels === "all" || Array.isArray(b.allowedModels) ? b.allowedModels : "all",
      enabled: b.enabled !== false,
      rateLimitPerMin: typeof b.rateLimitPerMin === "number" ? b.rateLimitPerMin : 0,
      createdAt: Date.now(),
      lastUsedAt: null,
    };
    list.push(k);
    await saveKeys(list);
    // full key returned ONCE on creation
    return json(k, 201);
  }

  if (method === "PUT" && subPath) {
    const list = await getKeys();
    const idx = list.findIndex((k) => k.id === subPath);
    if (idx === -1) return err("Key not found", 404);
    const b = await request.json().catch(() => ({}));
    if (typeof b.name === "string") list[idx].name = b.name.slice(0, 64);
    if (typeof b.enabled === "boolean") list[idx].enabled = b.enabled;
    if (typeof b.rateLimitPerMin === "number") list[idx].rateLimitPerMin = b.rateLimitPerMin;
    if (b.allowedModels === "all" || Array.isArray(b.allowedModels)) {
      list[idx].allowedModels = b.allowedModels;
    }
    await saveKeys(list);
    return json(maskKey(list[idx]));
  }

  if (method === "DELETE" && subPath) {
    const list = await getKeys();
    await saveKeys(list.filter((k) => k.id !== subPath));
    return json({ ok: true });
  }

  return err("Not found", 404);
}

export async function handleRotateKey(request: Request, keyId: string): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const list = await getKeys();
  const idx = list.findIndex((k) => k.id === keyId);
  if (idx === -1) return err("Key not found", 404);
  list[idx].key = newGatewayKey();
  await saveKeys(list);
  return json(list[idx]);
}

/* ---------------- policies ---------------- */

export async function handlePolicies(request: Request, method: string): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  if (method === "GET") return json(await getPolicies());
  if (method === "PUT") {
    const b = (await request.json().catch(() => ({}))) as Partial<Policies>;
    const current = await getPolicies();
    const next: Policies = {
      failover: { ...current.failover, ...(b.failover ?? {}) },
      injection: { ...current.injection, ...(b.injection ?? {}) },
      loggingEnabled:
        typeof b.loggingEnabled === "boolean" ? b.loggingEnabled : current.loggingEnabled,
    };
    next.failover.maxAttempts = Math.min(6, Math.max(1, next.failover.maxAttempts));
    next.failover.timeoutMs = Math.min(120_000, Math.max(1000, next.failover.timeoutMs));
    next.failover.circuitFailThreshold = Math.max(1, next.failover.circuitFailThreshold);
    next.failover.circuitCooldownMs = Math.max(1000, next.failover.circuitCooldownMs);
    if (next.injection.action !== "block" && next.injection.action !== "sanitize" && next.injection.action !== "warn") {
      next.injection.action = "sanitize";
    }
    if (!Array.isArray(next.injection.patterns)) next.injection.patterns = [];
    await savePolicies(next);
    return json(next);
  }
  return err("Not found", 404);
}

/* ---------------- logs / stats / health ---------------- */

export async function handleLogs(request: Request, method: string): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  if (method === "GET") return json(await getLogs());
  if (method === "DELETE") {
    await clearLogs();
    return json({ ok: true });
  }
  return err("Not found", 404);
}

export async function handleResetHealth(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  await saveHealth({});
  return json({ ok: true });
}

export async function handleStats(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const [logs, providers, health, keys] = await Promise.all([
    getLogs(),
    getProviders(),
    getHealth(),
    getKeys(),
  ]);
  const now = Date.now();
  const last24h = logs.filter((l) => now - l.ts < 24 * 3600 * 1000);
  const total = last24h.length;
  const success = last24h.filter((l) => l.status === 200).length;
  const failovers = last24h.reduce((a, l) => a + l.failoverCount, 0);
  const injectionHits = last24h.filter((l) => l.injectionHits.length > 0).length;
  const blocked = last24h.filter((l) => l.blocked).length;
  const avgLatency = total ? Math.round(last24h.reduce((a, l) => a + l.latencyMs, 0) / total) : 0;
  const tokens = last24h.reduce((a, l) => a + l.promptTokens + l.completionTokens, 0);

  // hourly buckets for the last 24h
  const hourly: { hour: number; requests: number; failures: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = now - (i + 1) * 3600 * 1000;
    const end = now - i * 3600 * 1000;
    const inBucket = logs.filter((l) => l.ts > start && l.ts <= end);
    hourly.push({
      hour: i,
      requests: inBucket.length,
      failures: inBucket.filter((l) => l.status !== 200).length,
    });
  }

  const byProvider: Record<string, { name: string; requests: number; failures: number }> = {};
  for (const p of providers) {
    byProvider[p.id] = { name: p.name, requests: 0, failures: 0 };
  }
  for (const l of last24h) {
    for (const a of l.attempts) {
      if (!byProvider[a.providerId]) {
        byProvider[a.providerId] = { name: a.providerName, requests: 0, failures: 0 };
      }
      byProvider[a.providerId].requests += 1;
      if (a.status !== 200) byProvider[a.providerId].failures += 1;
    }
  }

  return json({
    total24h: total,
    success24h: success,
    failovers,
    injectionHits,
    blocked,
    avgLatency,
    tokens,
    providers: providers.length,
    activeKeys: keys.filter((k) => k.enabled).length,
    hourly,
    byProvider,
    health,
  });
}

/* ---------------- playground (test via gateway itself) ---------------- */

export async function handleTest(request: Request): Promise<Response> {
  // Admin-console playground: authenticates the session, then runs a real
  // chat request through the gateway data plane. The full gateway key is
  // resolved server-side from the selected key id (or pasted directly).
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const b = await request.json().catch(() => ({}));
  let gatewayApiKey = String(b.gatewayKey ?? "");
  if (!gatewayApiKey.startsWith("sk-gw-") && typeof b.keyId === "string") {
    const keys = await getKeys();
    const found = keys.find((k) => k.id === b.keyId && k.enabled);
    if (!found) return err("Key not found or disabled", 404);
    gatewayApiKey = found.key;
  }
  const model = String(b.model ?? "");
  const protocol = b.protocol === "anthropic" ? "anthropic" : "openai";
  if (!gatewayApiKey.startsWith("sk-gw-")) return err("gatewayKey must start with sk-gw-");
  if (!model) return err("model is required");

  const headers = new Headers({ "content-type": "application/json" });
  let inner: Request;
  if (protocol === "anthropic") {
    headers.set("x-api-key", gatewayApiKey);
    headers.set("anthropic-version", "2023-06-01");
    inner = new Request("https://gateway.local/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 256,
        messages: [{ role: "user", content: String(b.prompt ?? "Say hello in one sentence.") }],
      }),
    });
  } else {
    headers.set("authorization", `Bearer ${gatewayApiKey}`);
    inner = new Request("https://gateway.local/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: String(b.prompt ?? "Say hello in one sentence.") }],
      }),
    });
  }
  // route through the same handler (no network hop)
  const { handleChat } = await import("./gateway");
  const res = await handleChat(inner, protocol);
  const text = await res.text();
  return json({ status: res.status, body: safeJson(text) }, res.status);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

export { handleModels };
