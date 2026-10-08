import { describe, expect, it } from "vitest";
import {
  chatJsonToResponses,
  chatStreamToResponses,
  responsesToChatRequest,
} from "../../functions/responses";

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function frames(body: string): { event: string; data: unknown }[] {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "";
      const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "";
      return { event, data: dataLine ? JSON.parse(dataLine) : null };
    });
}

describe("responsesToChatRequest", () => {
  it("maps instructions, string input and sampling fields", () => {
    const chat = responsesToChatRequest({
      model: "gpt-4o",
      instructions: "be terse",
      input: "hello",
      max_output_tokens: 128,
      temperature: 0.2,
    });
    expect(chat.model).toBe("gpt-4o");
    expect(chat.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hello" },
    ]);
    expect(chat.max_tokens).toBe(128);
    expect(chat.temperature).toBe(0.2);
  });

  it("converts message items, tools and tool transcripts", () => {
    const chat = responsesToChatRequest({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "weather?" },
            { type: "input_image", image_url: "data:image/png;base64,AAA" },
          ],
        },
        { type: "function_call", call_id: "call_1", name: "get_weather", arguments: '{"city":"x"}' },
        { type: "function_call_output", call_id: "call_1", output: "sunny" },
      ],
      tools: [{ type: "function", name: "get_weather", parameters: { type: "object" } }],
      tool_choice: { type: "function", name: "get_weather" },
    });
    const messages = chat.messages as Record<string, unknown>[];
    expect(messages[0].role).toBe("user");
    expect((messages[0].content as unknown[]).length).toBe(2);
    expect(messages[1]).toMatchObject({ role: "assistant" });
    expect((messages[1].tool_calls as unknown[])[0]).toMatchObject({ id: "call_1" });
    expect(messages[2]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "sunny" });
    expect(chat.tool_choice).toEqual({ type: "function", function: { name: "get_weather" } });
    expect((chat.tools as unknown[]).length).toBe(1);
  });

  it("maps a json_schema text format to response_format", () => {
    const chat = responsesToChatRequest({
      model: "m",
      input: "x",
      text: { format: { type: "json_schema", name: "out", schema: { type: "object" } } },
    });
    expect(chat.response_format).toMatchObject({ type: "json_schema" });
  });
});

describe("chatJsonToResponses", () => {
  it("wraps content and tool calls in a Responses object", () => {
    const res = chatJsonToResponses({
      model: "gpt-4o",
      choices: [
        {
          message: {
            role: "assistant",
            content: "hi",
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "f", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    });
    expect(res.object).toBe("response");
    expect(res.status).toBe("completed");
    expect(res.output_text).toBe("hi");
    const output = res.output as Record<string, unknown>[];
    expect(output[0].type).toBe("message");
    expect(output[1]).toMatchObject({ type: "function_call", call_id: "call_1", name: "f" });
    expect((res.usage as Record<string, unknown>).total_tokens).toBe(8);
  });

  it("marks truncated responses incomplete", () => {
    const res = chatJsonToResponses({
      model: "m",
      choices: [{ message: { content: "x" }, finish_reason: "length" }],
      usage: {},
    });
    expect(res.status).toBe("incomplete");
    expect(res.incomplete_details).toEqual({ reason: "max_output_tokens" });
  });
});

describe("chatStreamToResponses", () => {
  it("emits Responses SSE events and a completed terminal event", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            'data: {"id":"c","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}\n\n'
          )
        );
        controller.enqueue(
          enc.encode(
            'data: {"id":"c","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n'
          )
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const { stream, usage } = chatStreamToResponses(upstream, "gpt-4o");
    const body = await collect(stream);
    const events = frames(body);
    const types = events.map((e) => e.event);

    expect(types[0]).toBe("response.created");
    expect(types).toContain("response.output_item.added");
    expect(types).toContain("response.output_text.delta");
    expect(types).toContain("response.output_item.done");
    expect(types[types.length - 1]).toBe("response.completed");

    const deltas = events
      .filter((e) => e.event === "response.output_text.delta")
      .map((e) => (e.data as { delta: string }).delta)
      .join("");
    expect(deltas).toBe("Hello");

    const completed = events[events.length - 1].data as {
      response: { status: string; output: Record<string, unknown>[] };
    };
    expect(completed.response.status).toBe("completed");
    expect(completed.response.output[0].type).toBe("message");

    expect(await usage).toEqual({ promptTokens: 2, completionTokens: 2 });
  });

  it("keeps pulling after a frame that maps to no event", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        // usage-only chunk first: maps to no Responses event, and the runtime
        // will not re-invoke pull unless we loop internally.
        controller.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":1}}\n\n'));
        controller.enqueue(
          enc.encode('data: {"choices":[{"index":0,"delta":{"content":"A"}}]}\n\n')
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const events = frames(await collect(chatStreamToResponses(upstream, "m").stream));
    const types = events.map((e) => e.event);
    expect(types).toContain("response.output_text.delta");
    expect(types[types.length - 1]).toBe("response.completed");
  });

  it("emits function_call items for tool deltas", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"f","arguments":"{\\"a\\":"}}]}}]}\n\n'
          )
        );
        controller.enqueue(
          enc.encode(
            'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}\n\n'
          )
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const { stream } = chatStreamToResponses(upstream, "m");
    const events = frames(await collect(stream));
    const types = events.map((e) => e.event);
    expect(types).toContain("response.function_call_arguments.delta");
    const added = events.find(
      (e) => e.event === "response.output_item.added" &&
        (e.data as { item: { type: string } }).item.type === "function_call"
    );
    expect((added!.data as { item: { name: string } }).item.name).toBe("f");
    const done = events.find(
      (e) => e.event === "response.output_item.done" &&
        (e.data as { item: { type: string } }).item.type === "function_call"
    );
    expect(done).toBeDefined();
    expect((done!.data as { item: { arguments: string } }).item.arguments).toBe('{"a":1}');
  });
});
