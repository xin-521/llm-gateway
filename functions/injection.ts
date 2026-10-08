import type { InjectionPolicy, Protocol } from "./types";

interface Msg {
  role: string;
  content: unknown;
  [k: string]: unknown;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") return p.text;
        if (typeof p.content === "string") return p.content;
        return "";
      })
      .join("\n");
  }
  return "";
}

function textToContent(text: string, original: unknown): unknown {
  if (typeof original === "string") return text;
  if (Array.isArray(original)) {
    return original.map((part) => {
      if (part && typeof part === "object" && typeof (part as Msg).text === "string") {
        return { ...part, text };
      }
      return part;
    });
  }
  return text;
}

/** Collect all text from user-side messages of a normalized message list. */
export function extractUserText(messages: Msg[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "tool")
    .map((m) => contentToText(m.content))
    .join("\n");
}

export function scanText(text: string, patterns: string[]): string[] {
  const hits: string[] = [];
  for (const pat of patterns) {
    try {
      const re = new RegExp(pat, "i");
      if (re.test(text)) hits.push(pat);
    } catch {
      // skip invalid pattern
    }
  }
  return hits;
}

export interface InjectionResult {
  messages: Msg[];
  hits: string[];
  blocked: boolean;
  sanitized: boolean;
}

/**
 * Prompt-injection guard. Scans user/tool messages (and the top-level
 * `system` of Anthropic-style payloads is left untouched — it is the
 * developer's own prompt). Depending on the policy it blocks the request,
 * sanitizes offending phrases, or merely records the hit. Optionally a
 * gateway-level system template is injected/merged into the system prompt.
 */
export function applyInjectionGuard(
  messages: Msg[],
  policy: InjectionPolicy
): InjectionResult {
  const hits = policy.enabled
    ? scanText(extractUserText(messages), policy.patterns)
    : [];
  let blocked = false;
  let sanitized = false;
  let out = messages;

  if (hits.length > 0 && policy.enabled) {
    if (policy.action === "block") {
      blocked = true;
    } else if (policy.action === "sanitize") {
      const res = sanitizeMessages(messages, policy.patterns);
      out = res.messages;
      sanitized = true;
    }
  }

  return { messages: out, hits, blocked, sanitized };
}

function sanitizeMessages(messages: Msg[], patterns: string[]): { messages: Msg[] } {
  const regexes = patterns
    .map((p) => {
      try {
        return new RegExp(p, "gi");
      } catch {
        return null;
      }
    })
    .filter(Boolean) as RegExp[];

  const clean = (text: string) => {
    let t = text;
    for (const re of regexes) t = t.replace(re, "[filtered]");
    return t;
  };

  return {
    messages: messages.map((m) => {
      if (m.role !== "user" && m.role !== "tool") return m;
      const text = contentToText(m.content);
      const cleaned = clean(text);
      if (cleaned === text) return m;
      return { ...m, content: textToContent(cleaned, m.content) };
    }),
  };
}

/**
 * Merge the gateway system template into a normalized message list
 * (OpenAI style: system messages live inside `messages`).
 */
export function injectSystemTemplate(
  messages: Msg[],
  template: string
): Msg[] {
  const guard: Msg = {
    role: "system",
    content: `[Gateway Policy]\n${template}`,
  };
  const idx = messages.findIndex((m) => m.role === "system");
  if (idx === -1) return [guard, ...messages];
  const merged = [...messages];
  merged[idx] = {
    ...merged[idx],
    content: contentToText(merged[idx].content) + "\n\n" + guard.content,
  };
  return merged;
}

/** Anthropic keeps the system prompt as a separate top-level field. */
export function mergeSystemField(system: unknown, template: string): unknown {
  const base = typeof system === "string" ? system : "";
  const extra = `[Gateway Policy]\n${template}`;
  return base ? `${base}\n\n${extra}` : extra;
}

export function injectionErrorMessage(protocol: Protocol): Response {
  const body =
    protocol === "anthropic"
      ? {
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "Request blocked by gateway prompt-injection guard (block mode).",
          },
        }
      : {
          error: {
            message:
              "Request blocked by gateway prompt-injection guard (block mode).",
            type: "gateway_error",
            code: "prompt_injection_blocked",
          },
        };
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
