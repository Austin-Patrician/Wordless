import { Check, ChevronRight, CircleAlert, PencilLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EnabledModelRecord, ProviderConnectionRecord, ThinkingLevel, WorkbenchEntryDefinition } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { ProviderIcon } from "../settings/provider-icons";

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

export function ModelPicker({ connections, disabled = false, entry, models, onConfigure, onOpenChange, onSelect, open, selected, thinkingLevel }: ModelPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const modelButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [updating, setUpdating] = useState(false);
  const [submenuModel, setSubmenuModel] = useState<EnabledModelRecord | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<SubmenuPosition | null>(null);
  const { t } = usePreferences();
  const available = useMemo(() => models.filter((model) => model.enabled), [models]);
  const thinkingLabel = (level: ThinkingLevel) => t(`thinkingLevel_${level}` as Parameters<typeof t>[0]);

  const showThinkingMenu = (model: EnabledModelRecord, anchor: HTMLElement) => {
    const width = 132;
    const height = 34 + model.capabilities.supportedThinkingLevels.length * 28;
    const rect = anchor.getBoundingClientRect();
    const fitsRight = rect.right + 6 + width <= window.innerWidth - 8;
    const left = fitsRight ? rect.right + 6 : Math.max(8, rect.left - width - 6);
    const top = Math.min(Math.max(8, rect.top - 6), Math.max(8, window.innerHeight - height - 8));
    setSubmenuModel(model);
    setSubmenuPosition({ left, top, width });
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
  }, [open]);

  if (!open) return null;

  return (
    <div className="absolute bottom-[48px] right-0 z-[60] w-[304px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[12px] border border-[#e2e4e6] bg-white p-1.5 font-['Inter','Noto_Sans_SC','Manrope',sans-serif] text-[#35373b] shadow-[0_10px_24px_rgba(38,43,48,.09)] dark:border-[#3b3e41] dark:bg-[#202225] dark:text-[#eff1f2]" ref={menuRef} role="menu">
      <div className="max-h-[240px] overflow-y-auto overscroll-contain pr-0.5" onScroll={() => setSubmenuModel(null)}>
        {available.map((model) => {
          const connection = connections.find((candidate) => candidate.id === model.connectionId);
          const reason = incompatibility(model, entry);
          const active = selected?.connectionId === model.connectionId && selected.modelId === model.modelId;
          const unavailable = connection?.authStatus !== "configured" || reason !== null;
          const badge = badgeFor(model, t);
          return (
            <button
              aria-expanded={active && model.capabilities.supportsReasoning ? submenuModel?.connectionId === model.connectionId && submenuModel.modelId === model.modelId : undefined}
              aria-haspopup={active && model.capabilities.supportsReasoning ? "menu" : undefined}
              className={`flex h-[34px] w-full items-center rounded-[8px] px-2 text-left transition-colors ${active ? "bg-[#f6faff] dark:bg-[#293441]" : "hover:bg-[#f8f9f9] dark:hover:bg-[#292b2e]"} ${unavailable || disabled ? "cursor-not-allowed opacity-45" : ""}`}
              disabled={unavailable || disabled || updating}
              key={`${model.connectionId}:${model.modelId}`}
              onKeyDown={(event) => {
                if (active && model.capabilities.supportsReasoning && event.key === "ArrowRight") {
                  event.preventDefault();
                  showThinkingMenu(model, event.currentTarget);
                  window.requestAnimationFrame(() => submenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
                }
              }}
              onClick={async (event) => {
                if (model.capabilities.supportsReasoning) {
                  if (active) {
                    showThinkingMenu(model, event.currentTarget);
                    return;
                  }
                  setSubmenuModel(null);
                  setSubmenuPosition(null);
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
                if (active && model.capabilities.supportsReasoning && !disabled && !unavailable) showThinkingMenu(model, event.currentTarget);
                else {
                  setSubmenuModel(null);
                  setSubmenuPosition(null);
                }
              }}
              ref={(node) => {
                const key = `${model.connectionId}:${model.modelId}`;
                if (node) modelButtonRefs.current.set(key, node);
                else modelButtonRefs.current.delete(key);
              }}
              role="menuitem"
              type="button"
            >
              <ProviderIcon avatarId={connection?.avatarId} className="size-4 shrink-0 object-contain" providerId={connection?.providerId ?? model.connectionId} />
              <span className="ml-2 min-w-0 truncate text-[12px] text-[#55575b] dark:text-[#e4e7e9]">{model.displayName}</span>
              {badge ? <span className={`ml-1.5 shrink-0 rounded-[3px] px-1 py-0.5 text-[10px] leading-none ${badge.tone === "rose" ? "bg-[#ffedf0] text-[#f15d70]" : "bg-[#e9f5ff] text-[#4b9ee4]"}`}>{badge.label}</span> : null}
              {active && model.capabilities.supportsReasoning ? <span className="ml-auto shrink-0 text-[10px] font-medium text-[#687079] dark:text-[#c5cbd1]">{thinkingLabel(thinkingLevel)}</span> : null}
              {active ? <Check className={`${model.capabilities.supportsReasoning ? "ml-1.5" : "ml-auto"} shrink-0 text-[#14c6ae]`} size={15} strokeWidth={1.8} /> : reason || connection?.authStatus !== "configured" ? <CircleAlert className="ml-auto shrink-0 text-[#a46a42]" size={14} /> : null}
              {active && model.capabilities.supportsReasoning && !unavailable ? <ChevronRight className="ml-1 shrink-0 text-[#8a9096] dark:text-[#9fa5ab]" size={13} strokeWidth={1.8} /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-1 border-t border-[#eeeeef] pt-1 dark:border-[#383b3f]">
        <button className="flex h-[38px] w-full items-center gap-2 rounded-[8px] px-2 text-[12px] text-[#4e5157] transition-colors hover:bg-[#f8f9f9] dark:text-[#d2d5d8] dark:hover:bg-[#292b2e]" onClick={() => { onOpenChange(false); onConfigure(); }} onPointerEnter={() => setSubmenuModel(null)} type="button"><PencilLine className="text-[#74787e] dark:text-[#abb0b6]" size={16} strokeWidth={1.65} />{t("configureCustomModel")}</button>
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
