import { Button, Slider } from "@wordless/ui-kit";
import { Check, CircleOff, LoaderCircle, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { AppearancePreferences, BackgroundFit, BackgroundSource } from "@wordless/domain";
import { backgroundPreviewStyle, builtinBackgrounds } from "../appearance/backgrounds";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";

const defaultAppearance: AppearancePreferences = {
  background: {
    source: { kind: "none" },
    fit: "cover",
    position: { x: 50, y: 50 },
    intensity: 40,
    blurPx: 0,
  },
};

const positions = [
  { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 },
  { x: 0, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 50 },
  { x: 0, y: 100 }, { x: 50, y: 100 }, { x: 100, y: 100 },
];

function sameSource(left: BackgroundSource, right: BackgroundSource): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "builtin" && right.kind === "builtin") return left.id === right.id;
  if (left.kind === "custom" && right.kind === "custom") return left.assetId === right.assetId;
  return true;
}

function BackgroundChoice({ active, label, onClick, source, fit, position }: { active: boolean; label: string; onClick: () => void; source: BackgroundSource; fit: BackgroundFit; position: { x: number; y: number } }) {
  return (
    <button aria-pressed={active} className={`group min-w-0 rounded-[8px] border p-1.5 text-left transition-colors ${active ? "border-[#829352] bg-[#f8faef] shadow-[0_1px_2px_rgba(37,38,36,0.08)] dark:border-[#b7d85a] dark:bg-[#293019]" : "border-[#deded8] bg-white hover:border-[#bfc3af] dark:border-border dark:bg-card dark:hover:border-[#697252]"}`} onClick={onClick} type="button">
      <span className="relative block aspect-[16/9] overflow-hidden rounded-[5px] bg-[#efefeb] dark:bg-[#292b23]"><span className="absolute inset-0" style={backgroundPreviewStyle(source, fit, position)} />{source.kind !== "none" ? <span className="absolute inset-0 bg-white/35 dark:bg-black/30" /> : <CircleOff className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-[#909089]" />}{active ? <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-[#2d3321] text-white dark:bg-[#d4ef75] dark:text-[#202610]"><Check className="h-2.5 w-2.5" /></span> : null}</span>
      <span className="mt-1.5 flex min-w-0 items-center gap-1 text-[10px] font-medium text-[#565650] dark:text-foreground"><span className="min-w-0 flex-1 truncate">{label}</span></span>
    </button>
  );
}

export function PersonalizationSettings() {
  const client = useRuntimeClient();
  const { appearance, previewAppearance, setAppearance, t } = usePreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { background } = appearance;
  const hasBackground = background.source.kind !== "none";
  const customSource = background.source.kind === "custom" ? background.source : null;

  const updateBackground = (patch: Partial<AppearancePreferences["background"]>, persist: boolean) => {
    const next: AppearancePreferences = { ...appearance, background: { ...background, ...patch } };
    if (persist) void setAppearance(next);
    else previewAppearance(next);
  };

  const selectSource = async (source: BackgroundSource) => {
    const previousAssetId = customSource?.assetId;
    setError(null);
    try {
      await setAppearance({ ...appearance, background: { ...background, source } });
      if (previousAssetId && (source.kind !== "custom" || source.assetId !== previousAssetId)) await client.removeAppearanceBackground(previousAssetId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const uploadBackground = async (file: File) => {
    const previousAssetId = customSource?.assetId;
    setUploading(true);
    setError(null);
    try {
      const asset = await client.importAppearanceBackground(file);
      await setAppearance({ ...appearance, background: { ...background, source: { kind: "custom", assetId: asset.assetId } } });
      if (previousAssetId && previousAssetId !== asset.assetId) await client.removeAppearanceBackground(previousAssetId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  const removeCustomBackground = async () => {
    if (!customSource) return;
    const assetId = customSource.assetId;
    setError(null);
    try {
      await setAppearance({ ...appearance, background: { ...background, source: { kind: "none" } } });
      await client.removeAppearanceBackground(assetId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const resetBackground = async () => {
    const assetId = customSource?.assetId;
    setError(null);
    try {
      await setAppearance(defaultAppearance);
      if (assetId) await client.removeAppearanceBackground(assetId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
      <div className="mx-auto max-w-[680px] space-y-4">
        <section className="overflow-hidden rounded-[10px] border border-[#e2e2dc] bg-white dark:border-border dark:bg-card">
          <div className="flex items-center justify-between border-b border-[#e7e7e1] px-4 py-3 dark:border-border"><div><p className="text-[13px] font-semibold">{t("backgroundPreview")}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{t("backgroundHelp")}</p></div><Button aria-label={t("resetBackground")} className="text-muted-foreground" onClick={() => void resetBackground()} size="icon" title={t("resetBackground")} type="button" variant="ghost"><RotateCcw className="h-3.5 w-3.5" /></Button></div>
          <div className="relative aspect-[16/7] overflow-hidden bg-[#f1f1ed] dark:bg-[#24261f]"><div className="absolute inset-0" style={{ ...backgroundPreviewStyle(background.source, background.fit, background.position), filter: background.blurPx > 0 ? `blur(${background.blurPx}px)` : undefined, opacity: background.intensity / 100, transform: background.blurPx > 0 ? "scale(1.025)" : undefined }} /><div className="absolute inset-0 bg-white/35 dark:bg-black/45" /><div className="absolute inset-x-5 top-4 h-5 rounded-[4px] border border-[#d7d7d1]/80 bg-white/80 dark:border-white/10 dark:bg-[#262820]/80" /><div className="absolute bottom-4 left-5 w-[42%] rounded-[6px] border border-[#deded8]/80 bg-white/88 p-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[#202219]/88"><span className="block h-1.5 w-24 rounded-full bg-[#44443f]/75 dark:bg-[#e9ece0]/75" /><span className="mt-2 block h-1.5 w-full rounded-full bg-[#a3a39c]/45" /><span className="mt-1.5 block h-1.5 w-3/4 rounded-full bg-[#a3a39c]/35" /></div></div>
        </section>

        <section className="rounded-[10px] bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <div><p className="text-[13px] font-semibold">{t("background")}</p><p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("backgroundHelp")}</p></div>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <BackgroundChoice active={background.source.kind === "none"} fit={background.fit} label={t("backgroundNone")} onClick={() => void selectSource({ kind: "none" })} position={background.position} source={{ kind: "none" }} />
            {builtinBackgrounds.map((definition) => <BackgroundChoice active={sameSource(background.source, { kind: "builtin", id: definition.id })} fit={background.fit} key={definition.id} label={t(definition.nameKey)} onClick={() => void selectSource({ kind: "builtin", id: definition.id })} position={background.position} source={{ kind: "builtin", id: definition.id }} />)}
            <BackgroundChoice active={customSource !== null} fit={background.fit} label={t("backgroundCustom")} onClick={() => fileInputRef.current?.click()} position={background.position} source={customSource ?? { kind: "none" }} />
          </div>
          <input accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadBackground(file); }} ref={fileInputRef} type="file" />
          <div className="mt-4 flex flex-wrap items-center gap-2"><Button className="h-8 gap-1.5 border border-[#d6d6cf] bg-white px-3 text-[11px] text-[#45453f] hover:bg-[#f1f1ed] dark:border-border dark:bg-card dark:text-foreground" disabled={uploading} onClick={() => fileInputRef.current?.click()} type="button" variant="ghost">{uploading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{uploading ? t("backgroundUploading") : customSource ? t("replaceBackground") : t("uploadBackground")}</Button>{customSource ? <Button aria-label={t("removeBackground")} className="h-8 text-[#956356] hover:bg-[#f5ece8] hover:text-[#7b493d] dark:text-[#e5a395] dark:hover:bg-[#3a2521]" disabled={uploading} onClick={() => void removeCustomBackground()} size="icon" title={t("removeBackground")} type="button" variant="ghost"><Trash2 className="h-3.5 w-3.5" /></Button> : null}<span className="text-[10px] text-muted-foreground">{t("backgroundFileHint")}</span></div>
          {error ? <p className="mt-3 text-[11px] leading-5 text-destructive" role="alert">{error}</p> : null}
        </section>

        <section className={`rounded-[10px] bg-[#f7f7f5] p-4 transition-opacity dark:bg-[#22241c] ${hasBackground ? "" : "opacity-50"}`}>
          <div className="flex items-center justify-between gap-4"><div><p className="text-[13px] font-semibold">{t("backgroundFit")}</p><p className="mt-1 text-[11px] text-muted-foreground">{t("backgroundPosition")}</p></div><div className="flex rounded-[7px] border border-[#d8d8d2] bg-white p-0.5 dark:border-border dark:bg-card">{(["cover", "contain", "tile"] as BackgroundFit[]).map((fit) => <button aria-pressed={background.fit === fit} className={`h-7 rounded-[5px] px-2.5 text-[10px] font-medium transition-colors ${background.fit === fit ? "bg-[#30312e] text-white dark:bg-[#d8ef79] dark:text-[#202610]" : "text-[#686860] hover:bg-[#efefeb] dark:text-muted-foreground dark:hover:bg-muted"}`} disabled={!customSource} key={fit} onClick={() => updateBackground({ fit }, true)} type="button">{fit === "cover" ? t("backgroundFill") : fit === "contain" ? t("backgroundContain") : t("backgroundTile")}</button>)}</div></div>
          <div className="mt-4 flex items-center justify-between gap-5"><div className="grid grid-cols-3 gap-1" role="group" aria-label={t("backgroundPosition")}>{positions.map((position) => <button aria-label={`${t("backgroundPosition")}: ${position.x}, ${position.y}`} aria-pressed={background.position.x === position.x && background.position.y === position.y} className={`grid h-7 w-7 place-items-center rounded-[4px] transition-colors ${background.position.x === position.x && background.position.y === position.y ? "bg-[#30312e] dark:bg-[#d8ef79]" : "hover:bg-[#e7e7e2] dark:hover:bg-muted"}`} disabled={!customSource || background.fit === "tile"} key={`${position.x}-${position.y}`} onClick={() => updateBackground({ position }, true)} type="button"><span className={`h-1.5 w-1.5 rounded-full ${background.position.x === position.x && background.position.y === position.y ? "bg-white dark:bg-[#202610]" : "bg-[#97978f] dark:bg-[#979b8d]"}`} /></button>)}</div><p className="max-w-[300px] text-right text-[11px] leading-5 text-muted-foreground">{customSource ? t("backgroundFileHint") : t("backgroundCustom")}</p></div>
        </section>

        <section className={`rounded-[10px] bg-[#f7f7f5] p-4 transition-opacity dark:bg-[#22241c] ${hasBackground ? "" : "opacity-50"}`}>
          <SliderControl disabled={!hasBackground} label={t("backgroundIntensity")} max={100} min={0} onChange={(value) => updateBackground({ intensity: value }, false)} onCommit={(value) => updateBackground({ intensity: value }, true)} suffix="%" value={background.intensity} />
          <div className="mt-5 border-t border-[#e2e2dc] pt-5 dark:border-border"><SliderControl disabled={!hasBackground} label={t("backgroundBlur")} max={16} min={0} onChange={(value) => updateBackground({ blurPx: value }, false)} onCommit={(value) => updateBackground({ blurPx: value }, true)} suffix="px" value={background.blurPx} /></div>
        </section>
      </div>
    </div>
  );
}

function SliderControl({ disabled, label, max, min, onChange, onCommit, suffix, value }: { disabled: boolean; label: string; max: number; min: number; onChange: (value: number) => void; onCommit: (value: number) => void; suffix: string; value: number }) {
  return <div><div className="flex items-center justify-between"><p className="text-[13px] font-semibold">{label}</p><span className="font-mono text-[10px] text-muted-foreground">{value}{suffix}</span></div><Slider className="mt-4" disabled={disabled} max={max} min={min} onValueChange={(next) => onChange(next[0] ?? value)} onValueCommit={(next) => onCommit(next[0] ?? value)} step={1} value={[value]} /></div>;
}
