import assert from "node:assert/strict";
import test from "node:test";
import { feishuProvider, feishuSign } from "../src/main/notifications/webhook/providers/feishu.ts";
import { getProvider, isSupportedKind, listProviderDescriptors } from "../src/main/notifications/webhook/providers/registry.ts";

const VALID_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/6a3f1c2d-9b7e";

/** Runs `body` with `fetch` swapped for a stub, always restoring the original. */
async function withFetch(
  handler: (url: string, init: { body?: unknown }) => Promise<Response> | Response,
  body: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: unknown) => handler(String(input), (init ?? {}) as { body?: unknown })) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function sentBody(init: { body?: unknown }): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

test("feishu signature matches the documented HMAC layout", () => {
  // Golden vector computed independently from the platform documentation:
  // key = `timestamp + "\n" + secret`, signed data = the empty string.
  assert.equal(feishuSign(1_700_000_000, "dGVzdC1zZWNyZXQ="), "c+GzZ3W3OL0/nqdAdZ9Qpb101I+Z2v1y1ax2C4yliAE=");
});

test("feishu signature is not DingTalk's layout", () => {
  // The two platforms use inverse HMAC layouts. If someone "simplifies" the
  // helper into the DingTalk shape, the value changes — which is the whole point
  // of pinning it. Verification fails silently otherwise: the platform reports a
  // signature error and it gets misread as a permissions problem.
  assert.notEqual(feishuSign(1_700_000_000, "dGVzdC1zZWNyZXQ="), "L0EeBuT4NwHa2+wV/Z857ksm/AG2wKx22N22nH170Vs=");
});

test("feishu validates each part of the address with its own code", () => {
  const validate = (url: string) => feishuProvider.validate({ url, options: {} });

  assert.deepEqual(validate(VALID_URL), { ok: true });
  assert.equal(validate("").code, "url-empty");
  assert.equal(validate("   ").code, "url-empty");
  assert.equal(validate("not a url").code, "url-bad-format");
  // Called out separately: the address is otherwise right, so only the scheme
  // has to change, and saying "must be https" would be less useful.
  const http = validate(VALID_URL.replace("https://", "http://"));
  assert.equal(http.code, "url-http-not-allowed");
  assert.equal(validate(VALID_URL.replace("https://", "ftp://")).code, "url-not-https");
  assert.equal(validate(VALID_URL.replace("open.feishu.cn", "evil.example.com")).code, "url-wrong-host");
  assert.equal(validate("https://open.feishu.cn/open-apis/bot/v2/other/abcdefgh").code, "url-wrong-path");
  assert.equal(validate("https://open.feishu.cn/open-apis/bot/v2/hook/").code, "url-missing-token");
  assert.equal(validate("https://open.feishu.cn/open-apis/bot/v2/hook/abc").code, "url-token-too-short");
});

test("feishu sends an interactive card so markdown renders", async () => {
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ code: 0 });
    },
    async () => {
      const result = await feishuProvider.send({
        url: VALID_URL,
        options: {},
        message: { title: "Weekly report", text: "**done**", level: "success" },
      });
      assert.deepEqual(result, { ok: true });
    },
  );

  assert.equal(captured.msg_type, "interactive");
  const card = captured.card as { header: { template: string; title: { content: string } }; elements: Array<{ content: string }> };
  assert.equal(card.header.template, "green");
  assert.equal(card.header.title.content, "✅ Weekly report");
  assert.equal(card.elements[0].content, "**done**");
});

test("feishu maps each level to a colour and an emoji", async () => {
  const cases: Array<[string, string]> = [["info", "blue"], ["warn", "orange"], ["error", "red"]];
  for (const [level, template] of cases) {
    let captured: Record<string, unknown> = {};
    await withFetch(
      (_url, init) => {
        captured = sentBody(init);
        return jsonResponse({ code: 0 });
      },
      async () => {
        await feishuProvider.send({ url: VALID_URL, options: {}, message: { text: "x", level: level as "info" } });
      },
    );
    assert.equal((captured.card as { header: { template: string } }).header.template, template);
  }
});

test("feishu mentions everyone through the markdown prefix", async () => {
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ code: 0 });
    },
    async () => {
      await feishuProvider.send({ url: VALID_URL, options: { mentionAll: true }, message: { text: "ping" } });
    },
  );
  const card = captured.card as { elements: Array<{ content: string }> };
  assert.equal(card.elements[0].content, "<at id=all></at>\nping");
});

test("feishu signs in the body with a seconds timestamp, only when a key is set", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  await withFetch(
    (_url, init) => {
      bodies.push(sentBody(init));
      return jsonResponse({ code: 0 });
    },
    async () => {
      await feishuProvider.send({ url: VALID_URL, options: {}, message: { text: "one" } });
      await feishuProvider.send({ url: VALID_URL, signSecret: "s3cret", options: {}, message: { text: "two" } });
    },
  );

  assert.equal(bodies[0].sign, undefined);
  assert.equal(bodies[0].timestamp, undefined);
  const timestamp = Number(bodies[1].timestamp);
  assert.ok(Number.isInteger(timestamp));
  // Seconds, not milliseconds: a millisecond value is accepted by nobody and the
  // failure looks like a permission problem.
  assert.ok(timestamp < 10_000_000_000, `expected seconds, got ${timestamp}`);
  assert.equal(bodies[1].sign, feishuSign(timestamp, "s3cret"));
});

test("feishu reads the business code out of a 200 response", async () => {
  await withFetch(
    () => jsonResponse({ code: 19024, msg: "Key Words Not Found" }),
    async () => {
      const result = await feishuProvider.send({ url: VALID_URL, options: {}, message: { text: "x" } });
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.code, "platform-rejected");
      // The platform's own wording is kept for the log, never as the primary message.
      assert.equal(result.ok === false && result.detail, "Key Words Not Found");
    },
  );

  await withFetch(
    () => jsonResponse({ StatusCode: 9499, StatusMessage: "legacy shape" }),
    async () => {
      const result = await feishuProvider.send({ url: VALID_URL, options: {}, message: { text: "x" } });
      assert.equal(result.ok === false && result.code, "platform-rejected");
    },
  );
});

test("feishu distinguishes an unreadable body from a rejected message", async () => {
  await withFetch(
    () => new Response("<html>proxy error</html>", { status: 200 }),
    async () => {
      const result = await feishuProvider.send({ url: VALID_URL, options: {}, message: { text: "x" } });
      assert.equal(result.ok === false && result.code, "response-unparsable");
    },
  );

  await withFetch(
    () => new Response("nope", { status: 500, statusText: "Server Error" }),
    async () => {
      const result = await feishuProvider.send({ url: VALID_URL, options: {}, message: { text: "x" } });
      assert.equal(result.ok === false && result.code, "http-error");
      assert.match(String(result.ok === false && result.detail), /500/);
    },
  );
});

test("feishu reports a timeout rather than throwing", async () => {
  await withFetch(
    () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    },
    async () => {
      const result = await feishuProvider.send({ url: VALID_URL, options: {}, message: { text: "x" } });
      assert.equal(result.ok === false && result.code, "timeout");
    },
  );
});

test("feishu refuses an address that would not have been saveable", async () => {
  await withFetch(
    () => jsonResponse({ code: 0 }),
    async () => {
      const result = await feishuProvider.send({ url: "https://evil.example.com/hook/abcdefgh", options: {}, message: { text: "x" } });
      assert.equal(result.ok === false && result.code, "url-invalid");
    },
  );
});

test("feishu degrades attachments visibly instead of dropping them", async () => {
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ code: 0 });
    },
    async () => {
      const result = await feishuProvider.send({
        url: VALID_URL,
        options: {},
        message: {
          text: "Report ready",
          attachments: [{ path: "/tmp/report.pdf", name: "report.pdf", kind: "file", sizeBytes: 2_412_544 }],
        },
      });
      // "degraded" is what stops the agent from claiming it sent a file.
      assert.equal(result.ok && result.degraded, "attachment-dropped");
    },
  );

  const text = (captured.card as { elements: Array<{ content: string }> }).elements[0].content;
  assert.match(text, /report\.pdf/);
  assert.match(text, /\/tmp\/report\.pdf/);
  assert.match(text, /2\.3 MB/);
});

test("feishu truncates Chinese text by bytes, not characters", async () => {
  // 5000 characters is 15000 bytes in UTF-8 — well past the 12000 byte budget,
  // while a character-count check would have let it through.
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ code: 0 });
    },
    async () => {
      const result = await feishuProvider.send({ url: VALID_URL, options: {}, message: { text: "中".repeat(5_000) } });
      assert.equal(result.ok && result.degraded, "truncated");
    },
  );

  const text = (captured.card as { elements: Array<{ content: string }> }).elements[0].content;
  assert.ok(Buffer.byteLength(text, "utf8") <= 12_000, `got ${Buffer.byteLength(text, "utf8")} bytes`);
  assert.ok(text.endsWith("…"));
});

test("a long body cannot cut off the attachment warning", async () => {
  // The warning used to be appended before truncation, which put it at the tail
  // where a long body removed it — leaving the user certain a file had been sent.
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ code: 0 });
    },
    async () => {
      const result = await feishuProvider.send({
        url: VALID_URL,
        options: {},
        message: {
          // Far past the budget on its own.
          text: "中".repeat(20_000),
          attachments: [{ path: "/tmp/report.pdf", name: "report.pdf", kind: "file", sizeBytes: 2_412_544 }],
        },
      });
      assert.equal(result.ok && result.degraded, "attachment-dropped");
    },
  );

  const text = (captured.card as { elements: Array<{ content: string }> }).elements[0].content;
  assert.match(text, /无法发送附件/);
  assert.match(text, /report\.pdf/);
  // And the whole thing still fits the request budget, note included.
  assert.ok(Buffer.byteLength(text, "utf8") <= 12_000, `got ${Buffer.byteLength(text, "utf8")} bytes`);
});

test("the registry answers for exactly the channels this build implements", () => {
  // All three kinds are implemented; each has its own test file for the details.
  for (const kind of ["feishu", "dingtalk", "wecom"] as const) {
    assert.equal(getProvider(kind).kind, kind);
    assert.equal(isSupportedKind(kind), true);
  }
  // A kind the type does not name at all still fails loudly here.
  assert.throws(() => getProvider("nope" as never), /unsupported webhook kind/);

  const descriptors = listProviderDescriptors();
  assert.equal(descriptors.length, 3);
  const feishu = descriptors.find((descriptor) => descriptor.kind === "feishu");
  assert.ok(feishu);
  assert.deepEqual(
    feishu.credentialFields.map((field) => field.key),
    ["url", "signSecret"],
  );
  // The form renders fields and mentions from this and never branches on kind.
  assert.equal(feishu.capabilities.supportsSign, true);
  assert.equal(feishu.capabilities.supportsFile, false);
  assert.equal(feishu.capabilities.supportsMentionAll, true);
  assert.ok(feishu.capabilities.maxTextBytes > 0);
});
