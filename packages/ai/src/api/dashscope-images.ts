import type {
	AssistantImages,
	ImageContent,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
	ProviderImages,
} from "../types.ts";
import {
	asString,
	applyPayloadOverride,
	appendEndpoint,
	createImageResult,
	downloadImage,
	finishImageError,
	generationOptions,
	imageDataUrl,
	imagePrompt,
	isRecord,
	modelConnection,
	notifyResponse,
	outputCount,
	readJsonResponse,
	requestInit,
} from "./native-images.ts";

export const DASHSCOPE_IMAGE_BASE_URL = "https://dashscope.aliyuncs.com";
export const DASHSCOPE_IMAGE_INTL_BASE_URL = "https://dashscope-intl.aliyuncs.com";
export const DASHSCOPE_IMAGE_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

type DashScopeImagesModel = ImagesModel<"dashscope-images">;

interface DashScopeImagePayload {
	model: string;
	input: {
		messages: Array<{
			role: "user";
			content: Array<{ text: string } | { image: string }>;
		}>;
	};
	parameters?: Record<string, unknown>;
}

/** Native Alibaba Cloud Bailian / Wan image protocol. */
export const dashscopeImagesApi = (): ProviderImages => ({
	generateImages: (model, context, options) =>
		generateImages(model as DashScopeImagesModel, context, options),
});

/** Alias matching the product-facing provider name. */
export const bailianImagesApi = dashscopeImagesApi;

export const generateImages: ImagesFunction<"dashscope-images", ImagesOptions> = async (
	model: DashScopeImagesModel,
	context: ImagesContext,
	options?: ImagesOptions,
): Promise<AssistantImages> => {
	const result = createImageResult(model);

	try {
		if (!options?.apiKey) throw new Error(`No API key for provider: ${model.provider}`);
		const prompt = imagePrompt(context);
		if (!prompt) throw new Error("An image prompt is required");
		if (context.edit?.mask) {
			throw new Error("The Bailian image adapter does not support raster mask editing");
		}
		if (context.edit?.background) {
			throw new Error("The Bailian image adapter does not support transparent background output");
		}
		if (context.edit?.inputFidelity) {
			throw new Error("The Bailian image adapter does not support input fidelity controls");
		}

		const payload = await applyPayloadOverride(buildPayload(model, context), model, options);
		const endpoint = resolveDashScopeEndpoint(model);
		const init = requestInit(model, options.apiKey, options, workspaceHeaders(model));
		init.body = JSON.stringify(payload);
		const response = await fetch(endpoint, init);
		await notifyResponse(response, model, options);
		const body = await readJsonResponse<unknown>(response, "Bailian");
		result.responseId = findResponseId(body);

		const imageValues = collectImageValues(body);
		for (const value of imageValues) {
			if (value.kind === "base64") {
				result.output.push({ type: "image", mimeType: value.mimeType ?? "image/png", data: value.value });
			} else {
				result.output.push(await downloadImage(value.value, options));
			}
		}
		if (result.output.filter((item) => item.type === "image").length === 0) {
			throw new Error("The Bailian image API returned no image data");
		}
		return result;
	} catch (error) {
		return finishImageError(result, error, options);
	}
};

function buildPayload(model: DashScopeImagesModel, context: ImagesContext): DashScopeImagePayload {
	const content: DashScopeImagePayload["input"]["messages"][number]["content"] = context.input.map((item) =>
		item.type === "text" ? { text: item.text } : { image: imageDataUrl(item) },
	);
	const generation = generationOptions(context);
	const parameters: Record<string, unknown> = {
		n: outputCount(context),
	};
	const size = resolveDashScopeSize(generation);
	if (size) parameters.size = size;
	if (typeof generation.seed === "number" && Number.isFinite(generation.seed)) parameters.seed = generation.seed;
	if (typeof generation.watermark === "boolean") parameters.watermark = generation.watermark;
	return {
		model: model.id,
		input: { messages: [{ role: "user", content }] },
		...(Object.keys(parameters).length > 0 ? { parameters } : {}),
	};
}

function resolveDashScopeSize(generation: ReturnType<typeof generationOptions>): string | undefined {
	const candidate = asString(generation.resolution) ?? asString(generation.size);
	const aspectRatio = asString(generation.aspectRatio);
	if (candidate && candidate !== "auto") {
		if (/^\d+x\d+$/i.test(candidate)) return candidate.replace(/x/i, "*");
		if (/^\d+\*\d+$/.test(candidate)) return candidate;
		if (/^(?:1K|2K|4K)$/i.test(candidate)) {
			return aspectRatio ? sizeForAspectRatio(aspectRatio, candidate) : candidate.toUpperCase();
		}
	}
	return sizeForAspectRatio(aspectRatio);
}

/** DashScope accepts explicit WIDTH*HEIGHT values when callers choose a ratio. */
function sizeForAspectRatio(aspectRatio: string | undefined, resolution?: string): string | undefined {
	if (!aspectRatio) return undefined;
	const [width, height] = aspectRatio.split(":").map(Number);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
	const longestSide = resolution?.toUpperCase() === "4K" ? 4096 : resolution?.toUpperCase() === "2K" ? 2048 : 1376;
	const scale = longestSide / Math.max(width, height);
	const minimumSide = resolution?.toUpperCase() === "4K" ? 1024 : 768;
	const scaledWidth = Math.max(minimumSide, Math.round((width * scale) / 16) * 16);
	const scaledHeight = Math.max(minimumSide, Math.round((height * scale) / 16) * 16);
	return `${scaledWidth}*${scaledHeight}`;
}

function workspaceHeaders(model: DashScopeImagesModel): Record<string, string> | undefined {
	const connection = modelConnection(model);
	const workspaceId = asString(connection.workspaceId);
	// Workspace-hosted endpoints carry the workspace in their hostname. Keep the
	// legacy header only for a user-supplied DashScope-compatible endpoint.
	return workspaceId && !usesWorkspaceEndpoint(model) ? { "X-DashScope-WorkSpace": workspaceId } : undefined;
}

function resolveDashScopeEndpoint(model: DashScopeImagesModel): string {
	const connection = modelConnection(model);
	const region = dashScopeRegion(connection.region);
	const isInternational = region === "ap-southeast-1";
	const fallback = isInternational ? DASHSCOPE_IMAGE_INTL_BASE_URL : DASHSCOPE_IMAGE_BASE_URL;
	let configured = (asString(connection.endpoint) ?? asString(model.baseUrl))?.replace(/\/+$/, "");
	const workspaceId = asString(connection.workspaceId);
	if (workspaceId && usesWorkspaceEndpoint(model)) {
		return `https://${workspaceId}.${region}.maas.aliyuncs.com${DASHSCOPE_IMAGE_PATH}`;
	}
	if (configured && isDashScopeDefaultHost(configured)) {
		configured = configured.replace(/^https:\/\/dashscope(?:-intl)?\.aliyuncs\.com/, fallback);
	}
	if (configured?.endsWith(DASHSCOPE_IMAGE_PATH)) return configured;
	if (configured?.endsWith("/api/v1")) return `${configured}${DASHSCOPE_IMAGE_PATH.slice("/api/v1".length)}`;
	return appendEndpoint(configured, DASHSCOPE_IMAGE_PATH, fallback);
}

function isDashScopeDefaultHost(value: string): boolean {
	return /^https:\/\/dashscope(?:-intl)?\.aliyuncs\.com(?:\/|$)/.test(value);
}

function usesWorkspaceEndpoint(model: DashScopeImagesModel): boolean {
	const connection = modelConnection(model);
	if (asString(connection.endpoint)) return false;
	return isDashScopeDefaultHost(model.baseUrl);
}

function dashScopeRegion(value: unknown): "cn-beijing" | "ap-southeast-1" {
	const region = String(value ?? "").toLowerCase();
	return ["intl", "international", "singapore", "sg", "ap-southeast-1"].includes(region)
		? "ap-southeast-1"
		: "cn-beijing";
}

interface ImageValue {
	kind: "base64" | "url";
	value: string;
	mimeType?: string;
}

function collectImageValues(body: unknown): ImageValue[] {
	if (!isRecord(body)) return [];
	const values: ImageValue[] = [];
	const output = isRecord(body.output) ? body.output : undefined;
	const data = Array.isArray(body.data) ? body.data : [];
	const choices = output && Array.isArray(output.choices) ? output.choices : [];

	for (const entry of data) collectImageEntry(entry, values);
	if (output) {
		for (const choice of choices) {
			if (!isRecord(choice) || !isRecord(choice.message) || !Array.isArray(choice.message.content)) continue;
			for (const part of choice.message.content) {
				if (isRecord(part)) {
					collectImageField(part.image, values);
					collectImageField(part.image_url, values);
					collectImageField(part.url, values);
					collectImageField(part.b64_json, values, "image/png", true);
				}
			}
		}
		if (Array.isArray(output.results)) for (const entry of output.results) collectImageEntry(entry, values);
		collectImageField(output.image_url, values);
		collectImageField(output.image, values);
		collectImageField(output.b64_json, values, "image/png", true);
	}
	return values;
}

function collectImageEntry(entry: unknown, values: ImageValue[]): void {
	if (!isRecord(entry)) return;
	collectImageField(entry.b64_json, values, mimeTypeForEntry(entry), true);
	collectImageField(entry.url, values);
	collectImageField(entry.image_url, values);
	collectImageField(entry.image, values);
}

function collectImageField(value: unknown, values: ImageValue[], mimeType?: string, isBase64 = false): void {
	if (typeof value !== "string" || value.length === 0) return;
	if (isBase64 || (!value.startsWith("http://") && !value.startsWith("https://") && !value.startsWith("data:"))) {
		const inline = value.startsWith("data:") ? undefined : value;
		values.push({ kind: "base64", value: inline ?? value, mimeType: inline ? undefined : mimeType });
		return;
	}
	if (value.startsWith("data:")) {
		const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s);
		if (match) values.push({ kind: "base64", value: match[2], mimeType: match[1] });
		return;
	}
	values.push({ kind: "url", value });
}

function mimeTypeForEntry(entry: Record<string, unknown>): string | undefined {
	const value = asString(entry.mime_type) ?? asString(entry.mimeType) ?? asString(entry.format);
	if (!value) return undefined;
	return value.includes("/") ? value : `image/${value}`;
}

function findResponseId(body: unknown): string | undefined {
	if (!isRecord(body)) return undefined;
	const output = isRecord(body.output) ? body.output : undefined;
	return asString(body.request_id) ?? asString(body.id) ?? asString(output?.request_id) ?? asString(output?.task_id);
}
