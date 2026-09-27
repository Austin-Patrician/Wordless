import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The message-push settings page.
 *
 * The page is thin, but three things about it are easy to break and expensive to
 * notice: it must mount at all when the endpoint list is empty, it must never
 * render a credential (it only ever has a mask), and editing an existing channel
 * must leave the address and key fields *empty* rather than showing something the
 * user could mistake for the stored value.
 */

const mocks = vi.hoisted(() => ({
  endpoints: [] as Array<Record<string, unknown>>,
  listWebhookEndpoints: vi.fn(),
  listWebhookProviders: vi.fn(),
  createWebhookEndpoint: vi.fn(),
  getNotificationDefaults: vi.fn(),
  setNotificationDefaults: vi.fn(),
  updateWebhookEndpoint: vi.fn(),
  setWebhookEndpointEnabled: vi.fn(),
  deleteWebhookEndpoint: vi.fn(),
  testWebhookEndpoint: vi.fn(),
}));

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntimeClient: () => mocks,
}));

// The real table would turn every assertion into a translation test; keys are
// what the component is responsible for.
// Keys are what the component is responsible for, but the two messages that take
// a parameter keep their placeholder — otherwise the component's `replace` has
// nothing to substitute and the assertion would pass for the wrong reason.
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    t: (key: string): string => (key === "webhookTestFailed" ? "webhookTestFailed {reason}" : key),
  }),
}));

import { NotificationsSettings } from "../src/renderer/features/settings/NotificationsSettings";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROVIDER = {
  kind: "feishu",
  credentialFields: [
    { key: "url", required: true, urlHint: "https://open.feishu.cn/open-apis/bot/v2/hook/", secret: true },
    { key: "signSecret", required: false, secret: true },
  ],
  capabilities: {
    supportsSign: true,
    supportsImage: false,
    supportsFile: false,
    supportsMentionAll: true,
    supportsMentionByMobile: false,
    maxTextBytes: 12_000,
    maxTitleBytes: 512,
    maxMessagesPerMinute: 100,
    supportsMarkdown: true,
  },
};

const DINGTALK: typeof PROVIDER = {
  kind: "dingtalk",
  credentialFields: [
    { key: "url", required: true, urlHint: "https://oapi.dingtalk.com/robot/send?access_token=", secret: true },
    { key: "signSecret", required: false, secret: true },
  ],
  capabilities: {
    supportsSign: true,
    supportsImage: false,
    supportsFile: false,
    supportsMentionAll: true,
    // The flag the @手机号 field is gated on; Feishu does not have it.
    supportsMentionByMobile: true,
    maxTextBytes: 11_500,
    maxTextChars: 3_800,
    maxTitleBytes: 512,
    maxMessagesPerMinute: 20,
    supportsMarkdown: true,
  },
};

const WECOM: typeof PROVIDER = {
  kind: "wecom",
  credentialFields: [
    { key: "url", required: true, urlHint: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=", secret: true },
  ],
  capabilities: {
    supportsSign: false,
    supportsImage: false,
    supportsFile: false,
    supportsMentionAll: false,
    supportsMentionByMobile: false,
    maxTextBytes: 3_800,
    maxTitleBytes: 512,
    maxMessagesPerMinute: 20,
    supportsMarkdown: true,
  },
};

const PROVIDERS = [PROVIDER, DINGTALK, WECOM];

const ENDPOINT = {
  id: "e1",
  kind: "feishu",
  name: "Release group",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  urlMask: "https://open.feishu.cn/…1c2d",
  hasSignSecret: true,
  options: {},
};

/** Buttons anywhere in the document, which covers the page and any open dialog. */
function queryButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => (candidate.textContent ?? "").trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`no button labelled ${label}`);
  return button as HTMLButtonElement;
}

/**
 * The editor's dialog.
 *
 * Radix portals dialog content to `document.body`, so it is deliberately *not* inside
 * the container the page renders into — a query scoped to the container would miss
 * the whole form and silently pass. Scoped searches also matter here because the
 * page has its own save button (the default-push block) with the same label.
 */
function dialog(): HTMLElement {
  const element = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1);
  if (!element) throw new Error("no dialog is open");
  return element;
}

function dialogButton(label: string): HTMLButtonElement {
  const button = Array.from(dialog().querySelectorAll("button")).find(
    (candidate) => (candidate.textContent ?? "").trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`no dialog button labelled ${label}`);
  return button as HTMLButtonElement;
}

/**
 * Switches the channel in the editor's type dropdown.
 *
 * Radix Select is driven through the same pointer sequence a real click produces, and
 * its items are portalled, so they are searched in the whole document.
 */
async function selectKind(label: string): Promise<void> {
  const trigger = dialog().querySelector<HTMLButtonElement>("#webhook-kind");
  if (!trigger) throw new Error("no kind select");
  await press(trigger);
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (candidate) => (candidate.textContent ?? "").trim() === label,
  );
  if (!option) throw new Error(`no kind option labelled ${label}`);
  await press(option);
}

/**
 * Types into a React-controlled input.
 *
 * Assigning `.value` directly is silently ignored: React tracks the previous value
 * on the node and treats an unchanged-looking assignment as no event at all. Going
 * through the prototype's setter bypasses that tracker.
 */
async function typeInto(field: HTMLInputElement | HTMLTextAreaElement | null, value: string): Promise<void> {
  if (!field) throw new Error("field not found");
  // The setter has to come from the element's own prototype: calling the input one
  // on a textarea throws "Illegal invocation".
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true }));
    target.click();
  });
}

describe("message push settings page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.endpoints = [];
    mocks.listWebhookEndpoints.mockReset().mockImplementation(async () => mocks.endpoints);
    mocks.listWebhookProviders.mockReset().mockResolvedValue(PROVIDERS);
    mocks.createWebhookEndpoint.mockReset().mockResolvedValue({ ok: false, code: "url-wrong-host" });
    mocks.getNotificationDefaults.mockReset().mockResolvedValue({ enabled: true, endpointIds: [], when: "always" });
    mocks.setNotificationDefaults.mockReset().mockImplementation(async (patch: Record<string, unknown>) => ({
      ok: true,
      defaults: { enabled: true, endpointIds: [], when: "always", ...patch },
    }));
    mocks.updateWebhookEndpoint.mockReset().mockResolvedValue({ ok: true, endpoint: ENDPOINT });
    mocks.setWebhookEndpointEnabled.mockReset().mockResolvedValue({ ok: true, endpoint: ENDPOINT });
    mocks.deleteWebhookEndpoint.mockReset().mockResolvedValue(undefined);
    mocks.testWebhookEndpoint.mockReset().mockResolvedValue({ ok: true });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(<NotificationsSettings />);
    });
  }

  it("renders the options the channel declares, and only those", async () => {
    await render();
    await press(queryButton("webhookAdd"));

    // Feishu: the mention switch, and none of DingTalk's options.
    expect(dialog().textContent).toContain("webhookSectionOptions");
    expect(dialog().textContent).toContain("webhookOptionMentionAll");
    expect(dialog().textContent).not.toContain("webhookOptionKeyword");
    expect(dialog().textContent).not.toContain("webhookOptionAtMobiles");

    await selectKind("webhookProviderDingtalk");
    expect(dialog().textContent).toContain("webhookOptionKeyword");
    expect(dialog().textContent).toContain("webhookOptionAtMobiles");
    expect(dialog().textContent).toContain("webhookOptionMentionAll");

    // WeCom has exactly one option — its message format — and none of the others.
    await selectKind("webhookProviderWecom");
    expect(dialog().textContent).toContain("webhookSectionOptions");
    expect(dialog().textContent).toContain("webhookOptionUseMarkdownV2");
    expect(dialog().textContent).not.toContain("webhookOptionKeyword");
    expect(dialog().textContent).not.toContain("webhookOptionAtMobiles");
    expect(dialog().textContent).not.toContain("webhookOptionMentionAll");
  });

  it("switching the channel drops the previous channel's options", async () => {
    let payload: Record<string, unknown> | null = null;
    mocks.createWebhookEndpoint.mockImplementation(async (input: Record<string, unknown>) => {
      payload = input;
      return { ok: true, endpoint: ENDPOINT };
    });

    await render();
    await press(queryButton("webhookAdd"));
    await selectKind("webhookProviderDingtalk");
    await typeInto(dialog().querySelector<HTMLInputElement>("#webhook-option-keyword"), "报警");

    // Back to Feishu, which does not allow `keyword` at all. Options are per channel
    // and mean different things, so they are cleared instead of carried across —
    // otherwise the save would fail with an error the user could not connect to the
    // dropdown they just touched.
    await selectKind("webhookProviderFeishu");
    await typeInto(dialog().querySelector<HTMLInputElement>("#webhook-name"), "Group");
    await typeInto(
      dialog().querySelector<HTMLInputElement>("#webhook-url"),
      "https://open.feishu.cn/open-apis/bot/v2/hook/6a3f1c2d",
    );
    await press(dialogButton("webhookSave"));

    expect(payload?.options).toEqual({});
  });

  it("keeps the separator while a mobile list is being typed", async () => {
    await render();
    await press(queryButton("webhookAdd"));
    await selectKind("webhookProviderDingtalk");

    const field = dialog().querySelector<HTMLInputElement>("#webhook-option-atMobiles");
    await typeInto(field, "13800000000, ");

    // Re-deriving the box from the parsed list would swallow the comma the moment it
    // was typed, and the second number could then never be entered.
    expect(field?.value).toBe("13800000000, ");
  });

  it("mounts with the empty state and offers to add a channel", async () => {
    await render();
    expect(container.textContent).toContain("webhookEmpty");
    expect(container.textContent).toContain("webhookEmptyHelp");
    expect(queryButton("webhookAdd").disabled).toBe(false);
    // The security note about the address being a credential is always shown.
    expect(container.textContent).toContain("webhookSecurityNote");
  });

  it("lists a channel with its mask and never with a credential", async () => {
    mocks.endpoints = [ENDPOINT];
    await render();
    expect(container.textContent).toContain("Release group");
    // The row shows the mask; this is the list, so the dialog is closed.
    expect(container.textContent).toContain("https://open.feishu.cn/…1c2d");
    expect(container.textContent).toContain("webhookSignSecretSet");
    // The two fields are inputs, so a raw URL would only appear as a value.
    for (const input of Array.from(container.querySelectorAll("input"))) {
      expect((input as HTMLInputElement).value).toBe("");
    }
  });

  it("edits in a dialog rather than in the list", async () => {
    mocks.endpoints = [ENDPOINT];
    await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await press(queryButton("webhookEdit"));

    // The form is a modal, portalled out of the page: the list stays where it was
    // instead of shifting down under the row the user just clicked.
    expect(dialog()).not.toBeNull();
    expect(container.textContent).toContain("Release group");
    expect(container.contains(dialog())).toBe(false);

    await press(dialogButton("webhookCancel"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes the editor on Escape", async () => {
    mocks.endpoints = [ENDPOINT];
    await render();
    await press(queryButton("webhookEdit"));
    expect(dialog()).not.toBeNull();

    // The standard dismissal affordance for a modal; Radix routes Escape to the
    // topmost layer, which is what makes the nesting safe.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("leaves the address and key fields empty when editing", async () => {
    mocks.endpoints = [ENDPOINT];
    await render();
    await press(queryButton("webhookEdit"));

    expect(dialog().textContent).toContain("webhookDialogEdit");
    const url = dialog().querySelector<HTMLInputElement>("#webhook-url");
    const secret = dialog().querySelector<HTMLInputElement>("#webhook-sign-secret");
    expect(url?.value).toBe("");
    expect(secret?.value).toBe("");
    // The mask stands in for the stored value, with the keep-hint as placeholder.
    expect(dialog().textContent).toContain("https://open.feishu.cn/…1c2d");
    expect(url?.placeholder).toBe("webhookFieldUrlStored");
  });

  it("offers the everyone-mention switch only when the channel supports it", async () => {
    await render();
    await press(queryButton("webhookAdd"));
    // Feishu declares supportsMentionAll, so the switch is there.
    expect(dialog().querySelector('[aria-label="webhookOptionMentionAll"]')).not.toBeNull();
    expect(dialog().textContent).toContain("webhookOptionMentionAllHelp");

    // A channel that does not support it must not be offered it — the page
    // branches on the capability, never on the kind.
    act(() => root.unmount());
    root = createRoot(container);
    mocks.listWebhookProviders.mockResolvedValue([
      { ...PROVIDER, capabilities: { ...PROVIDER.capabilities, supportsMentionAll: false } },
    ]);
    await render();
    await press(queryButton("webhookAdd"));
    expect(dialog().querySelector('[aria-label="webhookOptionMentionAll"]')).toBeNull();
  });

  it("carries the everyone-mention choice into the save payload", async () => {
    await render();
    await press(queryButton("webhookAdd"));
    await typeInto(dialog().querySelector<HTMLInputElement>("#webhook-name"), "Alerts");
    await typeInto(dialog().querySelector<HTMLInputElement>("#webhook-url"), "https://open.feishu.cn/open-apis/bot/v2/hook/6a3f1c2d");

    await press(dialog().querySelector('[aria-label="webhookOptionMentionAll"]') as HTMLElement);
    await press(dialogButton("webhookSave"));

    expect(mocks.createWebhookEndpoint).toHaveBeenCalledTimes(1);
    const [input] = mocks.createWebhookEndpoint.mock.calls[0];
    // Absent means off; turning it on puts exactly one key in the blob.
    expect((input as { options: Record<string, unknown> }).options).toEqual({ mentionAll: true });
  });

  it("marks a channel that pings the whole group", async () => {
    mocks.endpoints = [{ ...ENDPOINT, options: { mentionAll: true } }];
    await render();
    expect(container.textContent).toContain("webhookMentionAllOn");
  });

  it("offers the global defaults, which is what an unconfigured automation inherits", async () => {
    mocks.endpoints = [ENDPOINT];
    await render();

    // The section exists and is populated from the host, not from local state.
    expect(container.textContent).toContain("notificationDefaults");
    expect(mocks.getNotificationDefaults).toHaveBeenCalled();
    // The channel is offered for selection, by name.
    const channel = container.querySelector('[aria-label="Release group"]');
    expect(channel).not.toBeNull();
  });

  it("refuses a template with an unknown variable before it can reach a group", async () => {
    await render();
    const field = container.querySelector<HTMLTextAreaElement>("#notification-template");
    expect(field).not.toBeNull();

    await typeInto(field, "{{nmae}} {{status}}");

    // Refused locally: the field says so and Save stays disabled, so the typo cannot
    // be saved and then read by everyone in the group.
    expect(container.textContent).toContain("notificationTemplateUnknownVariable");
    expect(queryButton("webhookSave").disabled).toBe(true);
    expect(mocks.setNotificationDefaults).not.toHaveBeenCalled();
  });

  it("reports a refused save with the message for its code", async () => {
    await render();
    await press(queryButton("webhookAdd"));

    await typeInto(dialog().querySelector<HTMLInputElement>("#webhook-name"), "Group");
    await typeInto(dialog().querySelector<HTMLInputElement>("#webhook-url"), "https://evil.example.com/hook/abcdefgh");
    await press(dialogButton("webhookSave"));

    expect(mocks.createWebhookEndpoint).toHaveBeenCalledTimes(1);
    // The code becomes its own message rather than a generic failure, and the
    // editor stays open so the user can fix the field.
    expect(dialog().textContent).toContain("webhookErrorUrlWrongHost");
    expect(dialog().textContent).toContain("webhookDialogCreate");
  });

  it("sends a test message and surfaces a typed failure", async () => {
    mocks.endpoints = [ENDPOINT];
    mocks.testWebhookEndpoint.mockResolvedValue({ ok: false, code: "platform-rejected" });
    await render();

    await press(queryButton("webhookTest"));

    expect(mocks.testWebhookEndpoint).toHaveBeenCalledTimes(1);
    const [id, message] = mocks.testWebhookEndpoint.mock.calls[0];
    expect(id).toBe("e1");
    // The text is built here so the main process needs no copy table.
    expect((message as { title: string }).title).toBe("webhookTestTitle");
    expect(container.textContent).toContain("webhookTestFailed");
    expect(container.textContent).toContain("webhookSendErrorPlatformRejected");
  });
});
