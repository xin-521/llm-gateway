import { handleChat } from "./gateway";
import { randomHex } from "./crypto";

/**
 * OpenAI Responses API (`POST /v1/responses`) compatibility layer.
 *
 * Many current clients (Vercel AI SDK v5 `@ai-sdk/openai`, the `openai`
 * Responses SDK, Codex-style agents) default to the Responses endpoint. The
 * gateway core speaks Chat Completions, so we translate in both directions:
 *   Responses request  -> Chat Completions request -> handleChat()
 *   Chat Completions response/SSE -> Responses response/SSE
 */

type Dict = Record<string, unknown>;

function contentToText(content: unknown): string {
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

/**
 * Convert a Responses `input` (string or item array) into Chat Completions
 * messages. Unknown item types are skipped rather than failing the request.
 */
function inputToMessages(input: unknown): Dict[] {
  const messages: Dict[] = [];
  if (typeof input === "string") {
    if (input) messages.push({ role: "user", content: input });
    return messages;
  }
  if (!Array.isArray(input)) return messages;

  const pushAssistantToolCall = (call: Dict) => {
    const last = messages[messages.length - 1];
    const toolCall = {
      id: String(call.call_id ?? `call_${randomHex(6)}`),
      type: "function",
      function: {
        name: String(call.name ?? ""),
        arguments:
          typeof call.arguments === "string"
            ? call.arguments
            : JSON.stringify(call.arguments ?? {}),
      },
    };
    if (last && last.role === "assistant" && Array.isArray(last.tool_calls)) {
      (last.tool_calls as Dict[]).push(toolCall);
      return;
    }
    messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
  };

  for (const raw of input as Dict[]) {
    if (!raw || typeof raw !== "object") continue;
    const type = String(raw.type ?? (raw.role ? "message" : ""));
    if (type === "message") {
      const role = String(raw.role ?? "user");
      const parts = raw.content;
      if (typeof parts === "string") {
        messages.push({ role, content: parts });
        continue;
      }
      if (!Array.isArray(parts)) {
        messages.push({ role, content: "" });
        continue;
      }
      const textParts: string[] = [];
      const images: Dict[] = [];
      for (const p of parts as Dict[]) {
        if (!p || typeof p !== "object") continue;
        if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
          textParts.push(String(p.text ?? ""));
        } else if (p.type === "input_image" && p.image_url) {
          images.push({ type: "image_url", image_url: { url: String(p.image_url) } });
        } else if (p.type === "refusal") {
          textParts.push(String(p.refusal ?? ""));
        }
      }
      const content = images.length
        ? [
            ...(textParts.length ? [{ type: "text", text: textParts.join("") }] : []),
            ...images,
          ]
        : textParts.join("");
      messages.push({ role, content });
    } else if (type === "function_call") {
      pushAssistantToolCall(raw);
    } else if (type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: String(raw.call_id ?? ""),
        content:
          typeof raw.output === "string" ? raw.output : contentToText(raw.output) || "{}",
      });
    }
    // `reasoning` items carry no chat-completions equivalent here; skip.
  }
  return messages;
}

/** Responses request -> OpenAI Chat Completions request. */
export function responsesToChatRequest(body: Dict): Dict {
  const messages: Dict[] = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  }
  messages.push(...inputToMessages(body.input));

  const chat: Dict = { model: body.model, messages };
  if (body.stream !== undefined) chat.stream = body.stream;
  if (typeof body.temperature === "number") chat.temperature = body.temperature;
  if (typeof body.top_p === "number") chat.top_p = body.top_p;
  const max = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
  if (typeof max === "number") chat.max_tokens = max;

  if (Array.isArray(body.tools)) {
    const tools = (body.tools as Dict[])
      .filter((t) => t && t.type === "function")
      .map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters ?? t.input_schema,
        },
      }));
    if (tools.length) chat.tools = tools;
  }

  const tc = body.tool_choice;
  if (typeof tc === "string") chat.tool_choice = tc;
  else if (tc && typeof tc === "object") {
    const d = tc as Dict;
    if (d.type === "function" && d.name) {
      chat.tool_choice = { type: "function", function: { name: d.name } };
    } else if (d.type === "auto" || d.type === "required" || d.type === "none") {
      chat.tool_choice = d.type;
    }
  }

  const fmt = (body.text as Dict | undefined)?.format as Dict | undefined;
  if (fmt && fmt.type === "json_object") {
    chat.response_format = { type: "json_object" };
  } else if (fmt && fmt.type === "json_schema") {
    chat.response_format = {
      type: "json_schema",
      json_schema: { name: fmt.name ?? "response", schema: fmt.schema, strict: fmt.strict },
    };
  }
  return chat;
}

function finishToStatus(finish: unknown): {
  status: string;
  incomplete?: Dict;
} {
  if (finish === "length") {
    return { status: "incomplete", incomplete: { reason: "max_output_tokens" } };
  }
  if (finish === "content_filter") {
    return { status: "incomplete", incomplete: { reason: "content_filter" } };
  }
  return { status: "completed" };
}

/** OpenAI Chat Completions JSON -> Responses JSON. */
export function chatJsonToResponses(json: Dict): Dict {
  const choice = ((json.choices ?? [{}]) as Dict[])[0] ?? {};
  const message = (choice.message ?? {}) as Dict;
  const output: Dict[] = [];
  const text = typeof message.content === "string" ? message.content : "";
  if (text) {
    output.push({
      type: "message",
      id: `msg_${randomHex(10)}`,
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }
  for (const tc of (Array.isArray(message.tool_calls) ? message.tool_calls : []) as Dict[]) {
    const fn = (tc.function ?? {}) as Dict;
    output.push({
      type: "function_call",
      id: `fc_${randomHex(10)}`,
      call_id: String(tc.id ?? `call_${randomHex(6)}`),
      name: String(fn.name ?? ""),
      arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      status: "completed",
    });
  }
  const usage = (json.usage ?? {}) as Dict;
  const prompt = Number(usage.prompt_tokens ?? 0);
  const completion = Number(usage.completion_tokens ?? 0);
  const { status, incomplete } = finishToStatus(choice.finish_reason);
  return {
    id: `resp_${randomHex(12)}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: json.model,
    output,
    output_text: text,
    ...(incomplete ? { incomplete_details: incomplete } : {}),
    usage: {
      input_tokens: prompt,
      output_tokens: completion,
      total_tokens: Number(usage.total_tokens ?? prompt + completion),
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function sseFrame(event: string | null, data: string): string {
  return (event ? `event: ${event}\n` : "") + `data: ${data}\n\n`;
}

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

export interface ResponsesStreamUsage {
  promptTokens: number;
  completionTokens: number;
}

interface ToolSlot {
  itemId: string;
  callId: string;
  name: string;
  args: string;
  outputIndex: number;
}

/**
 * Convert an OpenAI Chat Completions SSE stream into Responses API SSE events.
 * Emits the event names consumed by the OpenAI SDK / Vercel AI SDK parsers.
 */
export function chatStreamToResponses(
  upstream: ReadableStream<Uint8Array>,
  model: string
): { stream: ReadableStream<Uint8Array>; usage: Promise<ResponsesStreamUsage> } {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const usage: ResponsesStreamUsage = { promptTokens: 0, completionTokens: 0 };
  let resolveUsage!: (u: ResponsesStreamUsage) => void;
  const usagePromise = new Promise<ResponsesStreamUsage>((res) => (resolveUsage = res));

  const responseId = `resp_${randomHex(12)}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const textItemId = `msg_${randomHex(10)}`;
  const tools: (ToolSlot | undefined)[] = [];

  let buffer = "";
  let seq = 0;
  let started = false;
  let finalized = false;
  let textIndex = -1;
  let text = "";
  let nextOutputIndex = 0;
  let finishReason: unknown = null;

  const responseBase = (status: string, output: Dict[], incomplete?: Dict): Dict => ({
    id: responseId,
    object: "response",
    created_at: createdAt,
    status,
    model,
    output,
    ...(incomplete ? { incomplete_details: incomplete } : {}),
    usage: {
      input_tokens: usage.promptTokens,
      output_tokens: usage.completionTokens,
      total_tokens: usage.promptTokens + usage.completionTokens,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });

  const ev = (type: string, payload: Dict): string =>
    sseFrame(type, JSON.stringify({ type, sequence_number: seq++, ...payload }));

  const emitCreated = (): string => {
    if (started) return "";
    started = true;
    return ev("response.created", {
      response: responseBase("in_progress", [], undefined),
    });
  };

  const finalize = (): string => {
    if (finalized) return "";
    finalized = true;
    let out = emitCreated();
    const output: Dict[] = [];
    if (textIndex >= 0) {
      const item = {
        type: "message",
        id: textItemId,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      };
      out += ev("response.output_item.done", { output_index: textIndex, item });
      output.push(item);
    }
    const ordered = tools
      .filter((t): t is ToolSlot => !!t)
      .sort((a, b) => a.outputIndex - b.outputIndex);
    for (const slot of ordered) {
      const item = {
        type: "function_call",
        id: slot.itemId,
        call_id: slot.callId,
        name: slot.name,
        arguments: slot.args || "{}",
        status: "completed",
      };
      out += ev("response.output_item.done", { output_index: slot.outputIndex, item });
      output.push(item);
    }
    const { status, incomplete } = finishToStatus(finishReason);
    out += ev("response.completed", {
      response: responseBase(status, output, incomplete),
    });
    return out;
  };

  const transformFrame = (data: string): string => {
    if (data === "[DONE]") return finalize();
    let obj: Dict;
    try {
      obj = JSON.parse(data);
    } catch {
      return "";
    }
    const u = obj.usage as Dict | undefined;
    if (u) {
      usage.promptTokens = Number(u.prompt_tokens ?? usage.promptTokens);
      usage.completionTokens = Number(u.completion_tokens ?? usage.completionTokens);
    }
    const choice = ((obj.choices ?? []) as Dict[])[0];
    if (!choice) return "";
    let out = emitCreated();
    const delta = (choice.delta ?? {}) as Dict;
    if (typeof delta.content === "string" && delta.content) {
      if (textIndex < 0) {
        textIndex = nextOutputIndex++;
        out += ev("response.output_item.added", {
          output_index: textIndex,
          item: {
            type: "message",
            id: textItemId,
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        });
        out += ev("response.content_part.added", {
          output_index: textIndex,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
      }
      text += delta.content;
      out += ev("response.output_text.delta", {
        output_index: textIndex,
        content_index: 0,
        delta: delta.content,
      });
    }
    for (const tc of (Array.isArray(delta.tool_calls) ? delta.tool_calls : []) as Dict[]) {
      const i = Number(tc.index ?? 0);
      const fn = (tc.function ?? {}) as Dict;
      let slot = tools[i];
      if (!slot) {
        slot = {
          itemId: `fc_${randomHex(10)}`,
          callId: String(tc.id ?? `call_${randomHex(6)}`),
          name: String(fn.name ?? ""),
          args: "",
          outputIndex: nextOutputIndex++,
        };
        tools[i] = slot;
        out += ev("response.output_item.added", {
          output_index: slot.outputIndex,
          item: {
            type: "function_call",
            id: slot.itemId,
            call_id: slot.callId,
            name: slot.name,
            arguments: "",
            status: "in_progress",
          },
        });
      }
      if (tc.id) slot.callId = String(tc.id);
      if (fn.name) slot.name = String(fn.name);
      if (fn.arguments) {
        slot.args += String(fn.arguments);
        out += ev("response.function_call_arguments.delta", {
          output_index: slot.outputIndex,
          item_id: slot.itemId,
          delta: String(fn.arguments),
        });
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
    return out;
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Some upstream frames (usage-only chunks, role-only deltas) map to no
      // Responses event. The runtime does not re-invoke `pull` after a
      // pull that enqueued nothing, so keep reading until we can emit.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          const tail = finalize();
          if (tail) controller.enqueue(encoder.encode(tail));
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
          if (parsed) out += transformFrame(parsed.data);
        }
        if (out) {
          controller.enqueue(encoder.encode(out));
          return;
        }
      }
    },
    cancel(reason) {
      reader.cancel(reason);
      resolveUsage(usage);
    },
  });

  return { stream, usage: usagePromise };
}

/** `POST /api/v1/responses` entry point. */
export async function handleResponses(request: Request): Promise<Response> {
  let body: Dict;
  try {
    body = (await request.json()) as Dict;
  } catch {
    return new Response(
      JSON.stringify({ error: { message: "Invalid JSON body.", type: "gateway_error" } }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }
  if (!body.model) {
    return new Response(
      JSON.stringify({
        error: { message: "Field `model` is required.", type: "gateway_error" },
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const chat = responsesToChatRequest(body);
  const synth = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(chat),
  });

  const res = await handleChat(synth, "openai");
  if (!res.ok) return res;

  const ct = res.headers.get("content-type") || "";
  if (chat.stream && ct.includes("text/event-stream") && res.body) {
    const { stream } = chatStreamToResponses(res.body, String(chat.model ?? ""));
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-gateway-protocol": "openai-responses",
      },
    });
  }

  const json = (await res.json().catch(() => ({}))) as Dict;
  return new Response(JSON.stringify(chatJsonToResponses(json)), {
    headers: { "content-type": "application/json" },
  });
}
