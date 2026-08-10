import type { ImagesProvider, Provider } from "./ai";

export function openAICompletionsApi(): unknown;
export function openAIResponsesApi(): unknown;
export function anthropicMessagesApi(): unknown;
export function azureOpenAIResponsesApi(): unknown;
export function bedrockConverseStreamApi(): unknown;
export function googleGenerativeAIApi(): unknown;
export function googleVertexApi(): unknown;
export function mistralConversationsApi(): unknown;
export function openAICodexResponsesApi(): unknown;
export function openrouterImagesApi(): unknown;
export function openaiImagesApi(): unknown;
export function googleInteractionsImagesApi(): unknown;
export function dashscopeImagesApi(): unknown;
export function volcengineImagesApi(): unknown;
export function builtinProviders(): Provider[];
export function builtinImagesProviders(): ImagesProvider[];

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

export function getBuiltinProviderCatalog(): BuiltinProviderCatalogEntry[];
