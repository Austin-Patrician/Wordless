import assert from "node:assert/strict";
import test from "node:test";
import { DesktopTranslationService } from "../src/main/translation/translation-service.ts";
import { resolveTranslationTargetLanguage } from "@wordless/domain";
import type { TranslationStreamEvent } from "@wordless/protocol";

type Probes = {
  events: TranslationStreamEvent[];
  aborted: () => boolean;
};

function request(overrides: Partial<{ requestId: string; sessionId: string; text: string; targetLanguage: string }> = {}) {
  return {
    requestId: "request-1",
    sessionId: "session-1",
    text: "Hello world",
    ...overrides,
  };
}

/** Fake runtime whose streaming behaviour each test controls. */
function createService(
  stream: (input: { signal?: AbortSignal }, onDelta: (delta: string) => void) => Promise<{ text: string; targetLanguage: string; model: { connectionId: string; modelId: string } }>,
): { service: DesktopTranslationService; probes: Probes } {
  const probes: Probes = { events: [], aborted: () => aborted };
  let aborted = false;
  const runtime = {
    resolveTranslationTarget: () => ({ targetLanguage: "zh-CN", model: { connectionId: "openai", modelId: "gpt" } }),
    translateSelection: async (input: { signal?: AbortSignal }, onDelta: (delta: string) => void) => {
      input.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return await stream(input, onDelta);
    },
  };
  const service = new DesktopTranslationService({
    getRuntime: () => runtime as never,
    send: (event) => probes.events.push(event.event),
  });
  return { service, probes };
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("Timed out waiting for translation events"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

test("translation service reports the resolved target before streaming and completes once", async () => {
  const { service, probes } = createService(async (_input, onDelta) => {
    onDelta("你好");
    onDelta("世界");
    return { text: "你好世界", targetLanguage: "zh-CN", model: { connectionId: "openai", modelId: "gpt" } };
  });
  try {
    service.start(request());
    await waitFor(() => probes.events.some((event) => event.phase === "done"));

    const phases = probes.events.map((event) => event.phase);
    assert.equal(phases[0], "start");
    assert.equal(probes.events[0]?.targetLanguage, "zh-CN");
    assert.equal(phases.filter((phase) => phase === "done").length, 1);
    assert.equal(phases.filter((phase) => phase === "error").length, 0);
    const streamed = probes.events.filter((event) => event.phase === "delta").map((event) => event.text).join("");
    assert.equal(streamed, "你好世界");
    const done = probes.events.find((event) => event.phase === "done");
    assert.equal(done?.text, "你好世界");
  } finally {
    service.dispose();
  }
});

test("translation service batches deltas instead of forwarding one event per chunk", async () => {
  const { service, probes } = createService(async (_input, onDelta) => {
    for (let index = 0; index < 40; index += 1) onDelta("字");
    return { text: "字".repeat(40), targetLanguage: "zh-CN", model: { connectionId: "openai", modelId: "gpt" } };
  });
  try {
    service.start(request());
    await waitFor(() => probes.events.some((event) => event.phase === "done"));

    const deltas = probes.events.filter((event) => event.phase === "delta");
    assert.ok(deltas.length > 0, "expected at least one delta event");
    assert.ok(deltas.length < 40, `expected batching, received ${deltas.length} delta events`);
    assert.equal(deltas.map((event) => event.text).join(""), "字".repeat(40));
  } finally {
    service.dispose();
  }
});

test("translation service aborts an in-flight request and reports it as aborted", async () => {
  const { service, probes } = createService(
    (input) =>
      new Promise((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(new Error("aborted by signal")));
      }),
  );
  try {
    service.start(request());
    await waitFor(() => probes.events.some((event) => event.phase === "start"));
    assert.equal(service.activeCount, 1);
    service.abort("request-1");
    await waitFor(() => probes.events.some((event) => event.phase === "aborted"));

    const phases = probes.events.map((event) => event.phase);
    assert.equal(phases.includes("error"), false);
    assert.equal(service.activeCount, 0);
  } finally {
    service.dispose();
  }
});

test("translation service surfaces failures as an error event and releases the request", async () => {
  const { service, probes } = createService(async () => {
    throw new Error("The selected model is not enabled");
  });
  try {
    service.start(request());
    await waitFor(() => probes.events.some((event) => event.phase === "error"));

    const error = probes.events.find((event) => event.phase === "error");
    assert.equal(error?.error, "The selected model is not enabled");
    assert.equal(service.activeCount, 0);
  } finally {
    service.dispose();
  }
});

test("translation service keeps the partial translation when a request is aborted", async () => {
  const { service, probes } = createService(async (input, onDelta) => {
    onDelta("前半");
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    if (input.signal?.aborted) throw new Error("aborted");
    onDelta("后半");
    return { text: "前半后半", targetLanguage: "zh-CN", model: { connectionId: "openai", modelId: "gpt" } };
  });
  try {
    service.start(request());
    await waitFor(() => probes.events.some((event) => event.phase === "delta"));
    service.abort("request-1");
    await waitFor(() => probes.events.some((event) => event.phase === "aborted"));

    const aborted = probes.events.find((event) => event.phase === "aborted");
    assert.equal(aborted?.text, "前半");
    assert.equal(probes.events.some((event) => event.phase === "done"), false);
  } finally {
    service.dispose();
  }
});

test("translation service reports aborted, not done, when a provider ignores the abort signal", async () => {
  // The provider deliberately resolves successfully after the abort, which is
  // what happens when an adapter ignores `signal`.
  const { service, probes } = createService(async (input, onDelta) => {
    onDelta("第一部分");
    await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => resolve()));
    return { text: "第一部分", targetLanguage: "zh-CN", model: { connectionId: "openai", modelId: "gpt" } };
  });
  try {
    service.start(request());
    await waitFor(() => probes.events.some((event) => event.phase === "delta"));
    service.abort("request-1");
    await waitFor(() => probes.events.some((event) => event.phase === "aborted"));

    const phases = probes.events.map((event) => event.phase);
    assert.equal(phases.includes("done"), false, "a cancelled request must not report completion");
    assert.equal(probes.events.at(-1)?.text, "第一部分");
  } finally {
    service.dispose();
  }
});

test("translation service ignores unknown aborts and rejects duplicate request ids", async () => {
  const { service, probes } = createService(
    (input) =>
      new Promise((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  try {
    service.start(request());
    service.abort("missing-request");
    assert.throws(() => service.start(request()), /already running/);
    assert.equal(service.activeCount, 1);
    service.abort("request-1");
    await waitFor(() => probes.events.some((event) => event.phase === "aborted"));
  } finally {
    service.dispose();
  }
});

test("translation service cancels every in-flight request on dispose", async () => {
  const { service, probes } = createService(
    (input) =>
      new Promise((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  service.start(request({ requestId: "request-1" }));
  service.start(request({ requestId: "request-2" }));
  await waitFor(() => probes.events.filter((event) => event.phase === "start").length === 2);
  assert.equal(service.activeCount, 2);

  service.dispose();
  assert.equal(service.activeCount, 0);
  await waitFor(() => probes.events.filter((event) => event.phase === "aborted").length === 2);
});

test("translation service reports a missing runtime instead of hanging", () => {
  const service = new DesktopTranslationService({ getRuntime: () => undefined, send: () => {} });
  assert.throws(() => service.start(request()), /runtime is not available/);
  service.dispose();
});

test("translation target language follows the preference, then the interface language", () => {
  const preferences = { locale: "zh-CN" as const, translation: { targetLanguage: null, model: null, bubbleMaxChars: 600 } };
  assert.equal(resolveTranslationTargetLanguage(preferences), "zh-CN");
  assert.equal(resolveTranslationTargetLanguage({ ...preferences, locale: "en-US" }), "en-US");
  assert.equal(resolveTranslationTargetLanguage({ ...preferences, translation: { ...preferences.translation, targetLanguage: "ja" } }), "ja");
  // A language the interface cannot offer, or a stale value, must not leak through.
  assert.equal(resolveTranslationTargetLanguage({ ...preferences, translation: { ...preferences.translation, targetLanguage: "klingon" } }), "zh-CN");
});
