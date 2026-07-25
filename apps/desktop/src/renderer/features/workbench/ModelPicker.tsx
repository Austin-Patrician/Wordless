import { Bot, Check, CircleAlert, Cpu, PencilLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EnabledModelRecord, ProviderConnectionRecord, WorkbenchEntryDefinition } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { ProviderIcon } from "../settings/provider-icons";

type ModelPickerProps = {
  connections: ProviderConnectionRecord[];
  entry: WorkbenchEntryDefinition;
  models: EnabledModelRecord[];
  onConfigure: () => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (connectionId: string, modelId: string) => void;
  open: boolean;
  selected: { connectionId: string; modelId: string } | null;
};

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

export function ModelPicker({ connections, entry, models, onConfigure, onOpenChange, onSelect, open, selected }: ModelPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [maxMode, setMaxMode] = useState(false);
  const { t } = usePreferences();
  const available = useMemo(() => models.filter((model) => model.enabled), [models]);
  const automaticModel = available.find((model) => {
    const connection = connections.find((candidate) => candidate.id === model.connectionId);
    return connection?.authStatus === "configured" && incompatibility(model, entry) === null;
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <div className="absolute bottom-[48px] right-0 z-[60] w-[304px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[12px] border border-[#e2e4e6] bg-white p-1.5 font-['Inter','Noto_Sans_SC','Manrope',sans-serif] text-[#35373b] shadow-[0_10px_24px_rgba(38,43,48,.09)] dark:border-[#3b3e41] dark:bg-[#202225] dark:text-[#eff1f2]" ref={menuRef} role="menu">
      <button aria-checked={maxMode} className="flex h-[40px] w-full items-center justify-between rounded-[8px] px-2 text-left transition-colors hover:bg-[#f8f9f9] dark:hover:bg-[#292b2e]" onClick={() => setMaxMode((value) => !value)} role="switch" type="button">
        <span className="flex items-center gap-2 text-[12px] font-medium"><Cpu className="text-[#7e8288] dark:text-[#aeb2b8]" size={16} strokeWidth={1.7} />{t("maxMode")}</span>
        <span className={`relative h-[18px] w-[30px] rounded-full transition-colors ${maxMode ? "bg-[#2b95f5]" : "bg-[#e4e5e7] dark:bg-[#4c4f54]"}`}><span className={`absolute top-[2px] size-[14px] rounded-full bg-white shadow-sm transition-transform ${maxMode ? "translate-x-[14px]" : "translate-x-[2px]"}`} /></span>
      </button>
      <div className="mx-0.5 h-px bg-[#eeeeef] dark:bg-[#383b3f]" />
      <button
        className="flex h-[36px] w-full items-center gap-2 rounded-[8px] px-2 text-left text-[12px] text-[#55585d] transition-colors hover:bg-[#f7f8f8] disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#c4c7ca] dark:hover:bg-[#292b2e]"
        disabled={!automaticModel}
        onClick={() => {
          if (!automaticModel) return;
          onSelect(automaticModel.connectionId, automaticModel.modelId);
          onOpenChange(false);
        }}
        type="button"
      >
        <Bot className="text-[#6d7176] dark:text-[#b0b4ba]" size={16} strokeWidth={1.65} />
        {t("autoModel")}
      </button>
      <div className="max-h-[240px] overflow-y-auto overscroll-contain pr-0.5">
        {available.map((model) => {
          const connection = connections.find((candidate) => candidate.id === model.connectionId);
          const reason = incompatibility(model, entry);
          const active = selected?.connectionId === model.connectionId && selected.modelId === model.modelId;
          const unavailable = connection?.authStatus !== "configured" || reason !== null;
          const badge = badgeFor(model, t);
          return (
            <button
              className={`flex h-[34px] w-full items-center rounded-[8px] px-2 text-left transition-colors ${active ? "bg-[#f6faff] dark:bg-[#293441]" : "hover:bg-[#f8f9f9] dark:hover:bg-[#292b2e]"} ${unavailable ? "cursor-not-allowed opacity-45" : ""}`}
              disabled={unavailable}
              key={`${model.connectionId}:${model.modelId}`}
              onClick={() => {
                onSelect(model.connectionId, model.modelId);
                onOpenChange(false);
              }}
              type="button"
            >
              <ProviderIcon avatarId={connection?.avatarId} className="size-4 shrink-0 object-contain" providerId={connection?.providerId ?? model.connectionId} />
              <span className="ml-2 min-w-0 truncate text-[12px] text-[#55575b] dark:text-[#e4e7e9]">{model.displayName}</span>
              {badge ? <span className={`ml-1.5 shrink-0 rounded-[3px] px-1 py-0.5 text-[10px] leading-none ${badge.tone === "rose" ? "bg-[#ffedf0] text-[#f15d70]" : "bg-[#e9f5ff] text-[#4b9ee4]"}`}>{badge.label}</span> : null}
              {model.capabilities.supportsReasoning ? <span className="ml-1.5 shrink-0 text-[11px] text-[#3e4145] dark:text-[#d7dbdf]">{t("high")}</span> : null}
              {active ? <Check className="ml-auto shrink-0 text-[#14c6ae]" size={15} strokeWidth={1.8} /> : reason || connection?.authStatus !== "configured" ? <CircleAlert className="ml-auto shrink-0 text-[#a46a42]" size={14} /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-1 border-t border-[#eeeeef] pt-1 dark:border-[#383b3f]">
        <button className="flex h-[38px] w-full items-center gap-2 rounded-[8px] px-2 text-[12px] text-[#4e5157] transition-colors hover:bg-[#f8f9f9] dark:text-[#d2d5d8] dark:hover:bg-[#292b2e]" onClick={() => { onOpenChange(false); onConfigure(); }} type="button"><PencilLine className="text-[#74787e] dark:text-[#abb0b6]" size={16} strokeWidth={1.65} />{t("configureCustomModel")}</button>
      </div>
    </div>
  );
}
