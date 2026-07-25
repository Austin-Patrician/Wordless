import { MODELS } from "./models.generated.ts";
import type { Api, Model } from "./types.ts";

export interface BuiltinCatalogModel {
	id: string;
	name: string;
	input: readonly ("text" | "image")[];
	reasoning: boolean;
	contextWindow: number;
	maxOutputTokens: number;
}

export interface BuiltinProviderCatalogEntry {
	id: string;
	name: string;
	baseUrl: string | null;
	models: BuiltinCatalogModel[];
}

function displayName(providerId: string): string {
	return providerId
		.split("-")
		.map((segment) => (segment.length <= 3 ? segment.toUpperCase() : `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`))
		.join(" ");
}

function toCatalogModel(model: Model<Api>): BuiltinCatalogModel {
	return {
		id: model.id,
		name: model.name,
		input: model.input,
		reasoning: model.reasoning,
		contextWindow: model.contextWindow,
		maxOutputTokens: model.maxTokens,
	};
}

/**
 * Read-only catalog derived from the generated built-in model registry.
 * It intentionally does not construct provider clients, so it is safe for UI previews.
 */
export function getBuiltinProviderCatalog(): BuiltinProviderCatalogEntry[] {
	return (Object.entries(MODELS) as Array<[string, Record<string, Model<Api>>]>).map(([id, models]) => {
		const modelList = Object.values(models);
		return {
			id,
			name: displayName(id),
			baseUrl: modelList[0]?.baseUrl ?? null,
			models: modelList.map(toCatalogModel),
		};
	});
}
