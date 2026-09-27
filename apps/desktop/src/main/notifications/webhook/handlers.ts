import { type TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  WebhookCreateInputSchema,
  WebhookIdRequestSchema,
  WebhookSetEnabledRequestSchema,
  WebhookTestRequestSchema,
  WebhookUpdateRequestSchema,
  type WebhookCreateInputDto,
  type WebhookEndpointPublic,
  type WebhookIdRequestDto,
  type WebhookMutationResult,
  type WebhookProviderDescriptor,
  type WebhookSendResult,
  type WebhookSetEnabledRequestDto,
  type WebhookTestRequestDto,
  type WebhookUpdateRequestDto,
} from "@wordless/protocol";
import type { WebhookManager } from "./manager.ts";

/**
 * The message-push IPC surface, with no Electron in it.
 *
 * Kept separate from `register-notification-ipc.ts` so the boundary is testable:
 * the payload shapes are the contract between the preload and the host, and a
 * mismatch there cannot be caught by a unit test on the manager (which is called
 * directly) or by a renderer test (which mocks the client). That is exactly how a
 * schema that rejected its own caller's payload shipped unnoticed.
 *
 * Two kinds of rejection, deliberately separated:
 *
 *  - A payload that fails its schema throws. That is a caller bug — an unknown
 *    field, a missing id — and it should be loud rather than normalised away into
 *    a setting that silently never applies.
 *  - A payload that is well-formed but wrong for the platform returns a typed
 *    failure. That is a user typing an address, and the page needs the code to say
 *    which field is wrong and why.
 */
export interface NotificationHandlers {
  list(): Promise<WebhookEndpointPublic[]>;
  providers(): Promise<WebhookProviderDescriptor[]>;
  create(payload: unknown): Promise<WebhookMutationResult>;
  update(payload: unknown): Promise<WebhookMutationResult>;
  setEnabled(payload: unknown): Promise<WebhookMutationResult>;
  delete(payload: unknown): Promise<void>;
  test(payload: unknown): Promise<WebhookSendResult>;
}

function assertPayload(schema: TSchema, payload: unknown): void {
  if (!Value.Check(schema, payload)) throw new Error("Invalid request payload");
}

export function createNotificationHandlers(manager: WebhookManager): NotificationHandlers {
  return {
    list: async () => manager.list(),

    providers: async () => manager.listProviderDescriptors(),

    create: async (payload) => {
      assertPayload(WebhookCreateInputSchema, payload);
      return await manager.create(payload as WebhookCreateInputDto);
    },

    update: async (payload) => {
      assertPayload(WebhookUpdateRequestSchema, payload);
      const { id, patch } = payload as WebhookUpdateRequestDto;
      return await manager.update(id, patch);
    },

    setEnabled: async (payload) => {
      assertPayload(WebhookSetEnabledRequestSchema, payload);
      const { id, enabled } = payload as WebhookSetEnabledRequestDto;
      return await manager.setEnabled(id, enabled);
    },

    delete: async (payload) => {
      assertPayload(WebhookIdRequestSchema, payload);
      await manager.delete((payload as WebhookIdRequestDto).id);
    },

    test: async (payload) => {
      assertPayload(WebhookTestRequestSchema, payload);
      const { id, message } = payload as WebhookTestRequestDto;
      // The message text comes from the renderer so this side needs no copy table:
      // the host also runs scheduled work with no window, where a locale-dependent
      // string table would be one more thing to keep in sync.
      return await manager.send(id, message);
    },
  };
}
