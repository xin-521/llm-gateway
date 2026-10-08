import {
  appendLog,
  emptyHealth,
  getHealth,
  getKeys,
  getPolicies,
  getProviders,
  saveHealth,
  saveKeys,
} from "./store";
import {
  anthropicResponseToOpenai,
  anthropicToOpenaiRequest,
  convertStream,
  openaiResponseToAnthropic,
  openaiToAnthropicRequest,
  upstreamHeaders,
  upstreamUrl,
} from "./protocols";
import {
  applyInjectionGuard,
  injectSystemTemplate,
  injectionErrorMessage,
  mergeSystemField,
} from "./injection";
import { mockJsonResponse, mockShouldFail, mockStreamResponse } from "./mock";
import { randomHex, safeEqual } from "./crypto";
import type {
  Attempt,
  GatewayKey,
  HealthEntry,
  HealthMap,
  LogEntry,
  Policies,
  Protocol,
  Provider,
} from "./types";

function jsonError(
  protocol: Protocol,
  status: number,
  message: string,
  code?: string
): Response {
  const body =
    protocol === "anthropic"
      ? { type: "error", error: { type: "invalid_request_error", message } }
      : { error: { message, type: "gateway_error", code: code ?? null } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function newGatewayKey(): string {
  return `sk-gw-${randomHex(24)}`;
}

/**
 * Authenticate an incoming gateway request by its API key.
 * KV budget: 1 get (keys) + optional 1 put (rate-limit bookkeeping).
 */
export async function authGatewayKey(
  request: Request
): Promise<{ key: GatewayKey | null; error?: Response }> {
  const auth = request.headers.get("authorization") || "";
  const xkey = request.headers.get("x-api-key") || "";
  const candidate = auth.replace(/^Bearer\s+/i, "").trim() || xkey.trim();
  if (!candidate.startsWith("sk-gw-")) {
    return {
      key: null,
      error: jsonError(
        "openai",
        401,
        "Missing gateway API key. Use Authorization: Bearer sk-gw-... (or x-api-key for Anthropic clients)."
      ),
    };
  }
  const keys = await getKeys();
  let match = keys.find((k) => safeEqual(k.key, candidate));
  if (!match && keys.length === 0) {
    // bootstrap demo keys when KV is completely empty
    const { SEED_KEYS } = await import("./seed");
    match = SEED_KEYS.find((k) => safeEqual(k.key, candidate));
  }
  if (!match) {
    return { key: null, error: jsonError("openai", 401, "Gateway API key not found.") };
  }
  if (!match.enabled) {
    return { key: null, error: jsonError("openai", 403, "Gateway API key is disabled.") };
  }
  if (match.rateLimitPerMin > 0) {
    const now = Date.now();
    if (
      match.lastUsedAt &&
      now - match.lastUsedAt < 60_000 / Math.max(1, match.rateLimitPerMin)
    ) {
      return {
        key: null,
        error: jsonError("openai", 429, `Rate limited to ${match.rateLimitPerMin} req/min for this key.`),
      };
    }
    match.lastUsedAt = now;
    await saveKeys(keys);
  }
  return { key: match };
}

function pickCandidates(
  providers: Provider[],
  body: Record<string, unknown>,
  key: GatewayKey
): Provider[] {
  const model = String(body.model ?? "");
  return providers
    .filter((p) => p.enabled)
    .filter((p) => p.models.includes(model) || p.models.includes("*"))
    .filter(
      (p) =>
        key.allowedModels === "all" ||
        key.allowedModels.includes(model) ||
        key.allowedModels.includes("*")
    )
    .sort((a, b) => a.priority - b.priority);
}

function isRetryable(status: number, retryOn: number[]): boolean {
  if (retryOn.includes(status)) return true;
  return status >= 500;
}

async function callProvider(
  provider: Provider,
  reqBody: Record<string, unknown>,
  clientProtocol: Protocol,
  timeoutMs: number
): Promise<Response> {
  const bodyForProvider =
    provider.protocol === clientProtocol
      ? reqBody
      : provider.protocol === "anthropic"
        ? openaiToAnthropicRequest(reqBody)
        : anthropicToOpenaiRequest(reqBody);

  if (provider.mock) {
    await sleepJitter(provider.latencyMs ?? 300);
    if (mockShouldFail(provider)) {
      return new Response(
        JSON.stringify({
          error: {
            message: `Simulated upstream failure from ${provider.name}`,
            type: "server_error",
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }
    return reqBody.stream
      ? mockStreamResponse(provider, bodyForProvider)
      : mockJsonResponse(provider, bodyForProvider);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(upstreamUrl(provider.baseUrl, provider.protocol, !!reqBody.stream), {
      method: "POST",
      headers: upstreamHeaders(provider.apiKey, provider.protocol, provider.extraHeaders),
      body: JSON.stringify(bodyForProvider),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function sleepJitter(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms * (0.5 + Math.random())));
}

interface LogInput {
  started: number;
  key: GatewayKey;
  body: Record<string, unknown>;
  clientProtocol: Protocol;
  status: number;
  attempts: Attempt[];
  servedBy: string | null;
  servedByName: string | null;
  injectionHits: string[];
  blocked: boolean;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Failover engine with prompt-injection guard.
 * Total KV calls (worst case): keys get+put (2) + providers (1) + policies (1)
 * + health get+put (2) + logs get+put (2) = 8.
 */
export async function handleChat(
  request: Request,
  clientProtocol: Protocol
): Promise<Response> {
  const started = Date.now();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError(clientProtocol, 400, "Invalid JSON body.");
  }

  const auth = await authGatewayKey(request);
  if (!auth.key) return auth.error!;
  const key = auth.key;

  if (!body.model) return jsonError(clientProtocol, 400, "Field `model` is required.");

  const [providers, policies] = await Promise.all([getProviders(), getPolicies()]);

  /* ---------------- prompt-injection guard ---------------- */
  let injectionHits: string[] = [];
  const inj = policies.injection;
  if (inj.enabled || inj.systemTemplateEnabled) {
    if (clientProtocol === "anthropic") {
      const msgs = Array.isArray(body.messages) ? (body.messages as never[]) : [];
      const res = applyInjectionGuard(msgs, inj);
      injectionHits = res.hits;
      let system = body.system;
      if (inj.systemTemplateEnabled && inj.systemTemplate.trim()) {
        system = mergeSystemField(system, inj.systemTemplate);
      }
      body = { ...body, messages: res.messages, ...(system !== undefined ? { system } : {}) };
      if (res.blocked) {
        return finishBlocked(started, key, body, clientProtocol, injectionHits, policies);
      }
    } else {
      let msgs = Array.isArray(body.messages) ? (body.messages as never[]) : [];
      if (inj.systemTemplateEnabled && inj.systemTemplate.trim()) {
        msgs = injectSystemTemplate(msgs, inj.systemTemplate);
      }
      const res = applyInjectionGuard(msgs, inj);
      injectionHits = res.hits;
      body = { ...body, messages: res.messages };
      if (res.blocked) {
        return finishBlocked(started, key, body, clientProtocol, injectionHits, policies);
      }
    }
  }

  /* ---------------- failover loop ---------------- */
  const health = await getHealth();
  const candidates = pickCandidates(providers, body, key);
  if (!candidates.length) {
    return jsonError(
      clientProtocol,
      404,
      `No enabled provider serves model "${body.model}" for this key.`
    );
  }

  const fp = policies.failover;
  const now = Date.now();
  const attempts: Attempt[] = [];
  const openOnes = candidates.filter((p) => {
    const h = health[p.id];
    if (!h || h.state !== "down") return true;
    return h.lastFailureAt !== null && now - h.lastFailureAt > fp.circuitCooldownMs;
  });
  const pool = openOnes.length ? openOnes : candidates;
  const maxAttempts = Math.min(fp.maxAttempts, pool.length);
  let lastError = "all providers failed";

  for (let i = 0; i < maxAttempts; i++) {
    const provider = pool[i];
    const t0 = Date.now();
    let res: Response;
    try {
      res = await callProvider(provider, body, clientProtocol, fp.timeoutMs);
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? `Timeout after ${fp.timeoutMs}ms`
          : `Network error: ${String(e)}`;
      attempts.push({ providerId: provider.id, providerName: provider.name, status: "error", ms: Date.now() - t0, error: msg });
      lastError = msg;
      markFailure(health, provider.id, fp);
      continue;
    }

    if (res.ok) {
      attempts.push({ providerId: provider.id, providerName: provider.name, status: 200, ms: Date.now() - t0 });
      markSuccess(health, provider.id, Date.now() - t0);
      const final = await finalizeResponse(res, provider, clientProtocol, body);
      await saveHealth(health);
      await writeLog({
        started, key, body, clientProtocol, status: 200, attempts,
        servedBy: provider.id, servedByName: provider.name,
        injectionHits, blocked: false,
        promptTokens: final.promptTokens, completionTokens: final.completionTokens,
      }, policies);
      return final.response;
    }

    const text = await res.text().catch(() => "");
    attempts.push({
      providerId: provider.id,
      providerName: provider.name,
      status: res.status,
      ms: Date.now() - t0,
      error: text.slice(0, 200),
    });
    lastError = `HTTP ${res.status} from ${provider.name}`;
    if (isRetryable(res.status, fp.retryOnStatus)) {
      markFailure(health, provider.id, fp);
      continue;
    }
    // non-retryable (e.g. 401/400): surface upstream error to client
    await saveHealth(health);
    await writeLog({
      started, key, body, clientProtocol, status: res.status, attempts,
      servedBy: provider.id, servedByName: provider.name,
      injectionHits, blocked: false, promptTokens: 0, completionTokens: 0,
    }, policies);
    return new Response(text || JSON.stringify({ error: { message: lastError } }), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" },
    });
  }

  await saveHealth(health);
  await writeLog({
    started, key, body, clientProtocol, status: 502, attempts,
    servedBy: null, servedByName: null,
    injectionHits, blocked: false, promptTokens: 0, completionTokens: 0,
  }, policies);
  return jsonError(
    clientProtocol,
    502,
    `All ${attempts.length} provider attempt(s) failed. Last error: ${lastError}`,
    "all_providers_failed"
  );
}

async function finishBlocked(
  started: number,
  key: GatewayKey,
  body: Record<string, unknown>,
  clientProtocol: Protocol,
  injectionHits: string[],
  policies: Policies
): Promise<Response> {
  await writeLog({
    started, key, body, clientProtocol, status: 400, attempts: [],
    servedBy: null, servedByName: null,
    injectionHits, blocked: true, promptTokens: 0, completionTokens: 0,
  }, policies);
  return injectionErrorMessage(clientProtocol);
}

async function finalizeResponse(
  res: Response,
  provider: Provider,
  clientProtocol: Protocol,
  body: Record<string, unknown>
): Promise<{ response: Response; promptTokens: number; completionTokens: number }> {
  const ct = res.headers.get("content-type") || "";
  const isStream = !!body.stream;

  if (isStream && ct.includes("text/event-stream") && res.body) {
    if (provider.protocol === clientProtocol) {
      return { response: res, promptTokens: 0, completionTokens: 0 };
    }
    const converted = convertStream(res.body, provider.protocol, clientProtocol);
    return {
      response: new Response(converted.stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-gateway-converted": `${provider.protocol}->${clientProtocol}`,
        },
      }),
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  let out = json;
  if (provider.protocol !== clientProtocol) {
    out =
      clientProtocol === "openai"
        ? anthropicResponseToOpenai(json)
        : openaiResponseToAnthropic(json);
  }
  const usage = (out.usage ?? {}) as Record<string, number>;
  const promptTokens =
    clientProtocol === "anthropic"
      ? Number(usage.input_tokens ?? 0)
      : Number(usage.prompt_tokens ?? 0);
  const completionTokens =
    clientProtocol === "anthropic"
      ? Number(usage.output_tokens ?? 0)
      : Number(usage.completion_tokens ?? 0);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.protocol !== clientProtocol) {
    headers["x-gateway-converted"] = `${provider.protocol}->${clientProtocol}`;
  }
  return {
    response: new Response(JSON.stringify(out), { headers }),
    promptTokens,
    completionTokens,
  };
}

function markFailure(health: HealthMap, id: string, fp: Policies["failover"]) {
  const h = health[id] ?? emptyHealth();
  h.consecutiveFailures += 1;
  h.totalFailures += 1;
  h.lastFailureAt = Date.now();
  h.state = h.consecutiveFailures >= fp.circuitFailThreshold ? "down" : "degraded";
  health[id] = h;
}

function markSuccess(health: HealthMap, id: string, ms: number) {
  const h = health[id] ?? emptyHealth();
  h.consecutiveFailures = 0;
  h.lastSuccessAt = Date.now();
  h.lastLatencyMs = ms;
  h.state = "healthy";
  health[id] = h;
}

async function writeLog(input: LogInput, policies: Policies): Promise<void> {
  if (!policies.loggingEnabled) return;
  const entry: LogEntry = {
    id: `log_${Date.now()}_${randomHex(4)}`,
    ts: Date.now(),
    endpoint: input.clientProtocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions",
    clientProtocol: input.clientProtocol,
    model: String(input.body.model ?? ""),
    keyId: input.key.id,
    keyName: input.key.name,
    status: input.status,
    servedBy: input.servedBy,
    servedByName: input.servedByName,
    attempts: input.attempts,
    failoverCount: Math.max(0, input.attempts.length - (input.status === 200 ? 1 : 0)),
    latencyMs: Date.now() - input.started,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    injectionHits: input.injectionHits,
    blocked: input.blocked,
    stream: !!input.body.stream,
  };
  await appendLog(entry);
}

export async function handleModels(request: Request): Promise<Response> {
  const auth = await authGatewayKey(request);
  if (!auth.key) return auth.error!;
  const providers = await getProviders();
  const models = new Set<string>();
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) if (m !== "*") models.add(m);
  }
  const now = Math.floor(Date.now() / 1000);
  const data = Array.from(models).map((id) => ({
    id,
    object: "model",
    created: now,
    owned_by: "llm-gateway",
  }));
  return new Response(JSON.stringify({ object: "list", data }), {
    headers: { "content-type": "application/json" },
  });
}
