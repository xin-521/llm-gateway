import type { Provider } from "./types";
import { countTokensRough } from "./protocols";

/**
 * Built-in mock upstream used by the seeded demo providers so that the
 * failover / protocol-conversion pipeline is fully exercisable without real
 * API keys. Clearly labelled as mock in the console.
 */

const encoder = new TextEncoder();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function mockShouldFail(provider: Provider): boolean {
  const rate = provider.failRate ?? 0;
  return rate > 0 && Math.random() < rate;
}

function mockReplyText(provider: Provider, userText: string): string {
  const echo = userText ? userText.slice(0, 160) : "hello";
  return (
    `[mock:${provider.name}] 收到请求：“${echo}”。` +
    " 这是一个内置模拟上游返回的示例回答，用于演示故障转移、协议转换与流式输出。" +
    " 你可以在「供应商」页面接入真实的 OpenAI / Anthropic 兼容接口。"
  );
}

export function mockJsonResponse(provider: Provider, body: Record<string, unknown>): Response {
  const isAnthropic = provider.protocol === "anthropic";
  const userText = extractLastUserText(body);
  const text = mockReplyText(provider, userText);
  const promptTokens = countTokensRough(JSON.stringify(body));
  const completionTokens = countTokensRough(text);
  const model = String(body.model ?? "mock-model");

  if (isAnthropic) {
    return new Response(
      JSON.stringify({
        id: `msg_mock_${Date.now()}`,
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: promptTokens,
          output_tokens: completionTokens,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
      { headers: { "content-type": "application/json" } }
    );
  }
  return new Response(
    JSON.stringify({
      id: `chatcmpl-mock-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }),
    { headers: { "content-type": "application/json" } }
  );
}

export function mockStreamResponse(provider: Provider, body: Record<string, unknown>): Response {
  const text = mockReplyText(provider, extractLastUserText(body));
  const model = String(body.model ?? "mock-model");
  const pieces = text.match(/.{1,8}/g) ?? [text];
  const isAnthropic = provider.protocol === "anthropic";
  const promptTokens = countTokensRough(JSON.stringify(body));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let i = 0;
      const push = (s: string) => controller.enqueue(encoder.encode(s));
      const interval = setInterval(() => {
        if (i >= pieces.length) {
          if (isAnthropic) {
            push(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`);
            push(
              `event: message_delta\ndata: ${JSON.stringify({
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: countTokensRough(text) },
              })}\n\n`
            );
            push(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
          } else {
            push(
              `data: ${JSON.stringify({
                id: "chatcmpl-mock",
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              })}\n\n`
            );
            push(
              `data: ${JSON.stringify({
                id: "chatcmpl-mock",
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [],
                usage: {
                  prompt_tokens: promptTokens,
                  completion_tokens: countTokensRough(text),
                  total_tokens: promptTokens + countTokensRough(text),
                },
              })}\n\n`
            );
            push("data: [DONE]\n\n");
          }
          clearInterval(interval);
          controller.close();
          return;
        }
        if (isAnthropic) {
          if (i === 0) {
            push(
              `event: message_start\ndata: ${JSON.stringify({
                type: "message_start",
                message: {
                  id: `msg_mock_${Date.now()}`,
                  type: "message",
                  role: "assistant",
                  model,
                  content: [],
                  usage: { input_tokens: promptTokens, output_tokens: 0 },
                },
              })}\n\n`
            );
            push(
              `event: content_block_start\ndata: ${JSON.stringify({
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              })}\n\n`
            );
          }
          push(
            `event: content_block_delta\ndata: ${JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: pieces[i] },
            })}\n\n`
          );
        } else {
          push(
            `data: ${JSON.stringify({
              id: "chatcmpl-mock",
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: i === 0 ? { role: "assistant", content: pieces[i] } : { content: pieces[i] }, finish_reason: null }],
            })}\n\n`
          );
        }
        i++;
      }, 40);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

function extractLastUserText(body: Record<string, unknown>): string {
  const msgs = Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]) : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((p) =>
          p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string"
            ? ((p as Record<string, unknown>).text as string)
            : ""
        )
        .join(" ");
    }
  }
  return "";
}
