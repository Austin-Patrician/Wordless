import { ipcMain } from "electron";
import type { WebhookManager } from "../notifications/webhook/manager.ts";
import { createNotificationHandlers } from "../notifications/webhook/handlers.ts";
import { Value } from "typebox/value";
import {
  NotificationDefaultsPatchSchema,
  type NotificationDefaults,
  type NotificationDefaultsResult,
} from "@wordless/protocol";
import { validateTemplate } from "../notifications/template.ts";

/**
 * Wires the message-push channels to their handlers.
 *
 * Deliberately thin: every payload check and every call lives in
 * `notifications/webhook/handlers.ts`, which has no Electron import and is covered
 * by `test/notification-handlers.test.ts`. Keeping the logic there is what makes
 * the preload↔host contract testable at all — the renderer tests mock the client
 * and the manager tests call it directly, so neither can see a shape mismatch on
 * this boundary.
 */
export interface NotificationIpcDeps {
  manager: WebhookManager;
}

export function registerNotificationIpc(deps: NotificationIpcDeps): void {
  const handlers = createNotificationHandlers(deps.manager);

  ipcMain.handle("wordless:notifications:list", async () => await handlers.list());
  ipcMain.handle("wordless:notifications:providers", async () => await handlers.providers());
  ipcMain.handle("wordless:notifications:create", async (_event, payload: unknown) => await handlers.create(payload));
  ipcMain.handle("wordless:notifications:update", async (_event, payload: unknown) => await handlers.update(payload));
  ipcMain.handle("wordless:notifications:set-enabled", async (_event, payload: unknown) => await handlers.setEnabled(payload));
  ipcMain.handle("wordless:notifications:delete", async (_event, payload: unknown) => await handlers.delete(payload));
  ipcMain.handle("wordless:notifications:test", async (_event, payload: unknown) => await handlers.test(payload));
}

/**
 * The global subscription: which channels an untouched automation pushes to.
 *
 * Separate from the endpoint CRUD because it is a different question — that one is
 * "what can this machine send through", this one is "what should happen by
 * default". A task can still override any field.
 */
export interface NotificationDefaultsIpcDeps {
  /** The global subscription — what an automation nobody configured inherits. */
  readDefaults: () => Promise<NotificationDefaults>;
  saveDefaults: (defaults: NotificationDefaults) => Promise<void>;
  /** Payload checks throw on a caller bug, exactly as the webhook channels do. */
}

export function registerNotificationDefaultsIpc(deps: NotificationDefaultsIpcDeps): void {
  ipcMain.handle("wordless:notifications:defaults", async (): Promise<NotificationDefaults> => await deps.readDefaults());

  ipcMain.handle(
    "wordless:notifications:set-defaults",
    async (_event, payload: unknown): Promise<NotificationDefaultsResult> => {
      if (!Value.Check(NotificationDefaultsPatchSchema, payload)) throw new Error("Invalid request payload");
      const patch = payload as Partial<NotificationDefaults>;
      const current = await deps.readDefaults();
      const next: NotificationDefaults = {
        enabled: patch.enabled ?? current.enabled,
        endpointIds: patch.endpointIds ?? current.endpointIds,
        when: patch.when ?? current.when,
      };
      // An empty template means "go back to the built-in one" rather than an empty
      // message, matching how an empty secret clears a credential.
      const template = patch.template === undefined ? current.template : patch.template.trim() || undefined;
      if (template !== undefined) {
        // Refused here rather than at send time: a typo left in a template reaches a
        // group chat, and everyone reads it.
        const invalid = validateTemplate(template);
        if (invalid) return { ok: false, code: invalid };
        next.template = template;
      }
      await deps.saveDefaults(next);
      return { ok: true, defaults: next };
    },
  );
}
