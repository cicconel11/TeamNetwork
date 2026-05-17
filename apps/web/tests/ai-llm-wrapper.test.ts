import test from "node:test";
import assert from "node:assert/strict";
import {
  Profiles,
  runLlmCompletion,
  runLlmStream,
  type LlmStreamEvent,
} from "../src/lib/ai/llm.ts";

type OpsEvent = [string, Record<string, unknown>, string | null | undefined];

function fakeCompletion(model: string): unknown {
  return {
    id: "cmpl_stub",
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function buildOpsCollector() {
  const events: OpsEvent[] = [];
  return {
    events,
    fn: (event: "api_error", props: Record<string, unknown>, orgId?: string | null) => {
      events.push([event, props, orgId ?? null]);
    },
  };
}

function makeFakeClient(handler: (model: string, attempt: number) => Promise<unknown>) {
  let attempts = 0;
  const calls: Array<{ model: string; attempt: number }> = [];
  return {
    calls,
    getAttempts() {
      return attempts;
    },
    client: {
      chat: {
        completions: {
          create: async (body: { model: string }) => {
            attempts++;
            const attempt = attempts;
            calls.push({ model: body.model, attempt });
            return handler(body.model, attempt);
          },
        },
      },
    } as never,
  };
}

test("Profiles.safetyJudge honors SAFETY_JUDGE_MODEL env, falls back otherwise", () => {
  const previous = process.env.SAFETY_JUDGE_MODEL;
  process.env.SAFETY_JUDGE_MODEL = "judge-x";
  assert.equal(Profiles.safetyJudge().model, "judge-x");
  delete process.env.SAFETY_JUDGE_MODEL;
  // Falls back to ZAI default model when env unset (don't pin exact value).
  assert.ok(Profiles.safetyJudge().model.length > 0);
  if (previous !== undefined) process.env.SAFETY_JUDGE_MODEL = previous;
});

test("Profiles.pass1Tools defaults to temperature 0", () => {
  const previous = process.env.AI_PASS1_TEMPERATURE;
  delete process.env.AI_PASS1_TEMPERATURE;
  assert.equal(Profiles.pass1Tools().temperature, 0);
  if (previous !== undefined) process.env.AI_PASS1_TEMPERATURE = previous;
});

test("Profiles.pass2Compose defaults to temperature 0.7", () => {
  const previous = process.env.AI_PASS2_TEMPERATURE;
  delete process.env.AI_PASS2_TEMPERATURE;
  assert.equal(Profiles.pass2Compose().temperature, 0.7);
  if (previous !== undefined) process.env.AI_PASS2_TEMPERATURE = previous;
});

test("runLlmCompletion returns completion + actualModel on success", async () => {
  const { client } = makeFakeClient(async (model) => fakeCompletion(model));
  const profile = {
    name: "test_ok",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 0,
  };
  const result = await runLlmCompletion(profile, {
    messages: [{ role: "user", content: "hi" }],
    client,
  });
  assert.equal(result.actualModel, "primary");
  assert.equal(result.attempts, 1);
  assert.equal(result.completion.model, "primary");
});

test("runLlmCompletion retries on 429 and emits llm_retry_429 ops event", async () => {
  const ops = buildOpsCollector();
  const { client, calls } = makeFakeClient(async (model, attempt) => {
    if (attempt === 1) {
      const err = Object.assign(new Error("rate limited"), {
        status: 429,
        headers: { get: () => null },
      });
      throw err;
    }
    return fakeCompletion(model);
  });
  const profile = {
    name: "test_429",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 1,
  };
  const result = await runLlmCompletion(profile, {
    messages: [{ role: "user", content: "hi" }],
    client,
    trackOpsEvent: ops.fn,
  });
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  const retryEvent = ops.events.find((e) => e[1].error_code === "llm_retry_429");
  assert.ok(retryEvent, "expected llm_retry_429 ops event");
  assert.equal(retryEvent![1].endpoint_group, "ai_llm_test_429");
});

test("runLlmCompletion emits llm_giveup_<code> when retries exhausted", async () => {
  const ops = buildOpsCollector();
  const { client } = makeFakeClient(async () => {
    const err = Object.assign(new Error("upstream down"), { status: 502 });
    throw err;
  });
  const profile = {
    name: "test_giveup",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 1,
  };
  await assert.rejects(
    runLlmCompletion(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
      trackOpsEvent: ops.fn,
    })
  );
  const giveup = ops.events.find((e) => String(e[1].error_code).startsWith("llm_giveup_"));
  assert.ok(giveup, "expected llm_giveup_* ops event");
  assert.equal(giveup![1].error_code, "llm_giveup_502");
});

test("runLlmCompletion swaps to fallbackModel on retry", async () => {
  const { client, calls } = makeFakeClient(async (model, attempt) => {
    if (attempt === 1) {
      throw Object.assign(new Error("server err"), { status: 500 });
    }
    return fakeCompletion(model);
  });
  const profile = {
    name: "test_fallback",
    model: "primary",
    fallbackModel: "fallback-mini",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 1,
  };
  const result = await runLlmCompletion(profile, {
    messages: [{ role: "user", content: "hi" }],
    client,
  });
  assert.equal(calls[0].model, "primary");
  assert.equal(calls[1].model, "fallback-mini");
  assert.equal(result.actualModel, "fallback-mini");
});

test("runLlmCompletion does not retry when external signal already aborted", async () => {
  const { client, calls } = makeFakeClient(async () => fakeCompletion("primary"));
  const controller = new AbortController();
  controller.abort(new Error("caller aborted"));
  const profile = {
    name: "test_abort",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 2,
  };
  await assert.rejects(
    runLlmCompletion(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
      signal: controller.signal,
    })
  );
  assert.equal(calls.length, 0, "external abort should short-circuit before any call");
});

test("runLlmCompletion does not retry non-retryable errors", async () => {
  const ops = buildOpsCollector();
  const { client, calls } = makeFakeClient(async () => {
    throw Object.assign(new Error("bad request"), { status: 400 });
  });
  const profile = {
    name: "test_4xx",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 3,
  };
  await assert.rejects(
    runLlmCompletion(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
      trackOpsEvent: ops.fn,
    })
  );
  assert.equal(calls.length, 1, "non-retryable errors should not retry");
  const giveup = ops.events.find((e) => String(e[1].error_code).startsWith("llm_giveup_"));
  assert.ok(giveup, "expected llm_giveup ops event on non-retryable");
});

test("runLlmCompletion times out and rejects with AbortError after timeoutMs", async () => {
  const ops = buildOpsCollector();
  const { client } = makeFakeClient(
    () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 30);
      })
  );
  const profile = {
    name: "test_timeout",
    model: "primary",
    temperature: 0,
    timeoutMs: 5,
    maxRetries: 0,
  };
  await assert.rejects(
    runLlmCompletion(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
      trackOpsEvent: ops.fn,
    })
  );
  const giveup = ops.events.find((e) => String(e[1].error_code).startsWith("llm_giveup_"));
  assert.ok(giveup);
  assert.equal(giveup![1].error_code, "llm_giveup_timeout");
});

test("runLlmCompletion passes overrides.model + temperature into client call", async () => {
  const { client, calls } = makeFakeClient(async (model) => fakeCompletion(model));
  const profile = {
    name: "test_overrides",
    model: "default-model",
    temperature: 0.7,
    timeoutMs: 1000,
    maxRetries: 0,
  };
  await runLlmCompletion(profile, {
    messages: [{ role: "user", content: "hi" }],
    client,
    overrides: { model: "override-model", temperature: 0.1 },
  });
  assert.equal(calls[0].model, "override-model");
});

// ---------------------------------------------------------------------------
// runLlmStream
// ---------------------------------------------------------------------------

function asyncIterableFromChunks(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i < chunks.length) {
            return { value: chunks[i++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function asyncIterableThatThrows(
  chunks: unknown[],
  err: unknown,
): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i < chunks.length) {
            return { value: chunks[i++], done: false };
          }
          throw err;
        },
      };
    },
  };
}

function makeFakeStreamClient(
  handler: (model: string, attempt: number) => Promise<AsyncIterable<unknown>>,
) {
  let attempts = 0;
  const calls: Array<{ model: string; attempt: number }> = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (body: { model: string }) => {
            attempts += 1;
            const attempt = attempts;
            calls.push({ model: body.model, attempt });
            return handler(body.model, attempt);
          },
        },
      },
    } as never,
  };
}

async function collect(it: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const out: LlmStreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

test("runLlmStream yields chunk + usage events from happy path", async () => {
  const chunks = [
    { choices: [{ delta: { content: "Hel" }, finish_reason: null }] },
    { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] },
    { choices: [{ delta: {}, finish_reason: null }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
  ];
  const { client } = makeFakeStreamClient(async () => asyncIterableFromChunks(chunks));
  const profile = {
    name: "stream_ok",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 0,
  };
  const events = await collect(
    runLlmStream(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
    }),
  );
  const text = events
    .filter((e): e is { type: "chunk"; content: string } => e.type === "chunk")
    .map((e) => e.content)
    .join("");
  assert.equal(text, "Hello");
  const finish = events.find((e) => e.type === "finish");
  assert.ok(finish);
  const usage = events.find((e) => e.type === "usage");
  assert.ok(usage);
  assert.equal((usage as { inputTokens: number }).inputTokens, 5);
});

test("runLlmStream retries on pre-stream 429 and succeeds via fallback model", async () => {
  const ops = buildOpsCollector();
  const chunks = [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }];
  const { client, calls } = makeFakeStreamClient(async (_model, attempt) => {
    if (attempt === 1) {
      throw Object.assign(new Error("rate limited"), {
        status: 429,
        headers: { get: () => null },
      });
    }
    return asyncIterableFromChunks(chunks);
  });
  const profile = {
    name: "stream_429",
    model: "primary",
    fallbackModel: "fallback-mini",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 1,
  };
  const events = await collect(
    runLlmStream(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
      trackOpsEvent: ops.fn,
    }),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, "primary");
  assert.equal(calls[1].model, "fallback-mini");
  const retry = ops.events.find((e) => e[1].error_code === "llm_retry_429");
  assert.ok(retry, "expected llm_retry_429");
  const chunk = events.find((e) => e.type === "chunk");
  assert.ok(chunk);
});

test("runLlmStream emits stream_error and gives up after pre-stream retries exhausted", async () => {
  const ops = buildOpsCollector();
  const { client } = makeFakeStreamClient(async () => {
    throw Object.assign(new Error("upstream down"), { status: 502 });
  });
  const profile = {
    name: "stream_giveup",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 1,
  };
  const events = await collect(
    runLlmStream(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
      trackOpsEvent: ops.fn,
    }),
  );
  const err = events.find((e) => e.type === "stream_error");
  assert.ok(err);
  assert.equal((err as { midStream: boolean }).midStream, false);
  const giveup = ops.events.find((e) => String(e[1].error_code).startsWith("llm_giveup_"));
  assert.ok(giveup);
});

test("runLlmStream does NOT retry on mid-stream error; yields midStream stream_error", async () => {
  const ops = buildOpsCollector();
  const chunks = [{ choices: [{ delta: { content: "partial " }, finish_reason: null }] }];
  const { client, calls } = makeFakeStreamClient(async () =>
    asyncIterableThatThrows(chunks, Object.assign(new Error("upstream blew up"), { status: 500 })),
  );
  const profile = {
    name: "stream_midstream",
    model: "primary",
    fallbackModel: "fallback-mini",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 2,
  };
  const events = await collect(
    runLlmStream(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
      trackOpsEvent: ops.fn,
    }),
  );
  assert.equal(calls.length, 1, "mid-stream errors must not retry");
  const partial = events.find((e) => e.type === "chunk");
  assert.ok(partial);
  const err = events.find((e) => e.type === "stream_error");
  assert.ok(err);
  assert.equal((err as { midStream: boolean }).midStream, true);
  const mid = ops.events.find((e) => String(e[1].error_code).startsWith("llm_midstream_"));
  assert.ok(mid);
});

test("runLlmStream short-circuits when external signal already aborted", async () => {
  const { client, calls } = makeFakeStreamClient(async () =>
    asyncIterableFromChunks([{ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] }]),
  );
  const controller = new AbortController();
  controller.abort(new Error("caller aborted"));
  const profile = {
    name: "stream_abort",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 2,
  };
  await assert.rejects(
    collect(
      runLlmStream(profile, {
        messages: [{ role: "user", content: "hi" }],
        client,
        signal: controller.signal,
      }),
    ),
  );
  assert.equal(calls.length, 0);
});

test("runLlmStream aggregates tool_call_delta events and emits finish=tool_calls", async () => {
  const chunks = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "tc_1", function: { name: "list_members", arguments: "{\"or" } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: "g\":\"x\"}" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];
  const { client } = makeFakeStreamClient(async () => asyncIterableFromChunks(chunks));
  const profile = {
    name: "stream_tools",
    model: "primary",
    temperature: 0,
    timeoutMs: 1000,
    maxRetries: 0,
  };
  const events = await collect(
    runLlmStream(profile, {
      messages: [{ role: "user", content: "hi" }],
      client,
    }),
  );
  const deltas = events.filter((e) => e.type === "tool_call_delta");
  assert.equal(deltas.length, 2);
  const finish = events.find((e) => e.type === "finish") as
    | { reason: string }
    | undefined;
  assert.equal(finish?.reason, "tool_calls");
});
