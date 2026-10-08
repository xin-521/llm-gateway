import type { Protocol } from "./types";

/* ------------------------------------------------------------------ */
/* Request conversion (OpenAI <-> Anthropic Messages API)             */
/* ------------------------------------------------------------------ */

type Dict = Record<string, unknown>;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && typeof (p as Dict).text === "string"
          ? (p as Dict).text as string
          : ""
      )
      .join("");
  }
  return "";
}

export function openaiToAnthropicRequest(body: Dict): Dict {
  const messages: Dict[] = Array.isArray(body.messages)
    ? (body.messages as Dict[])
    : [];
  const sysParts: string[] = [];
  const out: Dict[] = [];

  for (const m of messages) {
    const role = String(m.role ?? "user");
    if (role === "system" || role === "developer") {
      const t = textOf(m.content);
      if (t) sysParts.push(t);
      continue;
    }
    if (role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id ?? "",
            content: textOf(m.content),
          },
        ],
      });
      continue;
    }
    if (role === "assistant" && Array.isArray(m.tool_calls)) {
      const blocks: Dict[] = [];
      const t = textOf(m.content);
      if (t) blocks.push({ type: "text", text: t });
      for (const tc of m.tool_calls as Dict[]) {
        const fn = (tc.function ?? {}) as Dict;
        let input: Dict = {};
        try {
          input = JSON.parse(String(fn.arguments ?? "{}"));
        } catch {
          input = {};
        }
        blocks.push({
          type: "tool_use",
          id: tc.id ?? `call_${out.length}`,
          name: fn.name ?? "",
          input,
        });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    out.push({ role, content: m.content });
  }

  const req: Dict = {
    model: body.model,
    messages: out,
    max_tokens:
      (body.max_tokens as number) ??
      (body.max_completion_tokens as number) ??
      4096,
  };
  if (sysParts.length) req.system = sysParts.join("\n\n");
  if (typeof body.temperature === "number") req.temperature = body.temperature;
  if (typeof body.top_p === "number") req.top_p = body.top_p;
  if (body.stop) {
    req.stop_sequences = typeof body.stop === "string" ? [body.stop] : body.stop;
  }
  if (body.stream !== undefined) req.stream = body.stream;
  if (Array.isArray(body.tools)) {
    req.tools = (body.tools as Dict[]).map((t) => {
      const fn = (t.function ?? t) as Dict;
      return {
        name: fn.name,
        description: fn.description,
        input_schema: fn.parameters ?? fn.input_schema,
      };
    });
  }
  const tc = body.tool_choice;
  if (tc === "auto") req.tool_choice = { type: "auto" };
  else if (tc === "required") req.tool_choice = { type: "any" };
  else if (tc && typeof tc === "object") {
    const name = ((tc as Dict).function ?? tc as Dict) as Dict;
    req.tool_choice = { type: "tool", name: name.name };
  }
  if (body.metadata && (body.metadata as Dict).user) {
    req.metadata = { user_id: (body.metadata as Dict).user };
  }
  return req;
}

export function anthropicToOpenaiRequest(body: Dict): Dict {
  const messages: Dict[] = [];
  if (body.system) {
    messages.push({ role: "system", content: textOf(body.system) });
  }
  for (const m of (Array.isArray(body.messages) ? body.messages : []) as Dict[]) {
    const role = String(m.role ?? "user");
    if (typeof m.content === "string") {
      messages.push({ role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) {
      messages.push({ role, content: "" });
      continue;
    }
    const textParts: string[] = [];
    const toolCalls: Dict[] = [];
    const toolResults: Dict[] = [];
    for (const block of m.content as Dict[]) {
      const type = block.type;
      if (type === "text") textParts.push(String(block.text ?? ""));
      else if (type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      } else if (type === "tool_result") {
        toolResults.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: textOf(block.content),
        });
      }
    }
    if (toolResults.length) {
      for (const tr of toolResults) messages.push(tr);
    } else if (role === "assistant" && toolCalls.length) {
      messages.push({
        role: "assistant",
        content: textParts.join("") || null,
        tool_calls: toolCalls,
      });
    } else {
      messages.push({ role, content: textParts.join("") });
    }
  }

  const req: Dict = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens ?? 4096,
  };
  if (typeof body.temperature === "number") req.temperature = body.temperature;
  if (typeof body.top_p === "number") req.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences)) req.stop = body.stop_sequences;
  if (body.stream !== undefined) req.stream = body.stream;
  if (Array.isArray(body.tools)) {
    req.tools = (body.tools as Dict[]).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }
  const tch = body.tool_choice as Dict | undefined;
  if (tch?.type === "auto") req.tool_choice = "auto";
  else if (tch?.type === "any") req.tool_choice = "required";
  else if (tch?.type === "tool") req.tool_choice = { type: "function", function: { name: tch.name } };
  else if (tch?.type === "none") req.tool_choice = "none";
  if (body.metadata && (body.metadata as Dict).user_id) {
    req.user = (body.metadata as Dict).user_id;
  }
  return req;
}

/* ------------------------------------------------------------------ */
/* Non-streaming response conversion                                   */
/* ------------------------------------------------------------------ */

const stopReasonToFinish: Dict = {
  end_turn: "stop",
  max_tokens: "length",
  stop_sequence: "stop",
  tool_use: "tool_calls",
};

const finishToStopReason: Dict = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
  content_filter: "end_turn",
};

export function anthropicResponseToOpenai(r: Dict): Dict {
  const blocks = (Array.isArray(r.content) ? r.content : []) as Dict[];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("");
  const toolCalls = blocks
    .filter((b) => b.type === "tool_use")
    .map((b, i) => ({
      id: b.id ?? `call_${i}`,
      type: "function",
      function: {
        name: b.name,
        arguments: JSON.stringify(b.input ?? {}),
      },
    }));
  const usage = (r.usage ?? {}) as Dict;
  const inTok = Number(usage.input_tokens ?? 0);
  const outTok = Number(usage.output_tokens ?? 0);
  return {
    id: `chatcmpl-${String(r.id ?? "").replace(/^msg_/, "") || Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: r.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason:
          stopReasonToFinish[String(r.stop_reason ?? "end_turn")] ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: inTok,
      completion_tokens: outTok,
      total_tokens: inTok + outTok,
    },
  };
}

export function openaiResponseToAnthropic(r: Dict): Dict {
  const choice = ((r.choices ?? [{}]) as Dict[])[0] ?? {};
  const message = (choice.message ?? {}) as Dict;
  const blocks: Dict[] = [];
  const text = typeof message.content === "string" ? message.content : "";
  if (text) blocks.push({ type: "text", text, citations: null });
  for (const tc of (Array.isArray(message.tool_calls) ? message.tool_calls : []) as Dict[]) {
    const fn = (tc.function ?? {}) as Dict;
    let input: unknown = {};
    try {
      input = JSON.parse(String(fn.arguments ?? "{}"));
    } catch {
      input = { raw: fn.arguments };
    }
    blocks.push({ type: "tool_use", id: tc.id, name: fn.name, input });
  }
  const usage = (r.usage ?? {}) as Dict;
  return {
    id: `msg_${String(r.id ?? "").replace(/^chatcmpl-/, "") || Date.now()}`,
    type: "message",
    role: "assistant",
    model: r.model,
    content: blocks,
    stop_reason:
      finishToStopReason[String(choice.finish_reason ?? "stop")] ?? "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.prompt_tokens ?? 0),
      output_tokens: Number(usage.completion_tokens ?? 0),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Streaming conversion (SSE state machines)                           */
/* ------------------------------------------------------------------ */

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Parse one SSE frame ("data: ..." possibly multi-line) -> payload or null. */
function frameData(frame: string): { event: string; data: string } | null {
  let event = "message";
  const datas: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) datas.push(line.slice(5).trimStart());
  }
  if (!datas.length) return null;
  return { event, data: datas.join("\n") };
}

function sseFrame(event: string | null, data: string): string {
  return (event ? `event: ${event}\n` : "") + `data: ${data}\n\n`;
}

const enc = new TextEncoder();

/**
 * Convert an upstream SSE stream to the client protocol. Same-protocol
 * streams are passed through while usage counters are extracted. Returns a
 * new ReadableStream plus a promise resolving with token usage at the end.
 */
export function convertStream(
  upstream: ReadableStream<Uint8Array>,
  from: Protocol,
  to: Protocol
): { stream: ReadableStream<Uint8Array>; usage: Promise<StreamUsage> } {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const usage: StreamUsage = { promptTokens: 0, completionTokens: 0 };
  let resolveUsage!: (u: StreamUsage) => void;
  const usagePromise = new Promise<StreamUsage>((res) => (resolveUsage = res));

  // state
  let buffer = "";
  let textBlockOpen = false;
  let blockIndex = 0;
  const toolCalls: { id: string; name: string; args: string }[] = [];
  let anthropicMsgId = `msg_${Date.now()}`;
  let openaiDoneSent = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (from === "openai" && to === "anthropic") {
          // close any open block + final events
          let tail = "";
          if (textBlockOpen) tail += sseFrame("content_block_stop", "{}");
          for (const tc of toolCalls) {
            let input: unknown = {};
            try {
              input = JSON.parse(tc.args || "{}");
            } catch {
              input = { raw: tc.args };
            }
            tail += sseFrame(
              "content_block_start",
              JSON.stringify({ type: "content_block_start", index: blockIndex++, content_block: { type: "tool_use", id: tc.id, name: tc.name, input } })
            );
            tail += sseFrame("content_block_stop", "{}");
          }
          tail += sseFrame(
            "message_delta",
            JSON.stringify({
              type: "message_delta",
              delta: { stop_reason: toolCalls.length ? "tool_use" : "end_turn", stop_sequence: null },
              usage: { output_tokens: usage.completionTokens },
            })
          );
          tail += sseFrame("message_stop", JSON.stringify({ type: "message_stop" }));
          controller.enqueue(encoder.encode(tail));
        }
        if (from === "openai" && to === "openai" && !openaiDoneSent) {
          controller.enqueue(encoder.encode(sseFrame(null, "[DONE]")));
        }
        controller.close();
        resolveUsage(usage);
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      let out = "";
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = frameData(frame);
        if (!parsed) continue;
        out += transformFrame(parsed.event, parsed.data);
      }
      if (out) controller.enqueue(encoder.encode(out));
    },
    cancel(reason) {
      reader.cancel(reason);
      resolveUsage(usage);
    },
  });

  function transformFrame(event: string, data: string): string {
    if (data === "[DONE]") {
      openaiDoneSent = true;
      return to === "openai" ? sseFrame(null, "[DONE]") : "";
    }
    let obj: Dict;
    try {
      obj = JSON.parse(data);
    } catch {
      return "";
    }

    if (from === "openai") {
      const u = obj.usage as Dict | undefined;
      if (u) {
        usage.promptTokens = Number(u.prompt_tokens ?? usage.promptTokens);
        usage.completionTokens = Number(u.completion_tokens ?? usage.completionTokens);
      }
      if (to === "openai") return sseFrame(null, data);

      // openai -> anthropic events
      const id = String(obj.id ?? anthropicMsgId);
      if (id && !textBlockOpen && !toolCalls.length && !usage.promptTokens) {
        anthropicMsgId = `msg_${id.replace(/^chatcmpl-/, "")}`;
      }
      const choice = ((obj.choices ?? []) as Dict[])[0];
      if (!choice) return "";
      let s = "";
      if (!textBlockOpen && choice.delta) {
        s += sseFrame(
          "message_start",
          JSON.stringify({
            type: "message_start",
            message: {
              id: anthropicMsgId,
              type: "message",
              role: "assistant",
              model: obj.model,
              content: [],
              stop_reason: null,
              usage: { input_tokens: usage.promptTokens, output_tokens: 0 },
            },
          })
        );
        s += sseFrame(
          "content_block_start",
          JSON.stringify({ type: "content_block_start", index: blockIndex, content_block: { type: "text", text: "" } })
        );
        textBlockOpen = true;
      }
      const delta = (choice.delta ?? {}) as Dict;
      if (typeof delta.content === "string" && delta.content) {
        s += sseFrame(
          "content_block_delta",
          JSON.stringify({ type: "content_block_delta", index: blockIndex, delta: { type: "text_delta", text: delta.content } })
        );
      }
      for (const tc of (Array.isArray(delta.tool_calls) ? delta.tool_calls : []) as Dict[]) {
        const i = Number(tc.index ?? 0);
        if (!toolCalls[i]) toolCalls[i] = { id: String(tc.id ?? ""), name: "", args: "" };
        if (tc.id) toolCalls[i].id = String(tc.id);
        const fn = (tc.function ?? {}) as Dict;
        if (fn.name) toolCalls[i].name += String(fn.name);
        if (fn.arguments) toolCalls[i].args += String(fn.arguments);
      }
      if (choice.finish_reason) {
        if (textBlockOpen) {
          s += sseFrame("content_block_stop", JSON.stringify({ type: "content_block_stop", index: blockIndex }));
          textBlockOpen = false;
        }
        s += sseFrame(
          "message_delta",
          JSON.stringify({
            type: "message_delta",
            delta: {
              stop_reason: finishToStopReason[String(choice.finish_reason)] ?? "end_turn",
              stop_sequence: null,
            },
            usage: { output_tokens: usage.completionTokens },
          })
        );
        s += sseFrame("message_stop", JSON.stringify({ type: "message_stop" }));
      }
      return s;
    }

    // from === "anthropic"
    const type = String(obj.type ?? event);
    if (to === "anthropic") {
      const u = obj.usage as Dict | undefined;
      if (type === "message_start") {
        const mu = ((obj.message as Dict | undefined)?.usage ?? {}) as Dict;
        usage.promptTokens = Number(mu.input_tokens ?? 0);
      }
      if (type === "message_delta" && u) {
        usage.completionTokens = Number(u.output_tokens ?? 0);
      }
      return sseFrame(type, data);
    }

    // anthropic -> openai chunks
    const created = Math.floor(Date.now() / 1000);
    const chunkBase = {
      id: `chatcmpl-${anthropicMsgId.replace(/^msg_/, "")}`,
      object: "chat.completion.chunk",
      created,
      model: "",
    };
    if (type === "message_start") {
      const msg = (obj.message ?? {}) as Dict;
      anthropicMsgId = String(msg.id ?? anthropicMsgId);
      const mu = (msg.usage ?? {}) as Dict;
      usage.promptTokens = Number(mu.input_tokens ?? 0);
      return sseFrame(
        null,
        JSON.stringify({ ...chunkBase, model: msg.model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })
      );
    }
    if (type === "content_block_start") {
      const cb = (obj.content_block ?? {}) as Dict;
      if (cb.type === "tool_use") {
        return sseFrame(
          null,
          JSON.stringify({
            ...chunkBase,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: blockIndex, id: cb.id, type: "function", function: { name: cb.name, arguments: "" } },
                  ],
                },
                finish_reason: null,
              },
            ],
          })
        );
      }
      return "";
    }
    if (type === "content_block_delta") {
      const d = (obj.delta ?? {}) as Dict;
      if (d.type === "text_delta") {
        return sseFrame(
          null,
          JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: { content: d.text }, finish_reason: null }] })
        );
      }
      if (d.type === "input_json_delta") {
        return sseFrame(
          null,
          JSON.stringify({
            ...chunkBase,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [{ index: Number(obj.index ?? 0), function: { arguments: d.partial_json ?? "" } }],
                },
                finish_reason: null,
              },
            ],
          })
        );
      }
      return "";
    }
    if (type === "message_delta") {
      const d = (obj.delta ?? {}) as Dict;
      const u = (obj.usage ?? {}) as Dict;
      usage.completionTokens = Number(u.output_tokens ?? usage.completionTokens);
      const finish = stopReasonToFinish[String(d.stop_reason ?? "end_turn")] ?? "stop";
      return sseFrame(
        null,
        JSON.stringify({
          ...chunkBase,
          choices: [{ index: 0, delta: {}, finish_reason: finish }],
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.promptTokens + usage.completionTokens,
          },
        })
      );
    }
    if (type === "message_stop") {
      openaiDoneSent = true;
      return sseFrame(null, "[DONE]");
    }
    return "";
  }

  return { stream, usage: usagePromise };
}

/* ------------------------------------------------------------------ */
/* Endpoint helpers                                                    */
/* ------------------------------------------------------------------ */

export function upstreamUrl(baseUrl: string, protocol: Protocol, stream: boolean): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  const endpoint = protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
  // Already a fully-qualified endpoint (e.g. .../v1/chat/completions).
  if (base.endsWith("/chat/completions") || base.endsWith("/messages")) return base;
  // Most OpenAI/Anthropic SDKs put the /v1 segment inside baseUrl; do not
  // duplicate it (e.g. https://api.openai.com/v1 -> .../v1/chat/completions).
  if (/\/v1$/i.test(base)) base = base.slice(0, -3);
  return base + endpoint;
}

/** Model-listing endpoint. Both OpenAI and Anthropic expose GET /v1/models. */
export function modelsUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  if (/\/models$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) base = base.slice(0, -3);
  return `${base}/v1/models`;
}

export function upstreamHeaders(
  apiKey: string,
  protocol: Protocol,
  extra?: Record<string, string>
): Headers {
  const h = new Headers({ "content-type": "application/json", ...extra });
  if (protocol === "anthropic") {
    h.set("x-api-key", apiKey);
    h.set("anthropic-version", "2023-06-01");
  } else {
    h.set("authorization", `Bearer ${apiKey}`);
  }
  return h;
}

export function countTokensRough(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
