import { Check, ChevronRight, CircleAlert, PencilLine, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EnabledModelRecord, ProviderConnectionRecord, ThinkingLevel, WorkbenchEntryDefinition } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { ProviderIcon } from "../settings/provider-icons";
import {
  countModelPickerModels,
  filterModelPickerGroups,
  modelPickerGroups,
  type ModelPickerGroup,
} from "./model-picker-groups";

type ModelPickerProps = {
  connections: ProviderConnectionRecord[];
  disabled?: boolean;
  entry: WorkbenchEntryDefinition;
  models: EnabledModelRecord[];
  onConfigure: () => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (connectionId: string, modelId: string, thinkingLevel?: ThinkingLevel) => void | Promise<void>;
  open: boolean;
  selected: { connectionId: string; modelId: string } | null;
  thinkingLevel: ThinkingLevel;
};

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function thinkingLevelForModelSelection(next: EnabledModelRecord, previous: EnabledModelRecord | undefined, current: ThinkingLevel): ThinkingLevel {
  const supported = next.capabilities.supportedThinkingLevels;
  if (!next.capabilities.supportsReasoning) return "off";
  const requested = previous?.capabilities.supportsReasoning ? current : "medium";
  if (supported.includes(requested)) return requested;
  const requestedIndex = THINKING_LEVELS.indexOf(requested);
  for (let index = requestedIndex; index < THINKING_LEVELS.length; index += 1) {
    const candidate = THINKING_LEVELS[index];
    if (supported.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVELS[index];
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? "off";
}

function incompatibility(model: EnabledModelRecord, entry: WorkbenchEntryDefinition): string | null {
  if (entry.modelRequirements.requiresVision && !model.capabilities.supportsVision) return "Vision";
  if (entry.modelRequirements.requiresToolUse && model.capabilities.supportsToolUse === false) return "Tools";
  if (entry.modelRequirements.minimumContextWindow && model.capabilities.contextWindow < entry.modelRequirements.minimumContextWindow) return "Context";
  return null;
}

function badgeFor(model: EnabledModelRecord, t: ReturnType<typeof usePreferences>["t"]): { label: string; tone: "rose" | "blue" } | undefined {
  const id = model.modelId.toLowerCase();
  if (id.includes("hy3")) return { label: t("limitedFree"), tone: "rose" };
  if (id.includes("glm-5.2")) return { label: t("nightDiscount"), tone: "blue" };
  return undefined;
}

type SubmenuPosition = { left: number; top: number; width: number };

/**
 * The model picker above the composer.
 *
 * Models are grouped under the provider that exposes them, with a search field pinned
 * to the top of the panel. Both come from a real problem rather than symmetry with
 * other apps: one profile here has `glm-5.3-flash` under four different endpoints, so
 * the flat list showed four identical-looking rows told apart only by a 16px icon, and
 * with a few dozen rows only about seven fitted in the panel.
 *
 * The grouping key is `EnabledModelRecord.connectionId`, which the runtime fills with
 * the provider id (`toLegacyEnabledModels`), so the header label and icon are the same
 * ones the settings page uses — see `model-picker-groups.ts` for why the family-based
 * grouping used by the discovery dialog would be the wrong thing to reuse.
 *
 * Known departure: a search field inside `role="menu"` is not a legal combination — a
 * menu may not contain a text input. The correct pattern is `role="dialog"` with a
 * listbox, and switching would also mean reworking the roving focus and the ArrowRight
 * path into the depth menu, for nothing the user can perceive. Worth revisiting if the
 * picker ever grows a second interactive control.
 */
export function ModelPicker({ connections, disabled = false, entry, models, onConfigure, onOpenChange, onSelect, open, selected, thinkingLevel }: ModelPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const modelButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [updating, setUpdating] = useState(false);
  const [query, setQuery] = useState("");
  const [submenuModel, setSubmenuModel] = useState<EnabledModelRecord | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<SubmenuPosition | null>(null);
  const { t } = usePreferences();
  const available = useMemo(() => models.filter((model) => model.enabled), [models]);
  const allGroups = useMemo(() => modelPickerGroups(available, connections), [available, connections]);
  const groups = useMemo(() => filterModelPickerGroups(allGroups, query), [allGroups, query]);
  const thinkingLabel = (level: ThinkingLevel) => t(`thinkingLevel_${level}` as Parameters<typeof t>[0]);

  const closeSubmenu = () => {
    setSubmenuModel(null);
    setSubmenuPosition(null);
  };

  const showThinkingMenu = (model: EnabledModelRecord, anchor: HTMLElement, focusFirst = false) => {
    const width = 132;
    const height = 34 + model.capabilities.supportedThinkingLevels.length * 28;
    const rect = anchor.getBoundingClientRect();
    const fitsRight = rect.right + 6 + width <= window.innerWidth - 8;
    const left = fitsRight ? rect.right + 6 : Math.max(8, rect.left - width - 6);
    const top = Math.min(Math.max(8, rect.top - 6), Math.max(8, window.innerHeight - height - 8));
    setSubmenuModel(model);
    setSubmenuPosition({ left, top, width });
    // Only when the keyboard opened it: moving focus on hover would fight the pointer.
    if (focusFirst) window.requestAnimationFrame(() => submenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target) && !submenuRef.current?.contains(target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (open) return;
    setSubmenuModel(null);
    setSubmenuPosition(null);
    // The query is dropped on close, so reopening always shows every provider rather
    // than silently filtering by something typed minutes ago.
    setQuery("");
  }, [open]);

  // Land on the search field, and bring the current model into view. Both are about
  // the panel opening where the user left off rather than at the top of a long list.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
      if (!selected) return;
      modelButtonRefs.current.get(`${selected.connectionId}:${selected.modelId}`)?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, selected]);

  if (!open) return null;

  const activeKey = selected ? `${selected.connectionId}:${selected.modelId}` : null;
  const total = countModelPickerModels(groups);

  return (
    <div
      className="absolute bottom-[48px] right-0 z-[60] w-[304px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[12px] border border-[#e2e4e6] bg-white p-1.5 font-['Inter','Noto_Sans_SC','Manrope',sans-serif] text-[#35373b] shadow-[0_10px_24px_rgba(38,43,48,.09)] dark:border-[#3b3e41] dark:bg-[#202225] dark:text-[#eff1f2]"
      onKeyDown={(event) => {
        // Escape clears an active search first and only then closes: a typed query is
        // the thing the user most likely wants undone.
        if (event.key !== "Escape") return;
        if (query) {
          event.preventDefault();
          setQuery("");
          searchRef.current?.focus();
          return;
        }
        onOpenChange(false);
      }}
      ref={menuRef}
      role="menu"
    >
      <div className="relative px-0.5 pb-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#90938e]" />
        <input
          aria-label={t("searchModels")}
          className="h-8 w-full rounded-[8px] border border-[#e2e4e6] bg-white pl-8 pr-7 text-[12px] text-[#35373b] outline-none placeholder:text-[#90938e] focus:border-[#c9ccc8] dark:border-[#3b3e41] dark:bg-[#1b1c19] dark:text-[#eff1f2] dark:placeholder:text-[#747870]"
          onChange={(event) => {
            setQuery(event.target.value);
            // The submenu's position was measured once, against a row that may since
            // have moved or disappeared, and filtering fires no scroll event to close it.
            closeSubmenu();
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-model-key]") ?? []);
            const target = event.key === "ArrowDown" ? rows[0] : rows[rows.length - 1];
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          placeholder={t("searchModels")}
          ref={searchRef}
          value={query}
        />
        {query ? (
          <button
            aria-label={t("clearSearch")}
            className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-[#90938e] hover:bg-[#f2f3f2] dark:hover:bg-[#2a2c2f]"
            onClick={() => {
              setQuery("");
              closeSubmenu();
              searchRef.current?.focus();
            }}
            type="button"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>

      <div className="max-h-[min(320px,calc(100vh-16rem))] overflow-y-auto overscroll-contain pr-0.5" onScroll={closeSubmenu} ref={listRef}>
        {total === 0 ? (
          <div className="grid place-items-center px-4 py-6 text-center">
            <Search className="mb-1.5 text-[#b3b8bd]" size={15} />
            <p className="text-[12px] text-[#7c8085] dark:text-[#a5abb0]">{t("noMatchingModels")}</p>
          </div>
        ) : (
          groups.map((group) => (
            <ModelPickerSection
              activeKey={activeKey}
              disabled={disabled}
              entry={entry}
              group={group}
              key={group.id}
              onCloseSubmenu={closeSubmenu}
              onOpenChange={onOpenChange}
              onSelect={onSelect}
              onShowThinking={showThinkingMenu}
              registerRow={(key, node) => {
                if (node) modelButtonRefs.current.set(key, node);
                else modelButtonRefs.current.delete(key);
              }}
              submenuModel={submenuModel}
              t={t}
              thinkingLabel={thinkingLabel}
              thinkingLevel={thinkingLevel}
              updating={updating}
              setUpdating={setUpdating}
            />
          ))
        )}
      </div>

      <div className="mt-1 border-t border-[#eeeeef] pt-1 dark:border-[#383b3f]">
        <button className="flex h-[38px] w-full items-center gap-2 rounded-[8px] px-2 text-[12px] text-[#4e5157] transition-colors hover:bg-[#f8f9f9] dark:text-[#d2d5d8] dark:hover:bg-[#292b2e]" onClick={() => { onOpenChange(false); onConfigure(); }} onPointerEnter={closeSubmenu} type="button"><PencilLine className="text-[#74787e] dark:text-[#abb0b6]" size={16} strokeWidth={1.65} />{t("configureCustomModel")}</button>
      </div>

      {submenuModel && submenuPosition ? createPortal(
        <div
          aria-label={t("thinkingDepth")}
          className="fixed z-[70] overflow-hidden rounded-[8px] border border-[#e2e4e6] bg-white p-1 font-['Inter','Noto_Sans_SC','Manrope',sans-serif] text-[#35373b] shadow-[0_10px_22px_rgba(38,43,48,.13)] dark:border-[#3b3e41] dark:bg-[#202225] dark:text-[#eff1f2]"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "Escape") return;
            event.preventDefault();
            const key = `${submenuModel.connectionId}:${submenuModel.modelId}`;
            setSubmenuModel(null);
            modelButtonRefs.current.get(key)?.focus();
          }}
          ref={submenuRef}
          role="menu"
          style={submenuPosition}
        >
          <div className="truncate px-1.5 pb-1 pt-0.5 text-[10px] font-medium text-[#8a8f94] dark:text-[#a5abb0]">{t("thinkingDepth")}</div>
          {submenuModel.capabilities.supportedThinkingLevels.map((level) => {
            const activeLevel = selected?.connectionId === submenuModel.connectionId && selected.modelId === submenuModel.modelId && thinkingLevel === level;
            return (
              <button
                aria-checked={activeLevel}
                className={`flex h-7 w-full items-center rounded-[6px] px-1.5 text-left text-[10.5px] transition-colors ${activeLevel ? "bg-[#f2fbf9] text-[#287d70] dark:bg-[#263b38] dark:text-[#8de0d2]" : "text-[#555a60] hover:bg-[#f7f8f8] dark:text-[#d7dade] dark:hover:bg-[#2a2c2f]"}`}
                disabled={updating}
                key={level}
                onClick={async () => {
                  setUpdating(true);
                  try {
                    await onSelect(submenuModel.connectionId, submenuModel.modelId, level);
                    onOpenChange(false);
                  } finally {
                    setUpdating(false);
                  }
                }}
                role="menuitemradio"
                type="button"
              >
                <span>{thinkingLabel(level)}</span>
                {activeLevel ? <Check className="ml-auto text-[#14a892]" size={12} strokeWidth={1.9} /> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

interface ModelPickerSectionProps {
  activeKey: string | null;
  disabled: boolean;
  entry: WorkbenchEntryDefinition;
  group: ModelPickerGroup;
  onCloseSubmenu: () => void;
  onOpenChange: (open: boolean) => void;
  onSelect: ModelPickerProps["onSelect"];
  onShowThinking: (model: EnabledModelRecord, anchor: HTMLElement, focusFirst?: boolean) => void;
  registerRow: (key: string, node: HTMLButtonElement | null) => void;
  setUpdating: (value: boolean) => void;
  submenuModel: EnabledModelRecord | null;
  t: ReturnType<typeof usePreferences>["t"];
  thinkingLabel: (level: ThinkingLevel) => string;
  thinkingLevel: ThinkingLevel;
  updating: boolean;
}

/**
 * One provider and its models.
 *
 * The provider icon lives on the sticky header rather than on every row: that is what
 * grouping buys, and with the same model under several endpoints it is also the only
 * place it can sit without repeating.
 */
function ModelPickerSection(props: ModelPickerSectionProps) {
  const { activeKey, disabled, entry, group, onCloseSubmenu, onOpenChange, onSelect, onShowThinking, registerRow, setUpdating, submenuModel, t, thinkingLabel, thinkingLevel, updating } = props;

  return (
    <section>
      <div className="sticky top-0 z-10 flex h-[26px] items-center gap-1.5 bg-white/95 px-2 backdrop-blur dark:bg-[#202225]/95">
        <ProviderIcon avatarId={group.avatarId} className="size-3.5 shrink-0 object-contain" providerId={group.id} />
        <span className="min-w-0 truncate text-[10.5px] font-medium text-[#8a8f94] dark:text-[#a5abb0]">{group.label}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[#b3b8bd] dark:text-[#7f858b]">{group.models.length}</span>
      </div>
      {group.models.map((model) => {
        const reason = incompatibility(model, entry);
        const key = `${model.connectionId}:${model.modelId}`;
        const active = activeKey === key;
        // The provider-level half of this comes from the group, which resolved the
        // connection once for the whole section.
        const unavailable = reason !== null || !group.configured;
        const badge = badgeFor(model, t);
        return (
          <button
            aria-expanded={active && model.capabilities.supportsReasoning ? submenuModel?.connectionId === model.connectionId && submenuModel.modelId === model.modelId : undefined}
            aria-haspopup={active && model.capabilities.supportsReasoning ? "menu" : undefined}
            className={`flex h-[34px] w-full items-center rounded-[8px] px-2 text-left transition-colors ${active ? "bg-[#f6faff] dark:bg-[#293441]" : "hover:bg-[#f8f9f9] dark:hover:bg-[#292b2e]"} ${unavailable || disabled ? "cursor-not-allowed opacity-45" : ""}`}
            data-model-key={key}
            disabled={unavailable || disabled || updating}
            key={key}
            onKeyDown={(event) => {
              if (active && model.capabilities.supportsReasoning && event.key === "ArrowRight") {
                event.preventDefault();
                onShowThinking(model, event.currentTarget, true);
              }
            }}
            onClick={async (event) => {
              if (model.capabilities.supportsReasoning) {
                if (active) {
                  onShowThinking(model, event.currentTarget);
                  return;
                }
                onCloseSubmenu();
                const defaultThinkingLevel = thinkingLevelForModelSelection(model, undefined, "medium");
                setUpdating(true);
                try {
                  await onSelect(model.connectionId, model.modelId, defaultThinkingLevel);
                } finally {
                  setUpdating(false);
                }
                return;
              }
              setUpdating(true);
              try {
                await onSelect(model.connectionId, model.modelId);
                onOpenChange(false);
              } finally {
                setUpdating(false);
              }
            }}
            onPointerEnter={(event) => {
              if (event.pointerType !== "mouse") return;
              if (active && model.capabilities.supportsReasoning && !disabled && !unavailable) onShowThinking(model, event.currentTarget);
              else onCloseSubmenu();
            }}
            ref={(node) => registerRow(key, node)}
            role="menuitem"
            type="button"
          >
            <span className="min-w-0 truncate text-[12px] text-[#55575b] dark:text-[#e4e7e9]">{model.displayName}</span>
            {badge ? <span className={`ml-1.5 shrink-0 rounded-[3px] px-1 py-0.5 text-[10px] leading-none ${badge.tone === "rose" ? "bg-[#ffedf0] text-[#f15d70]" : "bg-[#e9f5ff] text-[#4b9ee4]"}`}>{badge.label}</span> : null}
            {active && model.capabilities.supportsReasoning ? <span className="ml-auto shrink-0 text-[10px] font-medium text-[#687079] dark:text-[#c5cbd1]">{thinkingLabel(thinkingLevel)}</span> : null}
            {active ? <Check className={`${model.capabilities.supportsReasoning ? "ml-1.5" : "ml-auto"} shrink-0 text-[#14c6ae]`} size={15} strokeWidth={1.8} /> : reason ? <CircleAlert className="ml-auto shrink-0 text-[#a46a42]" size={14} /> : null}
            {active && model.capabilities.supportsReasoning && !unavailable ? <ChevronRight className="ml-1 shrink-0 text-[#8a9096] dark:text-[#9fa5ab]" size={13} strokeWidth={1.8} /> : null}
          </button>
        );
      })}
    </section>
  );
}
