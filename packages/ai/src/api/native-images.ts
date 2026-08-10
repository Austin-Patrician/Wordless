import type {
	AssistantImages,
	ImageContent,
	ImagesContext,
	ImagesModel,
	ImagesOptions,
	ProviderHeaders,
	ProviderResponse,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";

/**
 * The image options are intentionally read defensively. The image package is
 * consumed by older clients as well as the desktop runtime, and the latter
 * adds this bag incrementally.
 */
export interface NativeImageGenerationOptions {
	aspectRatio?: string;
	resolution?: string;
	size?: string;
	quality?: string;
	outputFormat?: string;
	outputCompression?: number;
	seed?: number;
	watermark?: boolean;
	promptEnhancement?: boolean | string;
	[key: string]: unknown;
}

export interface ImageModelConnection {
	region?: string;
	workspaceId?: string;
	endpoint?: string;
	[key: string]: unknown;
}

export interface NativeImageModel extends ImagesModel<string> {
	connection?: ImageModelConnection;
}

export function generationOptions(context: ImagesContext): NativeImageGenerationOptions {
	const value = (context as ImagesContext & { generation?: unknown }).generation;
	return isRecord(value) ? (value as NativeImageGenerationOptions) : {};
}

export function modelConnection(model: ImagesModel<string>): ImageModelConnection {
	const value = (model as ImagesModel<string> & { connection?: unknown }).connection;
	return isRecord(value) ? (value as ImageModelConnection) : {};
}

export function imagePrompt(context: ImagesContext): string {
	return context.input
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map((item) => item.text)
		.join("\n\n")
		.trim();
}

export function imageReferences(context: ImagesContext): ImageContent[] {
	return context.input.filter((item): item is ImageContent => item.type === "image");
}

export function imageDataUrl(image: ImageContent): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

export function outputCount(context: ImagesContext): number {
	const value = context.outputCount;
	if (typeof value !== "number" || !Number.isFinite(value)) return 1;
	return Math.max(1, Math.floor(value));
}

/** Return an API endpoint while accepting either an origin, an API root, or a full endpoint. */
export function appendEndpoint(baseUrl: string | undefined, path: string, fallbackOrigin: string): string {
	const raw = baseUrl?.trim() || fallbackOrigin;
	if (raw.endsWith(path)) return raw;
	return `${raw.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function mergeHeaders(model: ImagesModel<string>, options?: ImagesOptions): Record<string, string> {
	const merged = providerHeadersToRecord({
		...(model.headers ?? {}),
		...(options?.headers ?? {}),
	});
	return merged ?? {};
}

export function requestInit(
	model: ImagesModel<string>,
	apiKey: string,
	options?: ImagesOptions,
	additionalHeaders?: Record<string, string>,
): RequestInit {
	return {
		method: "POST",
		headers: {
			...mergeHeaders(model, options),
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...additionalHeaders,
		},
		...(options?.signal ? { signal: options.signal } : {}),
	};
}

/**
 * Reads a JSON API response and preserves its status/body for the common
 * provider-error formatter used by the rest of the package.
 */
export async function readJsonResponse<T>(response: Response, providerName: string): Promise<T> {
	const text = await response.text();
	let body: unknown = text;
	if (text.length > 0) {
		try {
			body = JSON.parse(text);
		} catch {
			// Keep the original text for diagnostics.
		}
	}
	if (!response.ok) {
		const error = new Error(`${providerName} API request failed (${response.status})`);
		Object.assign(error, { status: response.status, body });
		throw error;
	}
	if (text.length === 0) throw new Error(`${providerName} API returned an empty response`);
	return body as T;
}

export function applyPayloadOverride<T>(payload: T, model: ImagesModel<string>, options?: ImagesOptions): Promise<T> {
	return Promise.resolve(options?.onPayload?.(payload, model)).then((next) => (next === undefined ? payload : (next as T)));
}

export async function notifyResponse(response: Response, model: ImagesModel<string>, options?: ImagesOptions): Promise<void> {
	await options?.onResponse?.(
		{ status: response.status, headers: headersToRecord(response.headers) } satisfies ProviderResponse,
		model,
	);
}

export function createImageResult(model: ImagesModel<string>): AssistantImages {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

export function finishImageError(output: AssistantImages, error: unknown, options?: ImagesOptions): AssistantImages {
	output.stopReason = options?.signal?.aborted ? "aborted" : "error";
	output.errorMessage = formatProviderError(normalizeProviderError(error));
	return output;
}

/** Parse an inline data URL without decoding the base64 payload. */
export function parseImageDataUrl(value: string): ImageContent | undefined {
	const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s);
	if (!match) return undefined;
	return { type: "image", mimeType: match[1] || "image/png", data: match[2] };
}

/**
 * Download vendor-hosted image URLs immediately. DashScope URLs expire, so
 * adapters must return durable inline data to the Wordless runtime.
 */
export async function downloadImage(value: string, options?: ImagesOptions): Promise<ImageContent> {
	const inline = parseImageDataUrl(value);
	if (inline) return inline;
	const response = await fetch(value, {
		method: "GET",
		...(options?.signal ? { signal: options.signal } : {}),
	});
	if (!response.ok) {
		const error = new Error(`Image download failed (${response.status})`);
		Object.assign(error, { status: response.status, body: await response.text().catch(() => "") });
		throw error;
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || mimeTypeFromUrl(value);
	return { type: "image", mimeType, data: bytesToBase64(bytes) };
}

function bytesToBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
	let binary = "";
	const chunkSize = 0x8000;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	}
	return btoa(binary);
}

function mimeTypeFromUrl(value: string): string {
	try {
		const pathname = new URL(value).pathname.toLowerCase();
		if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
		if (pathname.endsWith(".webp")) return "image/webp";
		if (pathname.endsWith(".gif")) return "image/gif";
	} catch {
		// Fall through to PNG, the default used by both native APIs.
	}
	return "image/png";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
