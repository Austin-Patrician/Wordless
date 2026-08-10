import type {
	AssistantImages,
	ImageContent,
	ImagesContext,
	ImagesFunction,
	ImagesGenerationOptions,
	ImagesModel,
	ImagesOptions,
	ProviderImages,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";

const INTERACTIONS_PATH = "/interactions";

interface GoogleInteractionInputText {
	type: "text";
	text: string;
}
interface GoogleInteractionInputImage {
	type: "image";
	mime_type: string;
	data: string;
}

type GoogleInteractionInput = GoogleInteractionInputText | GoogleInteractionInputImage;

interface GoogleImageBlock {
	type?: string;
	data?: string;
	mime_type?: string;
	mimeType?: string;
	image?: GoogleImageBlock;
}

interface GoogleInteractionResponse {
	id?: string;
	interaction_id?: string;
	output_image?: GoogleImageBlock;
	output_text?: string;
	outputs?: unknown;
	output?: unknown;
	steps?: unknown;
	usage?: Record<string, unknown>;
	usage_metadata?: Record<string, unknown>;
}

/** Image API factory for Google's Interactions API (Nano Banana). */
export const googleInteractionsImagesApi = (): ProviderImages => ({
	generateImages: (model, context, options) =>
		generateImages(model as ImagesModel<"google-interactions-images">, context, options),
});

/** Alias kept concise for provider factories and custom integrations. */
export const googleImagesApi = googleInteractionsImagesApi;

export const generateImages: ImagesFunction<"google-interactions-images", ImagesOptions> = async (
	model: ImagesModel<"google-interactions-images">,
	context: ImagesContext,
	options?: ImagesOptions,
): Promise<AssistantImages> => {
	const output: AssistantImages = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "stop",
		timestamp: Date.now(),
	};

	try {
		const apiKey = options?.apiKey;
		if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
		const prompt = context.input
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n\n")
			.trim();
		if (!prompt) throw new Error("An image prompt is required");
		if (context.edit?.mask) {
			throw new Error("Google Nano Banana does not support raster mask editing; provide a reference image and prompt instead");
		}
		if (context.edit?.background) {
			throw new Error("Google Nano Banana does not support transparent background output");
		}
		if (context.edit?.inputFidelity) {
			throw new Error("Google Nano Banana does not support input fidelity controls");
		}

		const references = context.input.filter((item): item is ImageContent => item.type === "image");
		const maxReferences = model.capabilities?.maxReferenceImages;
		if (maxReferences !== undefined && references.length > maxReferences) {
			throw new Error(`The selected Google image model accepts at most ${maxReferences} reference image${maxReferences === 1 ? "" : "s"}`);
		}
		const outputCount = context.outputCount ?? 1;
		if (outputCount > 1) {
			throw new Error("Google Nano Banana returns one image per request");
		}

		const requestBody: GoogleInteractionRequest = {
			model: model.id,
			input: context.input.map(toGoogleInput),
			store: false,
			response_format: buildResponseFormat(context.generation),
		};
		let body: unknown = requestBody;
		const nextBody = await options?.onPayload?.(body, model);
		if (nextBody !== undefined) body = nextBody;

		const request = createRequestSignal(options?.signal, options?.timeoutMs);
		try {
			const response = await fetch(interactionsUrl(model.baseUrl), {
				method: "POST",
				headers: buildHeaders(model, apiKey, options?.headers),
				body: JSON.stringify(body),
				...(request.signal ? { signal: request.signal } : {}),
			});
			await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
			const payload = await readJsonResponse(response);
			if (!response.ok) throw createHttpError(response.status, payload);

			const parsed = payload as GoogleInteractionResponse;
			output.responseId = parsed.id ?? parsed.interaction_id;
			for (const image of extractImages(parsed)) {
				output.output.push({ type: "image", mimeType: image.mimeType, data: image.data });
			}
			for (const text of extractTexts(parsed)) {
				if (text.trim()) output.output.push({ type: "text", text });
			}
			const usage = parseUsage(parsed.usage ?? parsed.usage_metadata, model);
			if (usage) output.usage = usage;
		} finally {
			request.cleanup();
		}

		if (!output.output.some((item) => item.type === "image")) {
			throw new Error("The Google Interactions image API returned no image data");
		}
		return output;
	} catch (error) {
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = formatProviderError(normalizeProviderError(error));
		return output;
	}
};

interface GoogleInteractionRequest {
	model: string;
	input: GoogleInteractionInput[];
	store: false;
	response_format: {
		type: "image";
		mime_type?: "image/png" | "image/jpeg";
		aspect_ratio?: string;
		image_size?: string;
	};
}

function interactionsUrl(baseUrl: string): string {
	const base = baseUrl.replace(/\/+$/, "");
	return base.endsWith(INTERACTIONS_PATH) ? base : `${base}${INTERACTIONS_PATH}`;
}

function buildHeaders(
	model: ImagesModel<"google-interactions-images">,
	apiKey: string,
	optionsHeaders?: Record<string, string | null>,
): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"x-goog-api-key": apiKey,
		...(providerHeadersToRecord({ ...model.headers, ...optionsHeaders }) ?? {}),
	};
}

function toGoogleInput(item: ImagesContext["input"][number]): GoogleInteractionInput {
	if (item.type === "text") {
		return { type: "text", text: sanitizeSurrogates(item.text) };
	}
	return { type: "image", mime_type: item.mimeType, data: item.data };
}

function buildResponseFormat(generation: ImagesGenerationOptions | undefined): GoogleInteractionRequest["response_format"] {
	const format: GoogleInteractionRequest["response_format"] = { type: "image" };
	if (generation?.outputFormat) {
		if (generation.outputFormat === "webp") {
			throw new Error("Google Nano Banana supports PNG or JPEG output, not WebP");
		}
		format.mime_type = generation.outputFormat === "jpeg" ? "image/jpeg" : "image/png";
	}
	if (generation?.aspectRatio?.trim()) format.aspect_ratio = generation.aspectRatio.trim();
	const imageSize = normalizeGoogleImageSize(generation?.resolution ?? generation?.size);
	if (imageSize) format.image_size = imageSize;
	return format;
}

function normalizeGoogleImageSize(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toUpperCase();
	if (["0.5K", "1K", "2K", "4K"].includes(normalized)) return normalized;
	if (/^\d{3,5}X\d{3,5}$/.test(normalized)) {
		const [width, height] = normalized.split("X").map(Number);
		if (width <= 1024 && height <= 1024) return "1K";
		if (width <= 2048 && height <= 2048) return "2K";
		return "4K";
	}
	return undefined;
}

function extractImages(payload: GoogleInteractionResponse): Array<{ data: string; mimeType: string }> {
	const candidates: unknown[] = [];
	if (payload.output_image) candidates.push(payload.output_image);
	for (const key of ["outputs", "output", "steps"] as const) {
		const value = payload[key];
		if (Array.isArray(value)) candidates.push(...value);
		else if (value !== undefined) candidates.push(value);
	}
	const images: Array<{ data: string; mimeType: string }> = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const image = imageFromBlock(candidate);
		if (!image || seen.has(image.data)) continue;
		seen.add(image.data);
		images.push(image);
	}
	return images;
}

function imageFromBlock(value: unknown): { data: string; mimeType: string } | undefined {
	if (!isRecord(value)) return undefined;
	const nested = isRecord(value.image) ? value.image : isRecord(value.output_image) ? value.output_image : value;
	const data = nested.data;
	if (typeof data !== "string" || data.length === 0) return undefined;
	const mimeType =
		typeof nested.mime_type === "string"
			? nested.mime_type
			: typeof nested.mimeType === "string"
				? nested.mimeType
				: "image/png";
	return { data, mimeType };
}

function extractTexts(payload: GoogleInteractionResponse): string[] {
	const texts: string[] = [];
	if (typeof payload.output_text === "string") texts.push(payload.output_text);
	for (const key of ["outputs", "output", "steps"] as const) {
		const value = payload[key];
		const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
		for (const candidate of values) {
			if (!isRecord(candidate)) continue;
			if (candidate.type === "text" && typeof candidate.text === "string") texts.push(candidate.text);
			if (typeof candidate.output_text === "string") texts.push(candidate.output_text);
		}
	}
	return [...new Set(texts)];
}

function parseUsage(raw: Record<string, unknown> | undefined, model: ImagesModel<"google-interactions-images">) {
	if (!raw) return undefined;
	const input = numberValue(raw.input_tokens ?? raw.prompt_tokens ?? raw.inputTokens);
	const output = numberValue(raw.output_tokens ?? raw.completion_tokens ?? raw.outputTokens);
	const cacheRead = numberValue(raw.cached_tokens ?? raw.cache_read_tokens ?? raw.cachedTokens);
	if (input === 0 && output === 0 && cacheRead === 0) return undefined;
	const usage = {
		input: Math.max(0, input - cacheRead),
		output,
		cacheRead,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: {
			input: (model.cost.input / 1_000_000) * Math.max(0, input - cacheRead),
			output: (model.cost.output / 1_000_000) * output,
			cacheRead: (model.cost.cacheRead / 1_000_000) * cacheRead,
			cacheWrite: 0,
			total: 0,
		},
	};
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead;
	return usage;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

async function readJsonResponse(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function createHttpError(status: number, body: unknown): Error & { status: number; body: string } {
	const message = typeof body === "string" ? body : JSON.stringify(body);
	const error = new Error(`Google Interactions request failed with status ${status}`) as Error & {
		status: number;
		body: string;
	};
	error.status = status;
	error.body = message;
	return error;
}

function createRequestSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): {
	signal?: AbortSignal;
	cleanup: () => void;
} {
	if (timeoutMs === undefined) return { signal, cleanup: () => undefined };
	const controller = new AbortController();
	const onAbort = () => controller.abort(signal?.reason);
	if (signal) {
		if (signal.aborted) controller.abort(signal.reason);
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		},
	};
}
