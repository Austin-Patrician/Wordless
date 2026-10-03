import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { RemoteProtocolError } from "./protocol.ts";
import { defaultRandomBytes, fromBase64Url, toBase64Url, type RemoteRandomBytes } from "./crypto.ts";

/**
 * 配对材料:让"手机和电脑不在一起"也能配对。
 *
 * 电脑把配对信息用**一个短连接码 + 一个短密码**封起来,放进中继上的一个信箱里存几分钟。
 * 手机输入这两样就能取回并打开它。
 *
 * 中继只知道**连接码的哈希** —— 连接码、密码和配对信息它都看不到。
 * 猜连接码必须在线进行(40 bit,而且每个信箱只允许几次读取);密码(20 bit)只保护中继交出去的那一份,
 * 所以密钥用 PBKDF2 拉高单次成本,并且信箱随邀请一起过期。
 */

export const INVITE_CODE_LENGTH = 8;
export const INVITE_PASSWORD_LENGTH = 6;
export const INVITE_KDF_ITERATIONS = 200_000;
export const INVITE_ASSOCIATED_DATA = "wordless-invite-v1";
/** 中继保存的信封上限(序列化后的 JSON 字符数)。 */
export const MAX_INVITE_ENVELOPE_CHARS = 8_192;

/** Crockford base32:去掉了 I、L、O、U —— 念出来或照着重敲都不会错。 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BOX_ID_PREFIX = "wordless-invite-box-v1:";
const KEY_SALT_PREFIX = "wordless-invite-key-v1:";
const NONCE_LENGTH = 24;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface RemoteInviteEnvelope {
	readonly v: 1;
	readonly nonce: string;
	readonly ciphertext: string;
}

/** 8 位、40 bit,均匀取样(不做取模偏置)。 */
export function generateInviteCode(randomBytes: RemoteRandomBytes = defaultRandomBytes): string {
	return Array.from(randomBytes(INVITE_CODE_LENGTH), (byte) => CODE_ALPHABET[byte & 31]).join("");
}

/** 6 位数字;用拒绝取样保证每个值等概率。 */
export function generateInvitePassword(randomBytes: RemoteRandomBytes = defaultRandomBytes): string {
	let digits = "";
	while (digits.length < INVITE_PASSWORD_LENGTH) {
		for (const byte of randomBytes(INVITE_PASSWORD_LENGTH)) {
			if (byte < 250 && digits.length < INVITE_PASSWORD_LENGTH) digits += String(byte % 10);
		}
	}
	return digits;
}

/** 两端都按这个样子显示:`K7Q29MXD` → `K7Q2-9MXD`。 */
export function formatInviteCode(code: string): string {
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * 把用户敲进去的东西还原成连接码:大小写、空格、连字符都不计较,
 * 而且 Crockford 里被去掉的那几个字母按"看起来像的数字"读。无法构成连接码时返回 undefined。
 */
export function normalizeInviteCode(input: string): string | undefined {
	const code = input
		.toUpperCase()
		.replace(/[\s-]/g, "")
		.replace(/O/g, "0")
		.replace(/[IL]/g, "1");
	if (code.length !== INVITE_CODE_LENGTH) return undefined;
	for (const char of code) if (!CODE_ALPHABET.includes(char)) return undefined;
	return code;
}

export function isValidInvitePassword(password: string): boolean {
	return new RegExp(`^\\d{${INVITE_PASSWORD_LENGTH}}$`).test(password);
}

/**
 * 有连接码时二维码里装什么:只装**连接码与密码**,不装整份配对信息 ——
 * 于是二维码模块数只有四分之一,好扫得多,中心还能放个徽标。
 *
 * 两种形态:
 *
 * - **网页地址**(默认,`webBaseUrl` 给了就用它):`https://<中继>/#/PAIR/<码>/<密码>`。
 *   手机相机扫到它**直接打开网页**,一个字都不用敲 —— 远端是浏览器时这才是对的形态。
 * - **自定义协议**(`WORDLESS://PAIR/…`):留给以后的原生客户端;没有网页地址时用它。
 */
export interface InviteQr {
	readonly code: string;
	readonly password: string;
	/** 中继地址。二维码里只在它**不是**手机默认用的那个时才带上。 */
	readonly relayBaseUrl?: string;
	/** 网页客户端的地址(通常与中继同域)。给了就生成网页地址形态。 */
	readonly webBaseUrl?: string;
}

const INVITE_QR_PREFIX = "WORDLESS://PAIR/";
const WEB_PAIR_PATH = "/#/PAIR/";

export function buildInviteQr(invite: InviteQr): string {
	const webBaseUrl = invite.webBaseUrl?.replace(/\/+$/, "");
	if (webBaseUrl !== undefined && webBaseUrl.length > 0) {
		const text = `${webBaseUrl}${WEB_PAIR_PATH}${invite.code}/${invite.password}`;
		return invite.relayBaseUrl ? `${text}?relay=${encodeURIComponent(invite.relayBaseUrl)}` : text;
	}
	const text = `${INVITE_QR_PREFIX}${invite.code}/${invite.password}`;
	return invite.relayBaseUrl ? `${text}?relay=${encodeURIComponent(invite.relayBaseUrl)}` : text;
}

/**
 * 解析二维码或链接里的邀请 —— **两种形态都认**。
 *
 * 认两种是因为:旧版客户端只会生成自定义协议,而新版生成网页地址。手机端只认一种,
 * 就会出现"扫旧二维码提示无效"这种完全可以避免的失败。
 */
export function parseInviteQr(text: string): InviteQr | undefined {
	const trimmed = text.trim();
	if (trimmed.length === 0) return undefined;

	// 网页地址形态:`https://host/#/PAIR/<码>/<密码>`
	const hashIndex = trimmed.indexOf("#");
	if (hashIndex >= 0) {
		const hash = trimmed.slice(hashIndex + 1).replace(/^\/+/, "");
		const [path = "", query = ""] = hash.split("?", 2);
		const parts = path.split("/");
		if (parts[0]?.toUpperCase() !== "PAIR") return undefined;
		const code = normalizeInviteCode(parts[1] ?? "");
		const password = parts[2] ?? "";
		if (!code || parts.length > 3 || !isValidInvitePassword(password)) return undefined;
		const relay = new URLSearchParams(query).get("relay") ?? undefined;
		if (relay !== undefined && !/^wss?:\/\/[^\s/]+/i.test(relay)) return undefined;
		const webBaseUrl = trimmed.slice(0, hashIndex).replace(/\/+$/, "");
		return { code, password, ...(relay === undefined ? {} : { relayBaseUrl: relay }), ...(webBaseUrl.length === 0 ? {} : { webBaseUrl }) };
	}

	// 自定义协议形态:`WORDLESS://PAIR/<码>/<密码>[?relay=]`
	if (trimmed.slice(0, INVITE_QR_PREFIX.length).toUpperCase() !== INVITE_QR_PREFIX) return undefined;
	const [path = "", query = ""] = trimmed.slice(INVITE_QR_PREFIX.length).split("?", 2);
	const [rawCode = "", password = "", ...rest] = path.split("/");
	const code = normalizeInviteCode(rawCode);
	if (!code || rest.length > 0 || !isValidInvitePassword(password)) return undefined;
	const relay = new URLSearchParams(query).get("relay") ?? undefined;
	if (relay !== undefined && !/^wss?:\/\/[^\s/]+/i.test(relay)) return undefined;
	return relay ? { code, password, relayBaseUrl: relay } : { code, password };
}

/** 信箱在中继上的名字。**连接码本身永远不离开两端。** */
export function inviteBoxId(code: string): string {
	return toBase64Url(sha256(textEncoder.encode(`${BOX_ID_PREFIX}${code}`)));
}

/** 信箱的 HTTP 地址(连接时用的是 wss,信箱是普通的 HTTP 请求)。 */
export function inviteBoxUrl(relayBaseUrl: string, boxId: string): string {
	return `${relayBaseUrl.replace(/^ws(s?):/, "http$1:")}/v2/invite/${boxId}`;
}

export async function sealInvite(
	inviteUri: string,
	code: string,
	password: string,
	randomBytes: RemoteRandomBytes = defaultRandomBytes,
): Promise<RemoteInviteEnvelope> {
	const key = await inviteKey(code, password);
	const nonce = randomBytes(NONCE_LENGTH);
	const cipher = xchacha20poly1305(key, nonce, textEncoder.encode(INVITE_ASSOCIATED_DATA));
	return { v: 1, nonce: toBase64Url(nonce), ciphertext: toBase64Url(cipher.encrypt(textEncoder.encode(inviteUri))) };
}

/** 打开信封;密码(或连接码)不对时抛错,不返回半个结果。 */
export async function openInvite(
	envelope: RemoteInviteEnvelope,
	code: string,
	password: string,
): Promise<string> {
	const key = await inviteKey(code, password);
	try {
		const cipher = xchacha20poly1305(key, fromBase64Url(envelope.nonce), textEncoder.encode(INVITE_ASSOCIATED_DATA));
		return textDecoder.decode(cipher.decrypt(fromBase64Url(envelope.ciphertext)));
	} catch {
		throw new RemoteProtocolError("invite failed authentication");
	}
}

/** 形状合法的信封,或 undefined。中继也用它挡掉不合规的写入。 */
export function readInviteEnvelope(value: unknown): RemoteInviteEnvelope | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (record.v !== 1 || typeof record.nonce !== "string" || typeof record.ciphertext !== "string") return undefined;
	if (!/^[A-Za-z0-9_-]{32}$/.test(record.nonce)) return undefined;
	if (!/^[A-Za-z0-9_-]{22,}$/.test(record.ciphertext) || record.ciphertext.length > MAX_INVITE_ENVELOPE_CHARS) {
		return undefined;
	}
	return { v: 1, nonce: record.nonce, ciphertext: record.ciphertext };
}

function inviteKey(code: string, password: string): Promise<Uint8Array> {
	return pbkdf2Async(sha256, textEncoder.encode(password), textEncoder.encode(`${KEY_SALT_PREFIX}${code}`), {
		c: INVITE_KDF_ITERATIONS,
		dkLen: 32,
	});
}
