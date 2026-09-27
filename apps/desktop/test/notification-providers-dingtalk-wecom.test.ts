import assert from "node:assert/strict";
import test from "node:test";
import { dingtalkProvider, dingtalkSign } from "../src/main/notifications/webhook/providers/dingtalk.ts";
import { wecomProvider } from "../src/main/notifications/webhook/providers/wecom.ts";

/**
 * The two Chinese channels, verified against their official documentation.
 *
 * The cases worth having here are the ones a reader cannot check by eye: that
 * DingTalk's signature is not Feishu's, that its URL encoding is applied, that its
 * limit is counted in characters, and that WeCom really offers no signature and no
 * way to mention everyone.
 */

const DINGTALK_URL = "https://oapi.dingtalk.com/robot/send?access_token=abc123def456";
const WECOM_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx-4bc4-97a0-0ec2sifa5aaa";

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

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
const sentBody = (init: { body?: unknown }) => JSON.parse(String(init.body)) as Record<string, unknown>;

test("dingtalk's signature is the inverse of Feishu's, and is URL-encoded", () => {
  // Golden vector computed independently from the documented layout:
  // key = secret, data = `timestamp + "\n" + secret`, base64, then URL-encoded
  // because the result contains `+` and `/`.
  const raw = "7LVwF0dAF3/+MRRulbpE4y72Ogzykc6bS2nG4I99T4s=";
  assert.equal(dingtalkSign(1_700_000_000_000, "SECtestsecret"), encodeURIComponent(raw));
  assert.equal(dingtalkSign(1_700_000_000_000, "SECtestsecret"), "7LVwF0dAF3%2F%2BMRRulbpE4y72Ogzykc6bS2nG4I99T4s%3D");
  // Feishu's layout — key = `timestamp + "\n" + secret`, empty data — gives a
  // different value. Whichever of the two is wrong fails verification with a message
  // that reads like a permissions problem, so both are pinned.
  assert.notEqual(dingtalkSign(1_700_000_000_000, "SECtestsecret"), encodeURIComponent("Kx6iEeH+MqWVyW8zCpMDbhpVc+LqNN0CVbllVN4wKFM="));
});

test("dingtalk validates the address and its token", () => {
  const validate = (url: string) => dingtalkProvider.validate({ url, options: {} });
  assert.deepEqual(validate(DINGTALK_URL), { ok: true });
  assert.equal(validate("").code, "url-empty");
  assert.equal(validate("not a url").code, "url-bad-format");
  assert.equal(validate(DINGTALK_URL.replace("https://", "http://")).code, "url-http-not-allowed");
  assert.equal(validate(DINGTALK_URL.replace("oapi.dingtalk.com", "evil.example.com")).code, "url-wrong-host");
  assert.equal(validate("https://oapi.dingtalk.com/robot/markdown?access_token=abc123def456").code, "url-wrong-path");
  assert.equal(validate("https://oapi.dingtalk.com/robot/send").code, "url-missing-token");
});

test("dingtalk sends markdown, with the task name in the body because there is no card", async () => {
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ errcode: 0, errmsg: "ok" });
    },
    async () => {
      const result = await dingtalkProvider.send({
        url: DINGTALK_URL,
        options: {},
        message: { title: "Daily report", text: "2m 18s", level: "success" },
      });
      assert.deepEqual(result, { ok: true });
    },
  );

  assert.equal(captured.msgtype, "markdown");
  const markdown = captured.markdown as { title: string; text: string };
  // Unlike Feishu, this platform has no header: the name has to be in the message.
  assert.equal(markdown.text.startsWith("#### ✅ Daily report"), true);
  assert.match(markdown.text, /2m 18s/);
  // `title` is required and is what the chat list previews.
  assert.equal(markdown.title, "✅ Daily report");
  assert.deepEqual(captured.at, { isAtAll: false });
});

test("dingtalk honours the keyword security check, mentions, and the level", async () => {
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ errcode: 0 });
    },
    async () => {
      await dingtalkProvider.send({
        url: DINGTALK_URL,
        options: { mentionAll: true, atMobiles: ["13800001111"], keyword: "报警" },
        message: { title: "Nightly", text: "body", level: "error" },
      });
    },
  );

  const markdown = captured.markdown as { title: string; text: string };
  // The check inspects the text that goes out, so the keyword is prefixed rather
  // than left to the user's template.
  assert.equal(markdown.title, "[报警] ❌ Nightly");
  assert.match(markdown.text, /^#### \[报警\] ❌ Nightly/);
  const at = captured.at as { isAtAll: boolean; atMobiles: string[] };
  assert.equal(at.isAtAll, true);
  assert.deepEqual(at.atMobiles, ["13800001111"]);
  // A markdown @ needs the number in the body as well as in `at`.
  assert.match(markdown.text, /@13800001111/);
});

test("dingtalk appends the signature to the URL, in milliseconds", async () => {
  let calledUrl = "";
  await withFetch(
    (url) => {
      calledUrl = url;
      return jsonResponse({ errcode: 0 });
    },
    async () => {
      await dingtalkProvider.send({ url: DINGTALK_URL, signSecret: "SECtestsecret", options: {}, message: { text: "x" } });
    },
  );

  assert.match(calledUrl, /^https:\/\/oapi\.dingtalk\.com\/robot\/send\?access_token=abc123def456&timestamp=\d+&sign=/);
  const timestamp = Number(new URL(calledUrl).searchParams.get("timestamp"));
  // Milliseconds, not seconds: a seconds value is rejected and the error reads like a
  // permissions problem.
  assert.ok(timestamp > 10_000_000_000, `expected milliseconds, got ${timestamp}`);
  // `searchParams.get` decodes, and the sign value is base64 that contains `+` and
  // `/`; re-encoding compares like with like.
  assert.equal(encodeURIComponent(new URL(calledUrl).searchParams.get("sign") ?? ""), dingtalkSign(timestamp, "SECtestsecret"));
});

test("dingtalk reads the business code out of a 200 response", async () => {
  await withFetch(
    () => jsonResponse({ errcode: 310000, errmsg: "keywords not in content" }),
    async () => {
      const result = await dingtalkProvider.send({ url: DINGTALK_URL, options: {}, message: { text: "x" } });
      assert.equal(result.ok === false && result.code, "platform-rejected");
      // The platform's own wording is kept for the log, and it names the real cause.
      assert.match(String(result.ok === false && result.detail), /keywords not in content/);
    },
  );

  await withFetch(() => new Response("<html>", { status: 200 }), async () => {
    const result = await dingtalkProvider.send({ url: DINGTALK_URL, options: {}, message: { text: "x" } });
    assert.equal(result.ok === false && result.code, "response-unparsable");
  });

  await withFetch(() => new Response("nope", { status: 500, statusText: "Server Error" }), async () => {
    const result = await dingtalkProvider.send({ url: DINGTALK_URL, options: {}, message: { text: "x" } });
    assert.equal(result.ok === false && result.code, "http-error");
  });

  await withFetch(
    () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    },
    async () => {
      const result = await dingtalkProvider.send({ url: DINGTALK_URL, options: {}, message: { text: "x" } });
      assert.equal(result.ok === false && result.code, "timeout");
    },
  );
});

test("dingtalk counts its limit in characters, so Chinese is not cut to a third", async () => {
  // 3000 Chinese characters is 9000 bytes. A byte-only ceiling of 4000 would have
  // thrown most of it away; the character ceiling allows it.
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ errcode: 0 });
    },
    async () => {
      const result = await dingtalkProvider.send({
        url: DINGTALK_URL,
        options: {},
        message: { title: "T", text: "中".repeat(3_000) },
      });
      // 3000 characters plus the heading is still inside the 3800-character ceiling.
      assert.equal(result.ok && result.degraded, undefined);
    },
  );

  const text = (captured.markdown as { text: string }).text;
  assert.ok(text.length <= dingtalkProvider.capabilities.maxTextChars!, `got ${text.length} characters`);
  assert.ok(text.includes("中".repeat(3_000)));
});

test("dingtalk cuts a body that is too long, and keeps the heading", async () => {
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ errcode: 0 });
    },
    async () => {
      const result = await dingtalkProvider.send({
        url: DINGTALK_URL,
        options: {},
        message: { title: "T", text: "中".repeat(20_000), level: "success" },
      });
      assert.equal(result.ok && result.degraded, "truncated");
    },
  );

  const text = (captured.markdown as { text: string }).text;
  assert.ok(text.length <= dingtalkProvider.capabilities.maxTextChars!, `got ${text.length} characters`);
  // The heading is what identifies the notification, so it survives the cut.
  assert.match(text, /^#### ✅ T/);
});

test("wecom offers no signature field, because the platform has none", () => {
  assert.equal(wecomProvider.capabilities.supportsSign, false);
  assert.deepEqual(
    wecomProvider.credentialFields.map((field) => field.key),
    ["url"],
  );
});

test("wecom cannot mention everyone, and says so in its capabilities", () => {
  // Verified: the markdown message type's schema is `msgtype` + `content` only. Only
  // `text` accepts mentioned_list / mentioned_mobile_list, and markdown_v2 drops the
  // mention syntax entirely. So the capability is false rather than a silent no-op.
  assert.equal(wecomProvider.capabilities.supportsMentionAll, false);
  assert.equal(wecomProvider.capabilities.supportsMentionByMobile, false);
});

test("wecom validates the address and its key", () => {
  const validate = (url: string) => wecomProvider.validate({ url, options: {} });
  assert.deepEqual(validate(WECOM_URL), { ok: true });
  assert.equal(validate("").code, "url-empty");
  assert.equal(validate("nonsense").code, "url-bad-format");
  assert.equal(validate(WECOM_URL.replace("https://", "http://")).code, "url-http-not-allowed");
  assert.equal(validate(WECOM_URL.replace("qyapi.weixin.qq.com", "evil.example.com")).code, "url-wrong-host");
  assert.equal(validate("https://qyapi.weixin.qq.com/cgi-bin/webhook/other?key=693a91f6").code, "url-wrong-path");
  assert.equal(validate("https://qyapi.weixin.qq.com/cgi-bin/webhook/send").code, "url-missing-token");
  assert.equal(validate("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc").code, "url-token-too-short");
});

test("wecom sends markdown with the task name in the body", async () => {
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ errcode: 0, errmsg: "ok" });
    },
    async () => {
      const result = await wecomProvider.send({
        url: WECOM_URL,
        options: {},
        message: { title: "每日汇总", text: "2m 18s", level: "warn" },
      });
      assert.deepEqual(result, { ok: true });
    },
  );

  assert.equal(captured.msgtype, "markdown");
  const content = (captured.markdown as { content: string }).content;
  assert.equal(content.startsWith("#### ⚠️ 每日汇总"), true);
  assert.match(content, /2m 18s/);
  // No mention syntax at all: the platform cannot do it in markdown.
  assert.ok(!content.includes("<@"));
});

test("wecom reads the business code, and never leaks the key back", async () => {
  await withFetch(
    () => jsonResponse({ errcode: 93000, errmsg: "invalid webhook url" }),
    async () => {
      const result = await wecomProvider.send({ url: WECOM_URL, options: {}, message: { text: "x" } });
      assert.equal(result.ok === false && result.code, "platform-rejected");
      assert.match(String(result.ok === false && result.detail), /invalid webhook url/);
      // The detail comes from the platform, not from our own echo of the URL.
      assert.ok(!String(result.ok === false && result.detail).includes("693a91f6"));
    },
  );

  await withFetch(() => new Response("<html>", { status: 200 }), async () => {
    const result = await wecomProvider.send({ url: WECOM_URL, options: {}, message: { text: "x" } });
    assert.equal(result.ok === false && result.code, "response-unparsable");
  });
});

test("wecom respects its byte ceiling, heading included", async () => {
  let captured: Record<string, unknown> = {};
  await withFetch(
    (_url, init) => {
      captured = sentBody(init);
      return jsonResponse({ errcode: 0 });
    },
    async () => {
      const result = await wecomProvider.send({
        url: WECOM_URL,
        options: {},
        message: { title: "T", text: "中".repeat(5_000), level: "success" },
      });
      assert.equal(result.ok && result.degraded, "truncated");
    },
  );

  const content = (captured.markdown as { content: string }).content;
  assert.ok(Buffer.byteLength(content, "utf8") <= wecomProvider.capabilities.maxTextBytes, `got ${Buffer.byteLength(content, "utf8")}`);
  assert.match(content, /^#### ✅ T/);
  // No character ceiling is declared, because this platform documents bytes.
  assert.equal(wecomProvider.capabilities.maxTextChars, undefined);
});

test("wecom switches to markdown_v2 only when asked, and keeps the same content", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const send = async (options: Record<string, unknown>): Promise<void> => {
    await withFetch(
      (_url, init) => {
        bodies.push(sentBody(init));
        return jsonResponse({ errcode: 0, errmsg: "ok" });
      },
      async () => {
        const result = await wecomProvider.send({
          url: WECOM_URL,
          options,
          message: { title: "每日汇总", text: "2m 18s", level: "warn" },
        });
        assert.deepEqual(result, { ok: true });
      },
    );
  };

  await send({});
  await send({ useMarkdownV2: true });

  assert.equal(bodies[0].msgtype, "markdown");
  assert.equal(bodies[1].msgtype, "markdown_v2");

  // Identical content under a different key. The two message types document the same
  // 4096-byte ceiling, so only the envelope changes — which is also why the byte
  // budget above needs no second case.
  const legacy = (bodies[0].markdown as { content: string }).content;
  const modern = (bodies[1].markdown_v2 as { content: string }).content;
  assert.equal(modern, legacy);
  assert.match(modern, /^#### ⚠️ 每日汇总/);

  // A value that is not a boolean is not trusted, so the envelope stays the default.
  await send({ useMarkdownV2: "yes" });
  assert.equal(bodies[2].msgtype, "markdown");
});
