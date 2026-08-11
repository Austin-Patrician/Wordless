import * as Popover from "@radix-ui/react-popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@wordless/ui-kit";
import type { ConfiguredModelSummary, MediaAsset, MediaImageParameters, MediaOperationKind } from "@wordless/domain";
import { GripHorizontal, ImagePlus, LoaderCircle, Send, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "../settings/provider-icons";
import { mediaOperationDefinition } from "./media-operations";

type ComposerValue = { prompt: string; modelKey: string; ratio: string; outputCount: number; imageParameters?: MediaImageParameters };

export function MediaComposer({ action, busy, error, initialValue, locale, models, onAddReferences, onCancel, onModelChange, onOpenModels, onRemoveReference, onSubmit, references, variant = "node" }: {
  action: Exclude<MediaOperationKind, "upload" | "crop">;
  busy?: boolean;
  error?: string | null;
  initialValue: ComposerValue;
  locale: "zh-CN" | "en-US";
  models: ConfiguredModelSummary[];
  onAddReferences?: () => void;
  onCancel?: () => void;
  onModelChange?: (modelKey: string) => void;
  onOpenModels: () => void;
  onRemoveReference: (assetId: string) => void;
  onSubmit: (value: ComposerValue) => void;
  references: MediaAsset[];
  variant?: "node" | "root" | "inline";
}) {
  const [value, setValue] = useState(initialValue);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const composing = useRef(false);
  useEffect(() => {
    if (initialValue.modelKey) setValue((current) => current.modelKey ? current : { ...current, modelKey: initialValue.modelKey });
  }, [initialValue.modelKey]);
  const selectedModel = models.find((model) => `${model.providerId}:${model.modelId}` === value.modelKey);
  const capabilities = selectedModel?.imageCapabilities;
  const ratios = useMemo(() => capabilities?.aspectRatios?.length ? capabilities.aspectRatios : ["16:9", "4:3", "1:1", "3:4", "9:16"], [capabilities?.aspectRatios]);
  const maxOutputCount = Math.max(1, Math.min(4, capabilities?.maxOutputImages ?? 4));
  const referenceLimit = capabilities?.maxReferenceImages ?? (selectedModel?.supportsVision ? 1 : 0);
  const outputCounts = useMemo(() => Array.from({ length: maxOutputCount }, (_, index) => index + 1), [maxOutputCount]);
  const hasAdvancedControls = Boolean(capabilities?.resolutions?.length || capabilities?.qualityLevels?.length || capabilities?.outputFormats?.length || capabilities?.supportsSeed || capabilities?.supportsWatermark);
  const referenceLimitError = selectedModel && references.length > referenceLimit
    ? locale === "zh-CN"
      ? `当前模型最多支持 ${referenceLimit} 张参考图片`
      : `This model supports up to ${referenceLimit} reference image${referenceLimit === 1 ? "" : "s"}`
    : null;
  const canSubmit = value.prompt.trim().length > 0 && selectedModel !== undefined && referenceLimitError === null && !busy;
  const definition = mediaOperationDefinition(action);
  useEffect(() => {
    if (!selectedModel) return;
    if (!hasAdvancedControls) setAdvancedOpen(false);
    setValue((current) => {
      const nextRatio = ratios.includes(current.ratio) ? current.ratio : ratios[0] ?? current.ratio;
      const nextOutputCount = Math.min(current.outputCount, maxOutputCount);
      const parameters = { ...(current.imageParameters ?? {}) };
      if (!capabilities?.resolutions?.includes(parameters.resolution ?? "")) delete parameters.resolution;
      if (!capabilities?.qualityLevels?.includes(parameters.quality ?? "")) delete parameters.quality;
      if (!capabilities?.outputFormats?.includes(parameters.outputFormat ?? "")) delete parameters.outputFormat;
      if (!capabilities?.supportsSeed) delete parameters.seed;
      if (!capabilities?.supportsWatermark) delete parameters.watermark;
      return { ...current, ratio: nextRatio, outputCount: nextOutputCount, imageParameters: Object.keys(parameters).length > 0 ? parameters : undefined };
    });
  }, [capabilities, hasAdvancedControls, maxOutputCount, ratios, selectedModel]);
  function updateImageParameter<Key extends keyof MediaImageParameters>(key: Key, parameter: MediaImageParameters[Key] | undefined) {
    setValue((current) => {
      const imageParameters: MediaImageParameters = { ...(current.imageParameters ?? {}) };
      if (parameter === undefined) delete imageParameters[key];
      else imageParameters[key] = parameter;
      return { ...current, imageParameters: Object.keys(imageParameters).length > 0 ? imageParameters : undefined };
    });
  }
  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ ...value, prompt: value.prompt.trim(), modelKey: selectedModel ? `${selectedModel.providerId}:${selectedModel.modelId}` : value.modelKey });
    if (variant === "root") setValue((current) => ({ ...current, prompt: "" }));
  };
  return (
    <section className={`nopan nowheel overflow-hidden border bg-card text-card-foreground shadow-[0_16px_42px_rgba(0,0,0,.16)] ${variant === "root" ? "w-[min(680px,calc(100vw-5rem))] rounded-[10px] border-border" : variant === "inline" ? "w-[800px] rounded-[8px] border-[#575b51] dark:border-[#54584e]" : "w-[390px] rounded-[8px] border-[#575b51] dark:border-[#54584e]"}`} onClick={(event) => event.stopPropagation()}>
      {variant === "node" ? <header className="flex h-7 items-center justify-between border-b border-border/75 px-1.5"><span aria-label={locale === "zh-CN" ? "拖拽草稿节点" : "Drag draft node"} className="flex h-full flex-1 cursor-grab items-center text-muted-foreground active:cursor-grabbing"><GripHorizontal className="h-3.5 w-3.5" /></span>{onAddReferences ? <button aria-label={locale === "zh-CN" ? "添加参考图片" : "Add reference images"} className="nodrag grid h-5 w-5 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onAddReferences} title={locale === "zh-CN" ? "添加参考图片" : "Add reference images"} type="button"><ImagePlus className="h-3.5 w-3.5" /></button> : null}</header> : null}
      {references.length > 0 ? <div className="nodrag flex gap-2 overflow-x-auto border-b border-border px-3 py-2.5">{references.map((asset) => <div className="group/reference relative h-12 w-12 shrink-0 overflow-hidden rounded-[5px] border border-border bg-muted" key={asset.id}>{asset.url ? <img alt={asset.name} className="h-full w-full object-cover" src={asset.url} /> : null}<button aria-label={locale === "zh-CN" ? "移除参考图片" : "Remove reference image"} className="absolute right-0.5 top-0.5 hidden h-4 w-4 place-items-center rounded-full bg-black/75 text-white group-hover/reference:grid" onClick={() => onRemoveReference(asset.id)} type="button"><X className="h-2.5 w-2.5" /></button></div>)}</div> : null}
      <textarea
        aria-label={locale === "zh-CN" ? "图片提示词" : "Image prompt"}
        className={`nodrag block w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground ${variant === "root" ? "min-h-[116px] px-4 py-4 text-[13px] leading-6" : "min-h-[124px] px-3.5 py-3 text-[4px] leading-3"}`}
        onChange={(event) => setValue((current) => ({ ...current, prompt: event.target.value }))}
        onCompositionEnd={() => { composing.current = false; }}
        onCompositionStart={() => { composing.current = true; }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !composing.current) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={definition.defaultPrompt[locale] || (locale === "zh-CN" ? "描述你想生成的图片…" : "Describe the image you want to create…")}
        value={value.prompt}
      />
      {referenceLimitError ? <p className="nodrag border-t border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300" role="alert">{referenceLimitError}</p> : null}
      {error ? <p className="nodrag border-t border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] leading-4 text-red-600 dark:text-red-300">{error}</p> : null}
      <footer className={`nodrag flex min-w-0 items-center justify-between border-t border-border bg-muted/25 ${variant === "root" ? "gap-2 px-3 py-2" : "gap-1.5 px-2.5 py-1.5"}`}>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          {models.length ? <Select onValueChange={(modelKey) => { setValue((current) => ({ ...current, modelKey })); onModelChange?.(modelKey); }} value={value.modelKey || undefined}><SelectTrigger className="h-7 min-w-0 max-w-[150px] flex-1 overflow-hidden border-0 bg-transparent px-0 shadow-none focus:ring-0"><SelectValue asChild><span className="flex min-w-0 items-center gap-1.5 overflow-hidden">{selectedModel ? <><ProviderMark avatarId={selectedModel.providerAvatarId} providerId={selectedModel.providerId} /><span className="min-w-0 truncate" title={selectedModel.displayName}>{selectedModel.displayName}</span></> : <span className="truncate text-muted-foreground">{locale === "zh-CN" ? "选择模型" : "Select model"}</span>}</span></SelectValue></SelectTrigger><SelectContent className="max-h-64" style={{ width: "min(360px, calc(100vw - 4rem))" }}>{models.map((model) => <SelectItem className="py-2" key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}:${model.modelId}`}><span className="flex min-w-0 items-start gap-2"><ProviderMark avatarId={model.providerAvatarId} providerId={model.providerId} /><span className="min-w-0 whitespace-normal break-words leading-4">{model.displayName}</span></span></SelectItem>)}</SelectContent></Select> : <button className="flex items-center gap-1.5 text-[#74883b] hover:underline dark:text-[#c8e976]" onClick={onOpenModels} type="button"><ImagePlus className="h-3.5 w-3.5" />{locale === "zh-CN" ? "配置模型" : "Configure model"}</button>}
          <Select onValueChange={(ratio) => setValue((current) => ({ ...current, ratio }))} value={value.ratio}><SelectTrigger aria-label={locale === "zh-CN" ? "图片比例" : "Image aspect ratio"} className="h-7 w-[54px] border-0 bg-transparent px-0 shadow-none focus:ring-0"><SelectValue /></SelectTrigger><SelectContent>{ratios.map((ratio) => <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>)}</SelectContent></Select>
          <Select onValueChange={(outputCount) => setValue((current) => ({ ...current, outputCount: Number(outputCount) }))} value={String(value.outputCount)}><SelectTrigger aria-label={locale === "zh-CN" ? "生成数量" : "Output count"} className="h-7 w-[48px] border-0 bg-transparent px-0 shadow-none focus:ring-0"><SelectValue /></SelectTrigger><SelectContent>{outputCounts.map((count) => <SelectItem key={count} value={String(count)}>{count}×</SelectItem>)}</SelectContent></Select>
          {hasAdvancedControls ? <Popover.Root onOpenChange={setAdvancedOpen} open={advancedOpen}><Popover.Trigger asChild><button aria-expanded={advancedOpen} aria-label={locale === "zh-CN" ? "高级图片参数" : "Advanced image settings"} className={`grid h-7 w-7 place-items-center rounded-[5px] transition-colors ${advancedOpen || value.imageParameters ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title={locale === "zh-CN" ? "高级图片参数" : "Advanced image settings"} type="button"><SlidersHorizontal className="h-3.5 w-3.5" /></button></Popover.Trigger><Popover.Portal><Popover.Content align="end" className="z-[100] w-[280px] rounded-[8px] border border-border bg-card p-3 shadow-[0_16px_40px_rgba(0,0,0,.2)] outline-none" side="top" sideOffset={8}>
            <div className="flex items-center justify-between"><p className="text-[12px] font-semibold">{locale === "zh-CN" ? "高级参数" : "Advanced settings"}</p><button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => { setValue((current) => ({ ...current, imageParameters: undefined })); }} type="button">{locale === "zh-CN" ? "重置" : "Reset"}</button></div>
            <div className="mt-3 grid gap-2.5">
              {capabilities?.resolutions?.length ? <ParameterSelect label={locale === "zh-CN" ? "分辨率" : "Resolution"} onChange={(next) => updateImageParameter("resolution", next === "auto" ? undefined : next)} options={capabilities.resolutions} value={value.imageParameters?.resolution} /> : null}
              {capabilities?.qualityLevels?.length ? <ParameterSelect label={locale === "zh-CN" ? "质量" : "Quality"} onChange={(next) => updateImageParameter("quality", next === "auto" ? undefined : next)} options={capabilities.qualityLevels} value={value.imageParameters?.quality} /> : null}
              {capabilities?.outputFormats?.length ? <ParameterSelect label={locale === "zh-CN" ? "输出格式" : "Output format"} onChange={(next) => updateImageParameter("outputFormat", next === "auto" ? undefined : next)} options={capabilities.outputFormats} value={value.imageParameters?.outputFormat} /> : null}
              {capabilities?.supportsSeed ? <label className="block"><span className="mb-1 block text-[10px] font-medium text-muted-foreground">Seed</span><input className="h-8 w-full rounded-[5px] border border-input bg-background px-2 text-[11px] outline-none focus:border-[#83965a] dark:bg-[#181912]" min="0" onChange={(event) => { const next = event.target.value.trim(); updateImageParameter("seed", next ? Math.max(0, Math.floor(Number(next) || 0)) : undefined); }} placeholder={locale === "zh-CN" ? "随机" : "Random"} type="number" value={value.imageParameters?.seed ?? ""} /></label> : null}
              {capabilities?.supportsWatermark ? <label className="flex h-8 items-center justify-between gap-3"><span className="text-[11px] font-medium text-foreground">{locale === "zh-CN" ? "添加水印" : "Add watermark"}</span><Switch aria-label={locale === "zh-CN" ? "添加水印" : "Add watermark"} checked={value.imageParameters?.watermark ?? false} onCheckedChange={(checked) => updateImageParameter("watermark", checked)} /></label> : null}
            </div>
          </Popover.Content></Popover.Portal></Popover.Root> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{onCancel ? <button aria-label={locale === "zh-CN" ? "取消" : "Cancel"} className="grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted" onClick={onCancel} type="button"><X className="h-3.5 w-3.5" /></button> : null}<button aria-label={definition.label[locale]} className="grid h-8 w-8 place-items-center rounded-[6px] bg-accent text-accent-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-40" disabled={!canSubmit} onClick={submit} title={`${definition.label[locale]} (Ctrl+Enter)`} type="button">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></div>
      </footer>
    </section>
  );
}

function ProviderMark({ avatarId, providerId }: { avatarId: ConfiguredModelSummary["providerAvatarId"] | undefined; providerId: string | undefined }) {
  return <ProviderIcon avatarId={avatarId} className="h-3.5 w-3.5 shrink-0 object-contain" providerId={providerId} />;
}

function ParameterSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string | undefined }) {
  return <label className="block"><span className="mb-1 block text-[10px] font-medium text-muted-foreground">{label}</span><Select onValueChange={onChange} value={value ?? "auto"}><SelectTrigger className="h-8 w-full border-input bg-background px-2 text-[11px] shadow-none dark:bg-[#181912]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">Auto</SelectItem>{options.filter((option) => option !== "auto").map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></label>;
}

export type { ComposerValue };
