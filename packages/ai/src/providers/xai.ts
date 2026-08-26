import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { XAI_MODELS } from "./xai.models.ts";

export function xaiProvider(): Provider<"openai-responses"> {
	return createProvider<"openai-responses">({
		id: "xai",
		name: "xAI",
		baseUrl: "https://api.x.ai/v1",
		auth: { apiKey: envApiKeyAuth("xAI API key", ["XAI_API_KEY"]) },
		models: Object.values(XAI_MODELS),
		api: openAIResponsesApi(),
	});
}
