import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils.js";
import { decodeSessionFrame, RemoteProtocolError } from "./protocol.ts";
import type { RemoteEndpointRole, RemoteIdentityKeyPair, RemoteSealed, RemoteSessionFrame } from "./types.ts";

/**
 * 端到端加密。
 *
 * 两端各持一把**长期 X25519 身份密钥**,每次连接再生成一把**临时密钥**,用三重 DH 混出会话密钥:
 *
 *   临时/临时      —— 每次连接都是新的,所以**过去的会话不会因为身份密钥将来泄露而被解开**
 *   身份/对端临时  —— 把身份绑进本次连接,防中间人拿自己的临时密钥顶替
 *   临时/对端身份  —— 同上,反方向
 *
 * 只看到公钥的中继推不出它;而单有身份密钥也解不开历史会话。
 * 派生出的**方向密钥**让两端永不共用同一对 (key, nonce)。
 *
 * 密码学只用已审计的 `@noble/*`:它同时能在 Node/Electron 与浏览器里跑,而且直接吃原始 32 字节私钥 ——
 * 这是 WebCrypto 做不到的(它不接受原始 X25519 私钥)。
 */

const NONCE_LENGTH = 24;
const KEY_LENGTH = 32;
const HKDF_INFO_PREFIX = "wordless-remote-v2";

/** 会话帧的关联数据。带上协议名与版本,避免同一把密钥被挪去解别的东西。 */
export const SESSION_ASSOCIATED_DATA = `${HKDF_INFO_PREFIX}/session`;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type RemoteRandomBytes = (length: number) => Uint8Array;

export const defaultRandomBytes: RemoteRandomBytes = (length) => nobleRandomBytes(length);

/** 身份密钥与临时密钥同构,只是生命周期不同 —— 分开命名是为了让调用点读起来不糊涂。 */
export function generateIdentityKeyPair(randomBytes: RemoteRandomBytes = defaultRandomBytes): RemoteIdentityKeyPair {
	const secretKey = randomBytes(KEY_LENGTH);
	return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export const generateEphemeralKeyPair = generateIdentityKeyPair;

/** 从存进系统凭据库的 32 字节私钥恢复密钥对(公钥是算出来的,不另存)。 */
export function identityKeyPairFromSecret(secretKey: Uint8Array): RemoteIdentityKeyPair {
	if (secretKey.length !== KEY_LENGTH) throw new RemoteProtocolError("identity secret must be 32 bytes");
	return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export interface RemoteSessionKeys {
	readonly sendKey: Uint8Array;
	readonly receiveKey: Uint8Array;
}

export interface DeriveSessionKeysInput {
	readonly role: RemoteEndpointRole;
	readonly identity: RemoteIdentityKeyPair;
	readonly ephemeral: RemoteIdentityKeyPair;
	readonly peerIdentityKey: Uint8Array;
	readonly peerEphemeralKey: Uint8Array;
}

export function deriveSessionKeys(input: DeriveSessionKeysInput): RemoteSessionKeys {
	const ephemeralShared = x25519.getSharedSecret(input.ephemeral.secretKey, input.peerEphemeralKey);
	const identityToPeerEphemeral = x25519.getSharedSecret(input.identity.secretKey, input.peerEphemeralKey);
	const ephemeralToPeerIdentity = x25519.getSharedSecret(input.ephemeral.secretKey, input.peerIdentityKey);
	// 两个"静态/临时"混合按角色排序:两端各自算出的 ikm 与 salt 顺序必须一致,否则派生不出同一把密钥。
	const mobileFirst = input.role === "mobile";
	const ikm = concat(
		ephemeralShared,
		mobileFirst ? identityToPeerEphemeral : ephemeralToPeerIdentity,
		mobileFirst ? ephemeralToPeerIdentity : identityToPeerEphemeral,
	);
	const salt = concat(
		...(mobileFirst
			? [input.identity.publicKey, input.peerIdentityKey, input.ephemeral.publicKey, input.peerEphemeralKey]
			: [input.peerIdentityKey, input.identity.publicKey, input.peerEphemeralKey, input.ephemeral.publicKey]),
	);
	const material = hkdf(sha256, ikm, salt, textEncoder.encode(`${HKDF_INFO_PREFIX}/session`), KEY_LENGTH * 2);
	const mobileToDesktop = material.slice(0, KEY_LENGTH);
	const desktopToMobile = material.slice(KEY_LENGTH);
	return mobileFirst
		? { sendKey: mobileToDesktop, receiveKey: desktopToMobile }
		: { sendKey: desktopToMobile, receiveKey: mobileToDesktop };
}

export interface SealOptions {
	readonly randomBytes?: RemoteRandomBytes;
}

export function sealFrame(
	key: Uint8Array,
	frame: RemoteSessionFrame,
	associatedData: string = SESSION_ASSOCIATED_DATA,
	options: SealOptions = {},
): RemoteSealed {
	const nonce = (options.randomBytes ?? defaultRandomBytes)(NONCE_LENGTH);
	const cipher = xchacha20poly1305(key, nonce, textEncoder.encode(associatedData));
	const ciphertext = cipher.encrypt(textEncoder.encode(JSON.stringify(frame)));
	return { type: "sealed", nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext) };
}

/** 打不开(认证失败、不是 JSON、或内容不合规)一律抛 `RemoteProtocolError` —— 不返回"半个帧"。 */
export function openFrame(
	key: Uint8Array,
	sealed: RemoteSealed,
	associatedData: string = SESSION_ASSOCIATED_DATA,
): RemoteSessionFrame {
	let plaintext: Uint8Array;
	try {
		const cipher = xchacha20poly1305(key, fromBase64Url(sealed.nonce), textEncoder.encode(associatedData));
		plaintext = cipher.decrypt(fromBase64Url(sealed.ciphertext));
	} catch {
		throw new RemoteProtocolError("sealed frame failed authentication");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(textDecoder.decode(plaintext));
	} catch {
		throw new RemoteProtocolError("sealed frame is not valid JSON");
	}
	return decodeSessionFrame(parsed);
}

/**
 * 6 位验证码,由双方身份公钥派生。手动配对时两端对显,用来发现中间人。
 * 先排序再派生,所以两端算出同一个值,而且与"谁先连谁"无关。
 */
export function verificationCode(identityKeyA: Uint8Array, identityKeyB: Uint8Array): string {
	const [first, second] =
		compareBytes(identityKeyA, identityKeyB) <= 0 ? [identityKeyA, identityKeyB] : [identityKeyB, identityKeyA];
	const digest = hkdf(sha256, concat(first, second), undefined, textEncoder.encode(`${HKDF_INFO_PREFIX}/sas`), 4);
	const value = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
	return String(value % 1_000_000).padStart(6, "0");
}

export function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
	const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	let binary: string;
	try {
		binary = atob(padded);
	} catch {
		throw new RemoteProtocolError("value is not valid base64url");
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

export function decodePublicKey(text: string, field = "public key"): Uint8Array {
	const bytes = fromBase64Url(text);
	if (bytes.length !== KEY_LENGTH) throw new RemoteProtocolError(`${field} must be 32 bytes`);
	return bytes;
}

/** 定时比较,避免"提前返回"泄露比较进度。 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
	return diff === 0;
}

export function sha256Hex(text: string): string {
	return Array.from(sha256(textEncoder.encode(text)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32, randomBytes: RemoteRandomBytes = defaultRandomBytes): string {
	return toBase64Url(randomBytes(bytes));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const diff = a[index] - b[index];
		if (diff !== 0) return diff;
	}
	return a.length - b.length;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const output = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}
