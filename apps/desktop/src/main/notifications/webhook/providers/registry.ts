import type { WebhookKind, WebhookProviderDescriptor } from "@wordless/protocol";
import { dingtalkProvider } from "./dingtalk.ts";
import { feishuProvider } from "./feishu.ts";
import { wecomProvider } from "./wecom.ts";
import type { WebhookProvider } from "../types.ts";

/**
 * The channel registry.
 *
 * Adding a channel — WeCom, a generic URL poster, whatever comes next — is a
 * provider file plus one line here. The manager, IPC surface, storage and the
 * settings list logic stay untouched.
 *
 * All three channels `WebhookKind` names are now registered. Adding the two new ones
 * touched nothing outside this file and the providers' own files — no shared type, no
 * IPC, no settings UI — which is the property this registry exists to buy.
 */
const PROVIDERS: Partial<Record<WebhookKind, WebhookProvider>> = {
  feishu: feishuProvider,
  dingtalk: dingtalkProvider,
  wecom: wecomProvider,
};

export function getProvider(kind: WebhookKind): WebhookProvider {
  const provider = PROVIDERS[kind];
  if (!provider) throw new Error(`unsupported webhook kind: ${kind}`);
  return provider;
}

/** Lets storage drop rows for channels this build cannot send through. */
export function isSupportedKind(kind: string): kind is WebhookKind {
  return Object.hasOwn(PROVIDERS, kind);
}

/** Feeds the settings form, which renders fields from this and never branches on kind. */
export function listProviderDescriptors(): WebhookProviderDescriptor[] {
  const descriptors: WebhookProviderDescriptor[] = [];
  for (const provider of Object.values(PROVIDERS)) {
    if (!provider) continue;
    descriptors.push({
      kind: provider.kind,
      ...(provider.iconClass ? { iconClass: provider.iconClass } : {}),
      credentialFields: provider.credentialFields,
      capabilities: provider.capabilities,
    });
  }
  return descriptors;
}
