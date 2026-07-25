import type { ImagesProvider, Provider, ProviderImages, ProviderStreams } from "@wordless/ai";

export interface ProviderExtensionApi {
  registerChatProvider(provider: Provider): void;
  registerImageProvider(provider: ImagesProvider): void;
  registerChatProtocol(api: string, streams: ProviderStreams): void;
  registerImageProtocol(api: string, images: ProviderImages): void;
}

export interface ProviderExtension {
  activate(api: ProviderExtensionApi): void | Promise<void>;
}

export type ProviderExtensionFactory = (api: ProviderExtensionApi) => void | Promise<void>;
