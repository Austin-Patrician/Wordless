import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	INVITE_CODE_LENGTH,
	INVITE_PASSWORD_LENGTH,
	MAX_INVITE_ENVELOPE_CHARS,
	buildInviteQr,
	formatInviteCode,
	generateInviteCode,
	generateInvitePassword,
	inviteBoxId,
	inviteBoxUrl,
	isValidInvitePassword,
	normalizeInviteCode,
	openInvite,
	parseInviteQr,
	readInviteEnvelope,
	sealInvite,
} from "../src/invite-code.ts";
import { RemoteProtocolError } from "../src/protocol.ts";
import type { RemoteRandomBytes } from "../src/crypto.ts";

/**
 * 配对材料。
 *
 * 这里钉住的是"用户到底要敲什么"和"中继到底能看到什么":
 * 连接码要好念好敲、要能容错;而**中继只能看到连接码的哈希**,拿不到码、密码与内容。
 */

/** 固定字节的随机源:让"生成"这一步可复现,否则断言只能写成"长度对"这类空话。 */
const fixedRandom = (byte: number): RemoteRandomBytes => (length) => new Uint8Array(length).fill(byte);

describe("连接码与密码", () => {
	it("连接码是 8 位,只用 Crockford 字母表(不含 I L O U)", () => {
		const code = generateInviteCode();
		assert.equal(code.length, INVITE_CODE_LENGTH);
		assert.doesNotMatch(code, /[ILOU]/);
		assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
	});

	it("密码是 6 位数字", () => {
		const password = generateInvitePassword();
		assert.equal(password.length, INVITE_PASSWORD_LENGTH);
		assert.match(password, /^\d{6}$/);
		assert.equal(isValidInvitePassword(password), true);
		assert.equal(isValidInvitePassword("12345"), false);
		assert.equal(isValidInvitePassword("abcdef"), false);
	});

	it("按两端显示的样子分组", () => {
		assert.equal(formatInviteCode("K7Q29MXD"), "K7Q2-9MXD");
	});

	it("用户敲进去的东西能容错:大小写、空格、连字符,以及看起来像数字的字母", () => {
		assert.equal(normalizeInviteCode("k7q2-9mxd"), "K7Q29MXD");
		assert.equal(normalizeInviteCode(" K7Q2 9MXD "), "K7Q29MXD");
		// Crockford 去掉了 O/I/L,所以它们按形近的数字读:O→0,I/L→1。
		assert.equal(normalizeInviteCode("OIL23456"), "01123456");
		assert.equal(normalizeInviteCode("K7Q29MX"), undefined);
		assert.equal(normalizeInviteCode("K7Q29MXDX"), undefined);
		assert.equal(normalizeInviteCode("K7Q2$MXD"), undefined);
	});
});

describe("二维码文本", () => {
	it("只装连接码与密码,不装整份配对信息", () => {
		const text = buildInviteQr({ code: "K7Q29MXD", password: "123456" });
		assert.equal(text, "WORDLESS://PAIR/K7Q29MXD/123456");
		assert.ok(text.length < 40);
	});

	it("不是默认中继时才带上中继地址", () => {
		const text = buildInviteQr({ code: "K7Q29MXD", password: "123456", relayBaseUrl: "wss://relay.example" });
		assert.equal(text, "WORDLESS://PAIR/K7Q29MXD/123456?relay=wss%3A%2F%2Frelay.example");
	});

	it("扫回来能拿到同样的三样东西", () => {
		const parsed = parseInviteQr("wordless://pair/k7q2-9mxd/123456");
		assert.deepEqual(parsed, { code: "K7Q29MXD", password: "123456" });
		assert.deepEqual(parseInviteQr(buildInviteQr({ code: "K7Q29MXD", password: "123456", relayBaseUrl: "wss://r.example" })), {
			code: "K7Q29MXD",
			password: "123456",
			relayBaseUrl: "wss://r.example",
		});
	});

	it("给了网页地址就生成网页地址形态 —— 手机相机扫到直接打开网页", () => {
		const text = buildInviteQr({ code: "K7Q29MXD", password: "123456", webBaseUrl: "https://relay.example" });
		assert.equal(text, "https://relay.example/#/PAIR/K7Q29MXD/123456");
		// 带中继覆盖时仍然带在查询里。
		assert.equal(
			buildInviteQr({ code: "K7Q29MXD", password: "123456", webBaseUrl: "https://relay.example/", relayBaseUrl: "wss://other.example" }),
			"https://relay.example/#/PAIR/K7Q29MXD/123456?relay=wss%3A%2F%2Fother.example",
		);
	});

	it("两种形态都能解析回来", () => {
		assert.deepEqual(parseInviteQr("https://relay.example/#/PAIR/K7Q29MXD/123456"), {
			code: "K7Q29MXD",
			password: "123456",
			webBaseUrl: "https://relay.example",
		});
		assert.deepEqual(parseInviteQr("https://relay.example/#/PAIR/K7Q29MXD/123456?relay=wss%3A%2F%2Fother.example"), {
			code: "K7Q29MXD",
			password: "123456",
			webBaseUrl: "https://relay.example",
			relayBaseUrl: "wss://other.example",
		});
		// 自定义协议那条老路仍然认(旧版客户端生成的二维码不该变成无效)。
		assert.deepEqual(parseInviteQr("WORDLESS://PAIR/K7Q29MXD/123456"), { code: "K7Q29MXD", password: "123456" });
	});

	it("自己生成的二维码自己能解析(往返一致)", () => {
		const text = buildInviteQr({ code: "K7Q29MXD", password: "123456", webBaseUrl: "https://relay.example" });
		const parsed = parseInviteQr(text);
		assert.equal(parsed?.code, "K7Q29MXD");
		assert.equal(parsed?.password, "123456");
	});

	it("别的二维码、或字段不对的,一律不认", () => {
		assert.equal(parseInviteQr("https://example.com"), undefined);
		assert.equal(parseInviteQr("WORDLESS://PAIR/K7Q29MXD"), undefined);
		assert.equal(parseInviteQr("WORDLESS://PAIR/K7Q29MXD/12345"), undefined);
		assert.equal(parseInviteQr("WORDLESS://PAIR/K7Q29MXD/123456/extra"), undefined);
		assert.equal(parseInviteQr("WORDLESS://PAIR/K7Q29MXD/123456?relay=not-a-url"), undefined);
		// 网页地址形态也要挑字段:路径不对、密码不对、多一段都不认。
		assert.equal(parseInviteQr("https://relay.example/#/OTHER/K7Q29MXD/123456"), undefined);
		assert.equal(parseInviteQr("https://relay.example/#/PAIR/K7Q29MXD/12345"), undefined);
		assert.equal(parseInviteQr("https://relay.example/#/PAIR/K7Q29MXD/123456/extra"), undefined);
		assert.equal(parseInviteQr("https://relay.example/#/PAIR/K7Q29MXD/123456?relay=not-a-url"), undefined);
		assert.equal(parseInviteQr(""), undefined);
	});
});

describe("信箱与信封", () => {
	const code = "K7Q29MXD";
	const password = "123456";
	const uri = "wordless://pair?v=2&pairingId=abc&relay=wss://relay.example";

	it("信箱名是连接码的哈希 —— 中继拿不到连接码本身", () => {
		const boxId = inviteBoxId(code);
		assert.match(boxId, /^[A-Za-z0-9_-]{43}$/);
		assert.notEqual(boxId, code);
		assert.equal(boxId.includes(code), false);
		// 同样的连接码永远得到同样的信箱名(桌面端与手机端各自算,不用互相告知)。
		assert.equal(inviteBoxId(code), boxId);
	});

	it("信箱地址是普通 HTTP(连接用 wss,取信封用 http)", () => {
		assert.equal(inviteBoxUrl("wss://relay.example", "BOX"), "https://relay.example/v2/invite/BOX");
		assert.equal(inviteBoxUrl("ws://127.0.0.1:8787", "BOX"), "http://127.0.0.1:8787/v2/invite/BOX");
	});

	it("密封之后能原样打开", async () => {
		const envelope = await sealInvite(uri, code, password);
		assert.equal(envelope.v, 1);
		assert.equal(await openInvite(envelope, code, password), uri);
	});

	it("密码或连接码不对就打不开", async () => {
		const envelope = await sealInvite(uri, code, password);
		await assert.rejects(() => openInvite(envelope, code, "000000"), RemoteProtocolError);
		await assert.rejects(() => openInvite(envelope, "K7Q29MXE", password), RemoteProtocolError);
	});

	it("信封里没有明文,也没有连接码与密码", async () => {
		const envelope = await sealInvite(uri, code, password);
		const serialized = JSON.stringify(envelope);
		assert.equal(serialized.includes("wordless://"), false);
		assert.equal(serialized.includes(code), false);
		assert.equal(serialized.includes(password), false);
	});

	it("形状不合规的信封会被中继挡掉", () => {
		assert.equal(readInviteEnvelope({ v: 1, nonce: "x".repeat(32), ciphertext: "y".repeat(30) })?.v, 1);
		assert.equal(readInviteEnvelope({ v: 2, nonce: "x".repeat(32), ciphertext: "y".repeat(30) }), undefined);
		assert.equal(readInviteEnvelope({ v: 1, nonce: "short", ciphertext: "y".repeat(30) }), undefined);
		assert.equal(readInviteEnvelope({ v: 1, nonce: "x".repeat(32), ciphertext: "" }), undefined);
		assert.equal(
			readInviteEnvelope({ v: 1, nonce: "x".repeat(32), ciphertext: "y".repeat(MAX_INVITE_ENVELOPE_CHARS + 1) }),
			undefined,
		);
		assert.equal(readInviteEnvelope("nope"), undefined);
		assert.equal(readInviteEnvelope(null), undefined);
	});

	it("同样的输入得到同样的密文长度(与随机源无关的部分)", async () => {
		const a = await sealInvite(uri, code, password, fixedRandom(7));
		const b = await sealInvite(uri, code, password, fixedRandom(7));
		// 固定随机源时,连 nonce 都一样 —— 说明实现没有偷偷用别的随机来源。
		assert.deepEqual(a, b);
	});
});
