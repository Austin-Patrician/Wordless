import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelConfigurationSnapshot } from "@wordless/domain";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@wordless/ui-kit";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff, LoaderCircle, Settings2, X } from "lucide-react";
import wordlessIcon from "../../../icons/common-icons/wordless.png";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { ProviderIcon } from "../settings/provider-icons";
import {
  carouselOffset,
  mergeQuickProviderConfiguration,
  QUICK_MODEL_PROVIDERS,
  quickProviderModels,
  recommendedQuickModel,
} from "./quick-model-setup-model";
import "./quick-model-setup.css";

type QuickModelSetupProps = {
  configuration: ModelConfigurationSnapshot;
  onAdvanced: () => void;
  onConfigured: (providerId: string, modelId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

function cardStyle(offset: number, dragProgress: number, accent: string): CSSProperties {
  const position = offset + dragProgress;
  const distance = Math.abs(position);
  const horizontalPercent = Math.sign(position) * (16.5 * distance + 1.5 * distance * distance);
  const depthRatio = Math.max(0, 1 - distance / 3);
  const visibility = Math.max(0, Math.min(1, (3 - distance) / 0.35));
  const depth = -distance * 84;
  const y = 32 - distance * 12;
  const scale = 0.72 + depthRatio * 0.3;
  const hiddenAtBack = visibility < 0.05;
  return {
    "--quick-accent": accent,
    "--quick-x": `${horizontalPercent}cqw`,
    "--quick-y": `${y}px`,
    "--quick-z": `${depth}px`,
    "--quick-scale": String(scale),
    "--quick-opacity": String((0.55 + depthRatio * 0.45) * visibility),
    pointerEvents: hiddenAtBack ? "none" : "auto",
    zIndex: Math.round(depthRatio * 20),
  } as CSSProperties;
}

export function QuickModelSetup({ configuration, onAdvanced, onConfigured, onOpenChange, open }: QuickModelSetupProps) {
  const client = useRuntimeClient();
  const { refresh } = useRuntime();
  const { reduceMotion, t } = usePreferences();
  const [activeIndex, setActiveIndex] = useState(0);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [modelSelections, setModelSelections] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState(false);
  const [dragDelta, setDragDelta] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pointerStart = useRef<number | null>(null);
  const pointerDragged = useRef(false);
  const wheelLocked = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeDefinition = QUICK_MODEL_PROVIDERS[activeIndex] ?? QUICK_MODEL_PROVIDERS[0]!;
  const activeProvider = configuration.providers.find((provider) => provider.kind === "chat" && provider.id === activeDefinition.providerId);
  const models = useMemo(() => quickProviderModels(configuration, activeDefinition.providerId), [activeDefinition.providerId, configuration]);
  const recommended = recommendedQuickModel(models, activeDefinition.recommendedModelId);
  const selectedModelId = modelSelections[activeDefinition.providerId] ?? recommended?.modelId ?? "";
  const apiKey = apiKeys[activeDefinition.providerId] ?? "";

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setShowApiKey(false);
    setError(null);
  }, [activeDefinition.providerId]);

  const move = (direction: -1 | 1) => {
    if (saving) return;
    setActiveIndex((current) => (current + direction + QUICK_MODEL_PROVIDERS.length) % QUICK_MODEL_PROVIDERS.length);
  };

  const submit = async () => {
    if (!activeProvider || !selectedModelId || (!apiKey.trim() && !activeProvider.apiKeyConfigured)) return;
    setSaving(true);
    setError(null);
    try {
      if (apiKey.trim()) {
        await client.saveProviderConfiguration("chat", activeProvider.id, mergeQuickProviderConfiguration(activeProvider.configuration, apiKey));
      }
      await client.setConfiguredModelEnabled("chat", activeProvider.id, selectedModelId, true);
      await refresh();
      onConfigured(activeProvider.id, selectedModelId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleWheel = (event: ReactWheelEvent) => {
    if (saving || wheelLocked.current || Math.abs(event.deltaY) + Math.abs(event.deltaX) < 10) return;
    event.preventDefault();
    wheelLocked.current = true;
    move((event.deltaY || event.deltaX) > 0 ? 1 : -1);
    window.setTimeout(() => { wheelLocked.current = false; }, reduceMotion ? 100 : 380);
  };

  const handlePointerDown = (event: ReactPointerEvent) => {
    if (saving) return;
    pointerStart.current = event.clientX;
    pointerDragged.current = false;
  };

  const handlePointerMove = (event: ReactPointerEvent) => {
    if (pointerStart.current === null || saving) return;
    const nextDelta = Math.max(-150, Math.min(150, event.clientX - pointerStart.current));
    if (Math.abs(nextDelta) > 6) {
      pointerDragged.current = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragDelta(nextDelta);
  };

  const handlePointerUp = (event: ReactPointerEvent) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    setDragDelta(0);
    if (start === null) return;
    const distance = event.clientX - start;
    if (Math.abs(distance) > 42) move(distance > 0 ? -1 : 1);
    window.setTimeout(() => { pointerDragged.current = false; }, 0);
  };

  const handlePointerCancel = () => {
    pointerStart.current = null;
    pointerDragged.current = false;
    setDragDelta(0);
  };

  if (!open) return null;

  return (
    <div className="quick-model-setup" role="presentation">
      <div
        aria-label={t("quickModelSetupTitle")}
        aria-modal="true"
        className="quick-model-setup__dialog"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
          if (event.key === "Escape" && !saving) onOpenChange(false);
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="quick-model-setup__header">
          <img alt="" className="quick-model-setup__brand-icon" draggable={false} src={wordlessIcon} />
          <div className="min-w-0">
            <h2>{t("quickModelSetupTitle")}</h2>
            <p>{t("quickModelSetupDescription")}</p>
          </div>
          <button aria-label={t("quickModelSetupSkip")} className="quick-model-setup__close" disabled={saving} onClick={() => onOpenChange(false)} type="button"><X /></button>
        </header>

        <div className={`quick-model-setup__stage ${dragDelta ? "is-dragging" : ""}`} onPointerCancel={handlePointerCancel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel}>
          <div aria-hidden="true" className="quick-model-setup__orbit"><span /></div>
          {QUICK_MODEL_PROVIDERS.map((definition, index) => {
            const offset = carouselOffset(index, activeIndex, QUICK_MODEL_PROVIDERS.length);
            const active = offset === 0;
            const provider = configuration.providers.find((candidate) => candidate.kind === "chat" && candidate.id === definition.providerId);
            const providerModels = quickProviderModels(configuration, definition.providerId);
            return (
              <button
                aria-current={active ? "true" : undefined}
                aria-label={definition.name}
                className={`quick-provider-card ${active ? "is-active" : ""}`}
                disabled={saving || !provider || providerModels.length === 0}
                key={definition.providerId}
                onClick={() => { if (!pointerDragged.current && !active) setActiveIndex(index); }}
                style={cardStyle(offset, dragDelta / 180, definition.accent)}
                tabIndex={active ? 0 : -1}
                type="button"
              >
                <span className="quick-provider-card__icon"><ProviderIcon providerId={definition.providerId} /></span>
                <strong>{definition.name}</strong>
              </button>
            );
          })}
          <button aria-label={t("previous")} className="quick-model-setup__arrow is-left" disabled={saving} onClick={() => move(-1)} type="button"><ChevronLeft /></button>
          <button aria-label={t("next")} className="quick-model-setup__arrow is-right" disabled={saving} onClick={() => move(1)} type="button"><ChevronRight /></button>
        </div>
        <div aria-label={t("provider")} className="quick-model-setup__dots" role="group">
          {QUICK_MODEL_PROVIDERS.map((provider, index) => (
            <button
              aria-label={`${t("quickModelSetupChoose")}: ${provider.name}`}
              aria-pressed={index === activeIndex}
              className={index === activeIndex ? "is-active" : ""}
              disabled={saving}
              key={provider.providerId}
              onClick={() => setActiveIndex(index)}
              type="button"
            ><span /></button>
          ))}
        </div>

        <div className="quick-model-setup__form" style={{ "--quick-accent": activeDefinition.accent } as CSSProperties}>
          <div className="quick-model-setup__field">
            <div className="quick-model-setup__label-row">
              <label htmlFor="quick-model-api-key">API Key</label>
              <button className="quick-model-setup__link" onClick={() => void client.openExternalUrl(activeDefinition.keyUrl)} type="button">{t("quickModelSetupGetKey")}<ExternalLink /></button>
            </div>
            <div className="quick-model-setup__input-wrap">
              <input
                autoComplete="off"
                id="quick-model-api-key"
                onChange={(event) => setApiKeys((current) => ({ ...current, [activeDefinition.providerId]: event.target.value }))}
                placeholder={activeProvider?.apiKeyConfigured ? t("quickModelSetupKeySaved") : t("apiKeyPlaceholder")}
                type={showApiKey ? "text" : "password"}
                value={apiKey}
              />
              <button aria-label={showApiKey ? t("hideApiKey") : t("showApiKey")} onClick={() => setShowApiKey((current) => !current)} type="button">{showApiKey ? <EyeOff /> : <Eye />}</button>
            </div>
          </div>
          <div className="quick-model-setup__field">
            <label>{t("quickModelSetupModel")}</label>
            <Select onValueChange={(value) => setModelSelections((current) => ({ ...current, [activeDefinition.providerId]: value }))} value={selectedModelId}>
              <SelectTrigger className="quick-model-setup__select"><SelectValue placeholder={t("quickModelSetupSelectModel")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                {models.map((model) => <SelectItem key={model.modelId} value={model.modelId}><span className="flex items-center gap-2"><span>{model.displayName}</span>{model.modelId === activeDefinition.recommendedModelId ? <span className="quick-model-setup__recommended">{t("quickModelSetupRecommended")}</span> : null}</span></SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="quick-model-setup__error" role="alert">{error}</p> : <p className="quick-model-setup__privacy"><Check />{t("quickModelSetupLocalKey")}</p>}
        </div>

        <footer className="quick-model-setup__footer">
          <div className="quick-model-setup__actions">
            <Button className="quick-model-setup__advanced" disabled={saving} onClick={onAdvanced} type="button" variant="ghost"><Settings2 />{t("quickModelSetupAdvanced")}</Button>
            <Button className="quick-model-setup__submit" disabled={saving || !activeProvider || !selectedModelId || (!apiKey.trim() && !activeProvider.apiKeyConfigured)} onClick={() => void submit()} type="button">
              {saving ? <LoaderCircle className="animate-spin" /> : <Check />}{saving ? t("quickModelSetupSaving") : t("quickModelSetupEnable")}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
