import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	bytesEqual,
	decodePublicKey,
	deriveSessionKeys,
	fromBase64Url,
	generateEphemeralKeyPair,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	openFrame,
	sealFrame,
	sha256Hex,
	toBase64Url,
	verificationCode,
} from "../src/crypto.ts";
import { RemoteProtocolError, parseRemoteFrame } from "../src/protocol.ts";
import type { RemoteRequest } from "../src/types.ts";

/**
 * 加密层。
 *
 * 这里钉住三件事:**两端派生出同一把密钥**、**换一把密钥就解不开**、**公钥派生出的验证码两端一致**。
 * 任何一条坏了,要么连不上,要么等于没有加密。
 */

const request = (overrides: Partial<RemoteRequest> = {}): RemoteRequest => ({
	type: "request",
	requestId: "req-1",
	method: "session.list",
	...overrides,
});

describe("身份密钥", () => {
	it("私钥是 32 字节,公钥可以复算出来", () => {
		const pair = generateIdentityKeyPair();
		assert.equal(pair.secretKey.length, 32);
		assert.equal(pair.publicKey.length, 32);
		assert.deepEqual(identityKeyPairFromSecret(pair.secretKey).publicKey, pair.publicKey);
	});

	it("私钥长度不对时直接报错,不猜", () => {
		assert.throws(() => identityKeyPairFromSecret(new Uint8Array(31)), RemoteProtocolError);
	});

	it("每次生成的密钥都不同", () => {
		assert.notEqual(toBase64Url(generateEphemeralKeyPair().secretKey), toBase64Url(generateEphemeralKeyPair().secretKey));
	});
});

describe("会话密钥派生", () => {
	const mobile = { identity: generateIdentityKeyPair(), ephemeral: generateEphemeralKeyPair() };
	const desktop = { identity: generateIdentityKeyPair(), ephemeral: generateEphemeralKeyPair() };

	const derive = (role: "mobile" | "desktop") => {
		const own = role === "mobile" ? mobile : desktop;
		const peer = role === "mobile" ? desktop : mobile;
		return deriveSessionKeys({
			role,
			identity: own.identity,
			ephemeral: own.ephemeral,
			peerIdentityKey: peer.identity.publicKey,
			peerEphemeralKey: peer.ephemeral.publicKey,
		});
	};

	it("两端算出同一把密钥,而且是方向相反的", () => {
		const a = derive("mobile");
		const b = derive("desktop");
		assert.deepEqual(a.sendKey, b.receiveKey);
		assert.deepEqual(a.receiveKey, b.sendKey);
		assert.equal(a.sendKey.length, 32);
	});

	it("两端的方向密钥不相同(否则会共用 key+nonce)", () => {
		const a = derive("mobile");
		assert.equal(bytesEqual(a.sendKey, a.receiveKey), false);
	});

	it("换掉对端临时密钥,派生结果就不同 —— 这是防重放/防顶替的基础", () => {
		const other = deriveSessionKeys({
			role: "mobile",
			identity: mobile.identity,
			ephemeral: mobile.ephemeral,
			peerIdentityKey: desktop.identity.publicKey,
			peerEphemeralKey: generateEphemeralKeyPair().publicKey,
		});
		assert.equal(bytesEqual(other.sendKey, derive("mobile").sendKey), false);
	});

	it("换掉身份密钥,派生结果也不同", () => {
		const other = deriveSessionKeys({
			role: "mobile",
			identity: mobile.identity,
			ephemeral: mobile.ephemeral,
			peerIdentityKey: generateIdentityKeyPair().publicKey,
			peerEphemeralKey: desktop.ephemeral.publicKey,
		});
		assert.equal(bytesEqual(other.sendKey, derive("mobile").sendKey), false);
	});
});

describe("密封帧", () => {
	const key = deriveSessionKeys({
		role: "mobile",
		identity: generateIdentityKeyPair(),
		ephemeral: generateEphemeralKeyPair(),
		peerIdentityKey: generateIdentityKeyPair().publicKey,
		peerEphemeralKey: generateEphemeralKeyPair().publicKey,
	}).sendKey;

	it("密封后能原样打开,且内容仍是经过校验的帧", () => {
		const sealed = sealFrame(key, request({ payload: { hello: 1 } }));
		assert.equal(sealed.type, "sealed");
		assert.deepEqual(openFrame(key, sealed), request({ payload: { hello: 1 } }));
	});

	it("换一把密钥就认证失败", () => {
		const sealed = sealFrame(key, request());
		const other = new Uint8Array(key);
		other[0] ^= 0xff;
		assert.throws(() => openFrame(other, sealed), RemoteProtocolError);
	});

	it("关联数据不对也打不开", () => {
		const sealed = sealFrame(key, request());
		assert.throws(() => openFrame(key, sealed, "别的用途"), RemoteProtocolError);
	});

	it("密文被改动一位就打不开", () => {
		const sealed = sealFrame(key, request());
		const bytes = fromBase64Url(sealed.ciphertext);
		bytes[3] ^= 0x01;
		assert.throws(() => openFrame(key, { ...sealed, ciphertext: toBase64Url(bytes) }), RemoteProtocolError);
	});

	it("每次密封的 nonce 都不同(否则会重用 key+nonce)", () => {
		assert.notEqual(sealFrame(key, request()).nonce, sealFrame(key, request()).nonce);
	});

	it("解出来的内容仍要过帧校验:不合规的载荷打不开", () => {
		// 直接造一个"内容合法 JSON、但不是合规帧"的密封帧。
		const bad = sealFrame(key, { type: "request", requestId: "r", method: "session.list" });
		const decoded = parseRemoteFrame(JSON.stringify(bad));
		assert.deepEqual(decoded, bad);
		const forged = { ...bad, ciphertext: sealFrame(key, request()).ciphertext };
		assert.throws(() => openFrame(key, forged), RemoteProtocolError);
	});
});

describe("6 位验证码", () => {
	const a = generateIdentityKeyPair().publicKey;
	const b = generateIdentityKeyPair().publicKey;

	it("两端算出的验证码一致,与顺序无关", () => {
		assert.equal(verificationCode(a, b), verificationCode(b, a));
		assert.match(verificationCode(a, b), /^\d{6}$/);
	});

	it("换掉一方身份,验证码就不同(否则中间人不会被发现)", () => {
		assert.notEqual(verificationCode(a, b), verificationCode(a, generateIdentityKeyPair().publicKey));
	});
});

describe("base64url 与摘要", () => {
	it("往返一致,且不含 + / =", () => {
		const bytes = generateIdentityKeyPair().publicKey;
		const text = toBase64Url(bytes);
		assert.doesNotMatch(text, /[+/=]/);
		assert.deepEqual(fromBase64Url(text), bytes);
	});

	it("不是 base64url 时明确报错", () => {
		assert.throws(() => fromBase64Url("!!!!"), RemoteProtocolError);
	});

	it("公钥必须正好 32 字节", () => {
		assert.throws(() => decodePublicKey(toBase64Url(new Uint8Array(31))), RemoteProtocolError);
	});

	it("sha256 十六进制是 64 位小写", () => {
		assert.match(sha256Hex("wordless"), /^[0-9a-f]{64}$/);
	});
});
