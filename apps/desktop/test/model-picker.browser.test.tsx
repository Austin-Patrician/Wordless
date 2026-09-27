import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => key }),
}));

import type { EnabledModelRecord, ProviderConnectionRecord, WorkbenchEntryDefinition } from "@wordless/domain";
import { ModelPicker } from "../src/renderer/features/workbench/ModelPicker";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function connection(id: string, displayName: string): ProviderConnectionRecord {
  return {
    id,
    kind: "builtin",
    providerId: id,
    avatarId: null,
    displayName,
    baseUrl: null,
    api: null,
    authStatus: "configured",
    createdAt: 0,
    updatedAt: 0,
  };
}

function model(connectionId: string, modelId: string, options: { displayName?: string; reasoning?: boolean } = {}): EnabledModelRecord {
  return {
    connectionId,
    modelId,
    displayName: options.displayName ?? modelId,
    capabilities: {
      supportsText: true,
      supportsVision: false,
      supportsToolUse: "unknown",
      supportsReasoning: options.reasoning ?? false,
      supportedThinkingLevels: options.reasoning ? ["off", "medium", "high"] : [],
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
    },
    enabled: true,
    updatedAt: 0,
  };
}

const ENTRY = {
  id: "general-work",
  mode: "general",
  labelKey: "entryGeneral",
  descriptionKey: "entryGeneralHelp",
  iconKey: "sparkles",
  profile: null,
  workbenchId: "general",
  availability: "available",
  modelRequirements: {},
} as unknown as WorkbenchEntryDefinition;

// The shape a real profile has: one model id under two endpoints, plus a third
// provider that must disappear as soon as it stops matching.
const CONNECTIONS = [connection("routin-glm", "Routin GLM"), connection("hyb-gpt", "HYB GPT"), connection("wong", "Wong")];
const MODELS = [
  model("routin-glm", "glm-5.3-flash", { displayName: "GLM 5.3 Flash", reasoning: true }),
  model("hyb-gpt", "glm-5.3-flash", { displayName: "GLM 5.3 Flash" }),
  model("wong", "minimaxai/minimax-m3", { displayName: "MiniMax M3" }),
];

describe("model picker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSelect: ReturnType<typeof vi.fn>;
  let onOpenChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn().mockResolvedValue(undefined);
    onOpenChange = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(overrides: { selected?: { connectionId: string; modelId: string } | null } = {}): Promise<void> {
    await act(async () => {
      root.render(
        <ModelPicker
          connections={CONNECTIONS}
          entry={ENTRY}
          models={MODELS}
          onConfigure={() => undefined}
          onOpenChange={onOpenChange}
          onSelect={onSelect}
          open
          selected={overrides.selected ?? null}
          thinkingLevel="medium"
        />,
      );
    });
  }

  /** The picker renders in place (it is not portalled), so the container sees it. */
  function search(): HTMLInputElement {
    const field = container.querySelector<HTMLInputElement>('input[aria-label="searchModels"]');
    if (!field) throw new Error("no search field");
    return field;
  }

  function rowKeys(): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[data-model-key]")).map(
      (element) => element.dataset.modelKey ?? "",
    );
  }

  function headerText(): string[] {
    return Array.from(container.querySelectorAll("section > div")).map((element) => element.textContent ?? "");
  }

  function submenu(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="menu"][aria-label="thinkingDepth"]');
  }

  async function type(value: string): Promise<void> {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(search(), value);
      search().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function press(target: HTMLElement, key: string): Promise<void> {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  it("groups models under their provider, with a header per provider", async () => {
    await render();
    expect(headerText().some((text) => text.startsWith("Routin GLM"))).toBe(true);
    expect(headerText().some((text) => text.startsWith("HYB GPT"))).toBe(true);
    expect(headerText().some((text) => text.startsWith("Wong"))).toBe(true);
    // The same model id under two providers stays two rows in two groups.
    expect(rowKeys()).toEqual(["routin-glm:glm-5.3-flash", "hyb-gpt:glm-5.3-flash", "wong:minimaxai/minimax-m3"]);
  });

  it("filters on a model name and drops the providers left with nothing", async () => {
    await render();
    await type("MiniMax");

    expect(rowKeys()).toEqual(["wong:minimaxai/minimax-m3"]);
    expect(headerText().some((text) => text.startsWith("Routin GLM"))).toBe(false);
    expect(headerText().some((text) => text.startsWith("Wong"))).toBe(true);
  });

  it("keeps a whole provider's models when the provider name matches", async () => {
    await render();
    await type("routin");

    // The provider name describes what it serves, so typing part of it should bring up
    // the group rather than only rows that spell it out.
    expect(rowKeys()).toEqual(["routin-glm:glm-5.3-flash"]);
    expect(headerText().some((text) => text.startsWith("Routin GLM"))).toBe(true);
  });

  it("says so when nothing matches instead of rendering empty headers", async () => {
    await render();
    await type("nothing-like-this");

    expect(container.textContent).toContain("noMatchingModels");
    expect(rowKeys()).toEqual([]);
    expect(container.querySelectorAll("section").length).toBe(0);
  });

  it("clears the query on Escape first, and only then asks to close", async () => {
    await render();
    await type("MiniMax");
    expect(rowKeys()).toHaveLength(1);

    await press(search(), "Escape");
    // A typed query is the thing most likely to be what the user wants undone, so it
    // goes before the panel does.
    expect(search().value).toBe("");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(rowKeys()).toHaveLength(3);

    await press(search(), "Escape");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes the thinking menu when the filter changes underneath it", async () => {
    await render({ selected: { connectionId: "routin-glm", modelId: "glm-5.3-flash" } });

    // Clicking the active reasoning model opens its depth menu.
    const active = container.querySelector<HTMLButtonElement>('[data-model-key="routin-glm:glm-5.3-flash"]');
    await act(async () => {
      active?.click();
    });
    expect(submenu()).not.toBeNull();

    // Its position was measured once, against a row that filtering can move or remove,
    // and filtering fires no scroll event to close it.
    await type("MiniMax");
    expect(submenu()).toBeNull();
  });

  it("selects a model without a reasoning menu straight away", async () => {
    await render();
    const plain = container.querySelector<HTMLButtonElement>('[data-model-key="wong:minimaxai/minimax-m3"]');
    await act(async () => {
      plain?.click();
    });

    expect(onSelect).toHaveBeenCalledWith("wong", "minimaxai/minimax-m3");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
