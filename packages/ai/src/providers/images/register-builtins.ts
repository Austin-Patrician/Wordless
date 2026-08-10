import type { generateImages as generateImagesOpenRouterFunction } from "../../api/openrouter-images.ts";
import type { generateImages as generateImagesOpenAIFunction } from "../../api/openai-images.ts";
import type { generateImages as generateImagesGoogleFunction } from "../../api/google-interactions-images.ts";
import type { generateImages as generateImagesDashScopeFunction } from "../../api/dashscope-images.ts";
import type { generateImages as generateImagesVolcengineFunction } from "../../api/volcengine-images.ts";
import { registerImagesApiProvider } from "../../images-api-registry.ts";
import type { AssistantImages, ImagesApi, ImagesContext, ImagesFunction, ImagesModel, ImagesOptions } from "../../types.ts";

interface OpenRouterImagesProviderModule {
	generateImages: typeof generateImagesOpenRouterFunction;
}

interface OpenAIImagesProviderModule {
	generateImages: typeof generateImagesOpenAIFunction;
}

interface GoogleImagesProviderModule {
	generateImages: typeof generateImagesGoogleFunction;
}

interface DashScopeImagesProviderModule {
	generateImages: typeof generateImagesDashScopeFunction;
}

interface VolcengineImagesProviderModule {
	generateImages: typeof generateImagesVolcengineFunction;
}

let openRouterImagesProviderModulePromise: Promise<OpenRouterImagesProviderModule> | undefined;
let openAIImagesProviderModulePromise: Promise<OpenAIImagesProviderModule> | undefined;
let googleImagesProviderModulePromise: Promise<GoogleImagesProviderModule> | undefined;
let dashScopeImagesProviderModulePromise: Promise<DashScopeImagesProviderModule> | undefined;
let volcengineImagesProviderModulePromise: Promise<VolcengineImagesProviderModule> | undefined;

function createLazyLoadErrorImages(model: ImagesModel<ImagesApi>, error: unknown): AssistantImages {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function loadOpenRouterImagesProviderModule(): Promise<OpenRouterImagesProviderModule> {
	openRouterImagesProviderModulePromise ||= import("../../api/openrouter-images.ts").then(
		(module) => module as OpenRouterImagesProviderModule,
	);
	return openRouterImagesProviderModulePromise;
}

function loadOpenAIImagesProviderModule(): Promise<OpenAIImagesProviderModule> {
	openAIImagesProviderModulePromise ||= import("../../api/openai-images.ts").then((module) => module as OpenAIImagesProviderModule);
	return openAIImagesProviderModulePromise;
}

function loadGoogleImagesProviderModule(): Promise<GoogleImagesProviderModule> {
	googleImagesProviderModulePromise ||= import("../../api/google-interactions-images.ts").then((module) => module as GoogleImagesProviderModule);
	return googleImagesProviderModulePromise;
}

function loadDashScopeImagesProviderModule(): Promise<DashScopeImagesProviderModule> {
	dashScopeImagesProviderModulePromise ||= import("../../api/dashscope-images.ts").then((module) => module as DashScopeImagesProviderModule);
	return dashScopeImagesProviderModulePromise;
}

function loadVolcengineImagesProviderModule(): Promise<VolcengineImagesProviderModule> {
	volcengineImagesProviderModulePromise ||= import("../../api/volcengine-images.ts").then((module) => module as VolcengineImagesProviderModule);
	return volcengineImagesProviderModulePromise;
}

export const generateImagesOpenRouter: ImagesFunction<"openrouter-images", ImagesOptions> = async (
	model: ImagesModel<"openrouter-images">,
	context: ImagesContext,
	options?: ImagesOptions,
) => {
	try {
		const module = await loadOpenRouterImagesProviderModule();
		return await module.generateImages(model, context, options);
	} catch (error) {
		return createLazyLoadErrorImages(model, error);
	}
};

export const generateImagesOpenAI: ImagesFunction<"openai-images", ImagesOptions> = async (model, context, options) => {
	try {
		return await (await loadOpenAIImagesProviderModule()).generateImages(model, context, options);
	} catch (error) {
		return createLazyLoadErrorImages(model, error);
	}
};

export const generateImagesGoogle: ImagesFunction<"google-interactions-images", ImagesOptions> = async (model, context, options) => {
	try {
		return await (await loadGoogleImagesProviderModule()).generateImages(model, context, options);
	} catch (error) {
		return createLazyLoadErrorImages(model, error);
	}
};

export const generateImagesDashScope: ImagesFunction<"dashscope-images", ImagesOptions> = async (model, context, options) => {
	try {
		return await (await loadDashScopeImagesProviderModule()).generateImages(model, context, options);
	} catch (error) {
		return createLazyLoadErrorImages(model, error);
	}
};

export const generateImagesVolcengine: ImagesFunction<"volcengine-images", ImagesOptions> = async (model, context, options) => {
	try {
		return await (await loadVolcengineImagesProviderModule()).generateImages(model, context, options);
	} catch (error) {
		return createLazyLoadErrorImages(model, error);
	}
};

export function registerBuiltInImagesApiProviders(): void {
	registerImagesApiProvider({
		api: "openrouter-images",
		generateImages: generateImagesOpenRouter,
	});
	registerImagesApiProvider({ api: "openai-images", generateImages: generateImagesOpenAI });
	registerImagesApiProvider({ api: "google-interactions-images", generateImages: generateImagesGoogle });
	registerImagesApiProvider({ api: "dashscope-images", generateImages: generateImagesDashScope });
	registerImagesApiProvider({ api: "volcengine-images", generateImages: generateImagesVolcengine });
}

registerBuiltInImagesApiProviders();
