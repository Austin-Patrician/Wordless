import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { PROVIDER_AVATARS } from "@wordless/domain";

const HeaderSchema = Type.Record(Type.String(), Type.String());
const JsonObjectSchema = Type.Record(Type.String(), Type.Unknown());
const ModelInputSchema = Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]));
const ImageModelCapabilitiesSchema = Type.Object({
  supportsMaskEditing: Type.Optional(Type.Boolean()),
  supportsTransparentBackground: Type.Optional(Type.Boolean()),
});
const ProviderAvatarIdSchema = Type.Union(PROVIDER_AVATARS.map((avatar) => Type.Literal(avatar.id)));

export const ChatModelDefinitionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String({ minLength: 1 })),
  api: Type.Optional(Type.String({ minLength: 1 })),
  baseUrl: Type.Optional(Type.String({ minLength: 1 })),
  reasoning: Type.Optional(Type.Boolean()),
  input: Type.Optional(ModelInputSchema),
  contextWindow: Type.Optional(Type.Number({ minimum: 1 })),
  maxTokens: Type.Optional(Type.Number({ minimum: 1 })),
  headers: Type.Optional(HeaderSchema),
  compat: Type.Optional(JsonObjectSchema),
});

export const ChatModelOverrideSchema = Type.Partial(Type.Omit(ChatModelDefinitionSchema, ["id", "api", "baseUrl"]));

export const ImageModelDefinitionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String({ minLength: 1 })),
  api: Type.Optional(Type.String({ minLength: 1 })),
  baseUrl: Type.Optional(Type.String({ minLength: 1 })),
  input: Type.Optional(ModelInputSchema),
  output: Type.Optional(ModelInputSchema),
  headers: Type.Optional(HeaderSchema),
  capabilities: Type.Optional(ImageModelCapabilitiesSchema),
});

export const ProviderConfigurationSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  avatarId: Type.Optional(ProviderAvatarIdSchema),
  baseUrl: Type.Optional(Type.String({ minLength: 1 })),
  apiKey: Type.Optional(Type.String({ minLength: 1 })),
  api: Type.Optional(Type.String({ minLength: 1 })),
  headers: Type.Optional(HeaderSchema),
  authHeader: Type.Optional(Type.Boolean()),
  compat: Type.Optional(JsonObjectSchema),
  models: Type.Optional(Type.Array(ChatModelDefinitionSchema)),
  modelOverrides: Type.Optional(Type.Record(Type.String(), ChatModelOverrideSchema)),
});

export const ImageProviderConfigurationSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  avatarId: Type.Optional(ProviderAvatarIdSchema),
  baseUrl: Type.Optional(Type.String({ minLength: 1 })),
  apiKey: Type.Optional(Type.String({ minLength: 1 })),
  api: Type.Optional(Type.String({ minLength: 1 })),
  headers: Type.Optional(HeaderSchema),
  authHeader: Type.Optional(Type.Boolean()),
  models: Type.Optional(Type.Array(ImageModelDefinitionSchema)),
});

export const ModelsConfigurationSchema = Type.Object({
  version: Type.Literal(1),
  providers: Type.Record(Type.String({ minLength: 1 }), ProviderConfigurationSchema),
  imageProviders: Type.Optional(Type.Record(Type.String({ minLength: 1 }), ImageProviderConfigurationSchema)),
});

export const ModelSettingsSchema = Type.Object({
  version: Type.Literal(1),
  enabledChatModels: Type.Array(Type.String({ minLength: 3 })),
  enabledImageModels: Type.Array(Type.String({ minLength: 3 })),
});

export type ChatModelDefinition = Static<typeof ChatModelDefinitionSchema>;
export type ChatModelOverride = Static<typeof ChatModelOverrideSchema>;
export type ImageModelDefinition = Static<typeof ImageModelDefinitionSchema>;
export type ProviderConfiguration = Static<typeof ProviderConfigurationSchema>;
export type ImageProviderConfiguration = Static<typeof ImageProviderConfigurationSchema>;
export type ModelsConfiguration = Static<typeof ModelsConfigurationSchema>;
export type ModelSettings = Static<typeof ModelSettingsSchema>;

export const DEFAULT_MODELS_CONFIGURATION: ModelsConfiguration = { version: 1, providers: {}, imageProviders: {} };
export const DEFAULT_MODEL_SETTINGS: ModelSettings = { version: 1, enabledChatModels: [], enabledImageModels: [] };

export function parseModelsConfiguration(value: unknown): ModelsConfiguration {
  if (!Value.Check(ModelsConfigurationSchema, value)) throw new Error(formatSchemaErrors(ModelsConfigurationSchema, value));
  return value;
}

export function parseModelSettings(value: unknown): ModelSettings {
  if (!Value.Check(ModelSettingsSchema, value)) throw new Error(formatSchemaErrors(ModelSettingsSchema, value));
  return value;
}

export function modelReferenceKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

function formatSchemaErrors(schema: typeof ModelsConfigurationSchema | typeof ModelSettingsSchema, value: unknown): string {
  const errors = [...Value.Errors(schema, value)].map((error) => `${error.instancePath || "root"}: ${error.message}`);
  return `Invalid model configuration: ${errors.join("; ")}`;
}
