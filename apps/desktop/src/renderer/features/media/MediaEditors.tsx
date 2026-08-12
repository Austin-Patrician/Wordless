import { Dialog, DialogClose, DialogContent, DialogTitle, Slider } from "@wordless/ui-kit";
import type { MediaAsset, MediaCropRect, MediaInlineImage, MediaViewAngle } from "@wordless/domain";
import eyeLevelPreview from "../../../icons/multi-insight/01-eye-level.webp";
import highAnglePreview from "../../../icons/multi-insight/02-high-angle.webp";
import lowAnglePreview from "../../../icons/multi-insight/03-low-angle.webp";
import threeQuarterPreview from "../../../icons/multi-insight/04-three-quarter.webp";
import profilePreview from "../../../icons/multi-insight/05-profile.webp";
import birdsEyePreview from "../../../icons/multi-insight/06-birds-eye.webp";
import fishEyePreview from "../../../icons/multi-insight/07-fish-eye.webp";
import wormsEyePreview from "../../../icons/multi-insight/08-worms-eye.webp";
import wideAnglePreview from "../../../icons/multi-insight/09-wide-angle.webp";
import { ArrowUp, Brush, Check, ChevronDown, Crop, Eraser, Redo2, Rotate3D, Undo2, X } from "lucide-react";
import * as THREE from "three";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

type Locale = "zh-CN" | "en-US";

export function ImagePreviewDialog({ asset, onOpenChange, open }: { asset: MediaAsset | null; onOpenChange: (open: boolean) => void; open: boolean }) {
  return <Dialog onOpenChange={onOpenChange} open={open}><DialogContent className="h-[min(86vh,820px)] w-[min(92vw,1160px)] rounded-none border-0 bg-transparent p-0 shadow-none" showCloseButton={false}><DialogTitle className="sr-only">Image preview</DialogTitle>{asset?.url ? <div className="grid h-full w-full place-items-center"><div className="relative inline-block max-h-full max-w-full"><img alt={asset.name} className="block max-h-[min(86vh,820px)] max-w-[min(92vw,1160px)] object-contain" src={asset.url} /><DialogClose asChild><button aria-label="Close image preview" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[#1b1c18] shadow-[0_2px_10px_rgba(0,0,0,.28)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80" type="button"><X className="h-4 w-4" /></button></DialogClose></div></div> : null}</DialogContent></Dialog>;
}

export function ImageCropEditor({ asset, locale, onCancel, onConfirm, source }: { asset: MediaAsset; locale: Locale; onCancel: () => void; onConfirm: (crop: MediaCropRect, image: MediaInlineImage) => void; source: MediaInlineImage }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<CropDrag | null>(null);
  const [crop, setCrop] = useState<MediaCropRect>({ x: 0.06, y: 0.06, width: 0.88, height: 0.88 });
  const [naturalRatio, setNaturalRatio] = useState(1);
  const [presetOpen, setPresetOpen] = useState(false);
  const [preset, setPreset] = useState("custom");

  const updateCropFromPointer = useCallback((event: globalThis.PointerEvent) => {
    const drag = dragRef.current;
    const image = imageRef.current;
    if (!drag || !image) return;
    const rect = image.getBoundingClientRect();
    const dx = (event.clientX - drag.startX) / Math.max(1, rect.width);
    const dy = (event.clientY - drag.startY) / Math.max(1, rect.height);
    const next = { ...drag.crop };
    if (drag.handle === "move") {
      next.x = clamp(drag.crop.x + dx, 0, 1 - drag.crop.width);
      next.y = clamp(drag.crop.y + dy, 0, 1 - drag.crop.height);
    } else {
      if (drag.handle.includes("w")) {
        const right = drag.crop.x + drag.crop.width;
        next.x = clamp(drag.crop.x + dx, 0, right - 0.06);
        next.width = right - next.x;
      }
      if (drag.handle.includes("e")) next.width = clamp(drag.crop.width + dx, 0.06, 1 - drag.crop.x);
      if (drag.handle.includes("n")) {
        const bottom = drag.crop.y + drag.crop.height;
        next.y = clamp(drag.crop.y + dy, 0, bottom - 0.06);
        next.height = bottom - next.y;
      }
      if (drag.handle.includes("s")) next.height = clamp(drag.crop.height + dy, 0.06, 1 - drag.crop.y);
    }
    setCrop(next);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: globalThis.PointerEvent) => updateCropFromPointer(event);
    const onPointerUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [updateCropFromPointer]);

  const startDrag = (handle: CropHandle, event: PointerEvent) => {
    if (handle === "move" && event.target === imageRef.current) return;
    event.preventDefault();
    setPreset("custom");
    dragRef.current = { handle, startX: event.clientX, startY: event.clientY, crop };
  };

  const selectPreset = (value: CropPreset) => {
    setPreset(value.id);
    setPresetOpen(false);
    if (value.id === "original") {
      setCrop({ x: 0, y: 0, width: 1, height: 1 });
    } else if (value.ratio !== null) {
      setCrop(fitCropToRatio(value.ratio, naturalRatio));
    }
  };

  const confirm = useCallback(() => {
    const image = imageRef.current;
    if (!image || image.naturalWidth === 0 || image.naturalHeight === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * crop.width));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * crop.height));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, image.naturalWidth * crop.x, image.naturalHeight * crop.y, image.naturalWidth * crop.width, image.naturalHeight * crop.height, 0, 0, canvas.width, canvas.height);
    onConfirm(crop, { mimeType: "image/png", data: canvas.toDataURL("image/png").split(",")[1] ?? "" });
  }, [crop, onConfirm]);

  return <div className="absolute inset-0 z-[100] flex flex-col bg-[#11120f]/95 p-5 text-white backdrop-blur-sm">
    <header className="flex items-center justify-between"><div className="flex items-center gap-2 text-[13px] font-semibold"><Crop className="h-4 w-4 text-[#ccf257]" />{locale === "zh-CN" ? "裁剪" : "Crop"}</div><button aria-label={locale === "zh-CN" ? "关闭" : "Close"} className="grid h-8 w-8 place-items-center rounded-[6px] text-white/60 hover:bg-white/10 hover:text-white" onClick={onCancel} type="button"><X className="h-4 w-4" /></button></header>
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center">
      <div className="relative max-h-[min(66vh,600px)] max-w-[min(86vw,980px)]">
        <img alt={asset.name} className="block max-h-[min(66vh,600px)] max-w-[min(86vw,980px)] select-none object-contain" onLoad={(event) => { const image = event.currentTarget; setNaturalRatio(image.naturalWidth / Math.max(1, image.naturalHeight)); }} ref={imageRef} src={`data:${source.mimeType};base64,${source.data}`} />
        <div className="absolute cursor-move border border-white shadow-[0_0_0_9999px_rgba(0,0,0,.58)]" onPointerDown={(event) => startDrag("move", event)} style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_33%,rgba(255,255,255,.28)_33%,rgba(255,255,255,.28)_33.5%,transparent_33.5%,transparent_66%,rgba(255,255,255,.28)_66%,rgba(255,255,255,.28)_66.5%,transparent_66.5%),linear-gradient(to_bottom,transparent_33%,rgba(255,255,255,.28)_33%,rgba(255,255,255,.28)_33.5%,transparent_33.5%,transparent_66%,rgba(255,255,255,.28)_66%,rgba(255,255,255,.28)_66.5%,transparent_66.5%)]" />
          {(["nw", "ne", "sw", "se"] as const).map((handle) => <button aria-label={handle} className={`absolute h-5 w-5 border-white ${handle.includes("n") ? "top-[-2px] cursor-ns-resize border-t-2" : "bottom-[-2px] cursor-ns-resize border-b-2"} ${handle.includes("w") ? "left-[-2px] cursor-ew-resize border-l-2" : "right-[-2px] cursor-ew-resize border-r-2"}`} key={handle} onPointerDown={(event) => { event.stopPropagation(); startDrag(handle, event); }} type="button" />)}
        </div>
      </div>
      <div className="relative mt-4 flex h-14 items-center gap-3 rounded-full border border-white/10 bg-[#252622] px-2 shadow-[0_10px_28px_rgba(0,0,0,.24)]">
        <button aria-label={locale === "zh-CN" ? "取消裁剪" : "Cancel crop"} className="flex h-10 items-center gap-2 rounded-full px-3 text-[12px] font-semibold text-white/70 hover:bg-white/10 hover:text-white" onClick={onCancel} type="button"><X className="h-4 w-4" />{locale === "zh-CN" ? "裁剪" : "Crop"}</button>
        <span className="h-6 w-px bg-white/10" />
        <div className="relative"><button className="flex h-10 items-center gap-2 rounded-full px-3 text-[12px] font-semibold hover:bg-white/10" onClick={() => setPresetOpen((current) => !current)} type="button"><Crop className="h-4 w-4" />{cropPresetLabel(preset, locale)}<ChevronDown className="h-3.5 w-3.5" /></button>{presetOpen ? <div className="absolute bottom-[48px] left-1/2 z-20 grid w-[330px] -translate-x-1/2 grid-cols-4 gap-1.5 rounded-[12px] border border-white/10 bg-[#242520] p-2 shadow-[0_16px_40px_rgba(0,0,0,.34)]">{cropPresets.map((item) => <button className={`flex h-[62px] flex-col items-center justify-center gap-1 rounded-[8px] text-[10px] font-semibold ${preset === item.id ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`} key={item.id} onClick={() => selectPreset(item)} type="button"><span className="h-5 border border-current" style={{ width: item.ratio ? `${clamp(item.ratio * 20, 8, 32)}px` : "20px" }} />{item.label[locale]}</button>)}</div> : null}</div>
        <span className="h-6 w-px bg-white/10" /><button aria-label={locale === "zh-CN" ? "确定裁剪" : "Apply crop"} className="grid h-10 min-w-[72px] place-items-center rounded-full bg-accent px-4 text-[12px] font-semibold text-accent-foreground hover:brightness-95" onClick={confirm} type="button">{locale === "zh-CN" ? "确定" : "Apply"}</button>
      </div>
    </main>
  </div>;
}

type CropHandle = "move" | "nw" | "ne" | "sw" | "se";
type CropDrag = { handle: CropHandle; startX: number; startY: number; crop: MediaCropRect };
type CropPreset = { id: string; ratio: number | null; label: { "zh-CN": string; "en-US": string } };
const cropPresets: CropPreset[] = [
  { id: "original", ratio: null, label: { "zh-CN": "原始比例", "en-US": "Original" } },
  { id: "custom", ratio: null, label: { "zh-CN": "自定义", "en-US": "Custom" } },
  { id: "1:1", ratio: 1, label: { "zh-CN": "1:1", "en-US": "1:1" } },
  { id: "2:3", ratio: 2 / 3, label: { "zh-CN": "2:3", "en-US": "2:3" } },
  { id: "3:4", ratio: 3 / 4, label: { "zh-CN": "3:4", "en-US": "3:4" } },
  { id: "16:9", ratio: 16 / 9, label: { "zh-CN": "16:9", "en-US": "16:9" } },
  { id: "9:16", ratio: 9 / 16, label: { "zh-CN": "9:16", "en-US": "9:16" } },
  { id: "3:2", ratio: 3 / 2, label: { "zh-CN": "3:2", "en-US": "3:2" } },
];
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function fitCropToRatio(outputRatio: number, imageRatio: number): MediaCropRect { const normalizedRatio = outputRatio / Math.max(0.01, imageRatio); let width = 0.88; let height = width / normalizedRatio; if (height > 0.88) { height = 0.88; width = height * normalizedRatio; } return { x: (1 - width) / 2, y: (1 - height) / 2, width, height }; }
function cropPresetLabel(id: string, locale: Locale): string { return cropPresets.find((preset) => preset.id === id)?.label[locale] ?? cropPresets[1].label[locale]; }

export function ImageMaskEditor({ action, asset, initialPrompt, locale, onCancel, onConfirm, title }: { action: "local-edit" | "remove-object"; asset: MediaAsset; initialPrompt: string; locale: Locale; onCancel: () => void; onConfirm: (image: MediaInlineImage, prompt: string) => void; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPointRef = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(44);
  const [mode, setMode] = useState<"brush" | "erase">("brush");
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [maskError, setMaskError] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number } | null>(null);
  const showBrushCursor = mode === "brush";
  const updateBrushCursor = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (!showBrushCursor || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    setBrushCursor({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
  }, [showBrushCursor]);
  const draw = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (event.type === "pointerdown") {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
    } else if (!drawingPointRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext("2d");
    if (!context || rect.width === 0 || rect.height === 0) return;
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
    const sourceScale = ((canvas.width / rect.width) + (canvas.height / rect.height)) / 2;
    const lineWidth = brushSize * sourceScale;
    context.globalCompositeOperation = mode === "brush" ? "source-over" : "destination-out";
    context.strokeStyle = "rgba(204,242,87,.72)";
    context.fillStyle = "rgba(204,242,87,.72)";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = lineWidth;
    context.beginPath();
    const previous = drawingPointRef.current;
    if (previous) {
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    } else {
      context.arc(point.x, point.y, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    }
    drawingPointRef.current = point;
    setMaskError("");
  }, [brushSize, mode]);
  const commit = useCallback(() => {
    drawingPointRef.current = null;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const snapshot = context.getImageData(0, 0, canvas.width, canvas.height);
    setHistory((current) => [...current.slice(0, historyIndex + 1), snapshot]);
    setHistoryIndex((current) => current + 1);
  }, [historyIndex]);
  const restore = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const snapshot = history[index];
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (snapshot) context.putImageData(snapshot, 0, 0);
    setHistoryIndex(index);
  }, [history]);
  const confirm = useCallback(() => {
    const source = canvasRef.current;
    if (!source) return;
    const mask = document.createElement("canvas");
    mask.width = source.width;
    mask.height = source.height;
    const sourceContext = source.getContext("2d");
    const maskContext = mask.getContext("2d");
    if (!sourceContext || !maskContext) return;
    const sourceData = sourceContext.getImageData(0, 0, source.width, source.height);
    const output = maskContext.createImageData(source.width, source.height);
    let selectedPixels = 0;
    for (let index = 0; index < sourceData.data.length; index += 4) {
      const selected = (sourceData.data[index + 3] ?? 0) > 0;
      if (selected) selectedPixels += 1;
      output.data[index] = 255;
      output.data[index + 1] = 255;
      output.data[index + 2] = 255;
      output.data[index + 3] = selected ? 0 : 255;
    }
    if (selectedPixels === 0) {
      setMaskError(locale === "zh-CN" ? "请先涂抹需要编辑的区域。" : "Paint the area you want to edit first.");
      return;
    }
    maskContext.putImageData(output, 0, 0);
    onConfirm({ mimeType: "image/png", data: mask.toDataURL("image/png").split(",")[1] ?? "" }, prompt.trim());
  }, [locale, onConfirm, prompt]);
  return <EditorFrame icon={Brush} locale={locale} onCancel={onCancel} onConfirm={confirm} surface="light" title={title}>
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-4 max-lg:grid-cols-1 max-lg:overflow-y-auto">
      <section className="flex min-h-0 flex-col">
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-b border-[#dfdfd8] pb-2 dark:border-white/10">
          <div className="flex items-center gap-1 rounded-[7px] border border-[#deded7] bg-white p-1 shadow-[0_4px_12px_rgba(44,48,35,.08)] dark:border-white/10 dark:bg-[#1b1c18] dark:shadow-[0_4px_12px_rgba(0,0,0,.14)]">
            <EditorTool light active={mode === "brush"} icon={Brush} label={locale === "zh-CN" ? "画笔" : "Brush"} onClick={() => setMode("brush")} />
            <EditorTool light active={mode === "erase"} icon={Eraser} label={locale === "zh-CN" ? "橡皮擦" : "Eraser"} onClick={() => setMode("erase")} />
          </div>
          <span className="hidden h-6 w-px bg-[#deded7] dark:bg-white/10 sm:block" />
          <div className="flex items-center gap-1 rounded-[7px] border border-[#deded7] bg-white p-1 shadow-[0_4px_12px_rgba(44,48,35,.08)] dark:border-white/10 dark:bg-[#1b1c18] dark:shadow-[0_4px_12px_rgba(0,0,0,.14)]">
            <EditorTool light disabled={historyIndex < 0} icon={Undo2} label={locale === "zh-CN" ? "撤销" : "Undo"} onClick={() => restore(historyIndex - 1)} />
            <EditorTool light disabled={historyIndex >= history.length - 1} icon={Redo2} label={locale === "zh-CN" ? "重做" : "Redo"} onClick={() => restore(historyIndex + 1)} />
          </div>
          <label className="ml-auto flex h-10 min-w-[210px] flex-1 items-center gap-2.5 rounded-[7px] border border-[#deded7] bg-white px-3 text-[10px] text-muted-foreground shadow-[0_4px_12px_rgba(44,48,35,.05)] dark:border-white/10 dark:bg-[#1b1c18] dark:text-white/60 dark:shadow-none sm:max-w-[290px]">
            <span className="shrink-0 font-medium">{locale === "zh-CN" ? "画笔大小" : "Brush size"}</span>
            <Slider max={96} min={8} onValueChange={(value) => setBrushSize(value[0] ?? 44)} step={2} value={[brushSize]} />
            <span className="w-9 shrink-0 text-right font-mono text-[#d8f478]">{brushSize}px</span>
          </label>
        </div>
        <div className="mt-3 grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[9px] border border-[#deded7] bg-[#f1f2ed] p-2 dark:border-white/10 dark:bg-black/20 max-lg:min-h-[min(52vh,520px)]">
          <div className="relative max-h-full max-w-full overflow-hidden rounded-[6px] shadow-[0_16px_36px_rgba(30,34,22,.16)] dark:shadow-[0_16px_36px_rgba(0,0,0,.26)]">
            <img alt={asset.name} className="block max-h-[calc(100vh-190px)] max-w-full object-contain max-lg:max-h-[min(48vh,480px)]" onLoad={(event) => { const image = event.currentTarget; const canvas = canvasRef.current; if (!canvas) return; canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; }} src={asset.url ?? ""} />
            <canvas className="absolute inset-0 h-full w-full touch-none" onPointerCancel={() => { commit(); setBrushCursor(null); }} onPointerDown={(event) => { updateBrushCursor(event); draw(event); }} onPointerLeave={() => setBrushCursor(null)} onPointerMove={(event) => { updateBrushCursor(event); draw(event); }} onPointerUp={() => { commit(); setBrushCursor(null); }} ref={canvasRef} style={{ cursor: showBrushCursor ? "none" : "crosshair" }} />
            {showBrushCursor && brushCursor ? <span aria-hidden="true" className="pointer-events-none absolute z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#4e602d] bg-[#ccf257]/25 text-[#36441b] shadow-[0_1px_5px_rgba(0,0,0,.35)] dark:border-white/75 dark:text-white" style={{ left: `${brushCursor.x}%`, top: `${brushCursor.y}%` }}><Brush className="h-3.5 w-3.5" strokeWidth={2.2} /></span> : null}
          </div>
        </div>
      </section>
      <aside className="flex min-h-0 flex-col rounded-[9px] border border-[#deded7] bg-white p-3 shadow-[0_10px_28px_rgba(44,48,35,.08)] dark:border-white/10 dark:bg-[#1b1c18] dark:shadow-[0_10px_28px_rgba(0,0,0,.16)] max-lg:min-h-[164px]">
        <label className="flex min-h-0 flex-1 flex-col gap-2">
          <span className="text-[11px] font-semibold text-foreground dark:text-white/82">{locale === "zh-CN" ? "修改描述" : "Edit description"}</span>
          <textarea aria-label={locale === "zh-CN" ? "描述选中区域需要如何修改" : "Describe how the selected area should change"} className="min-h-[150px] w-full flex-1 resize-none rounded-[7px] border border-[#deded7] bg-[#fafaf7] px-3 py-2.5 text-[11px] leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[#8da553] focus:bg-white focus:ring-1 focus:ring-[#a8c554]/25 dark:border-white/10 dark:bg-black/15 dark:text-white dark:placeholder:text-white/35 dark:focus:border-[#a8c554] dark:focus:bg-white/[.05] max-lg:min-h-[110px]" onChange={(event) => setPrompt(event.target.value)} placeholder={action === "remove-object" ? (locale === "zh-CN" ? "可选：例如“只移除裤子，保留人物其他部分”" : "Optional: e.g. remove only the trousers and preserve the rest of the person") : (locale === "zh-CN" ? "描述选中区域需要如何修改" : "Describe how the selected area should change")} value={prompt} />
        </label>
        <p className={`mt-2 text-[10px] leading-4 ${maskError ? "text-red-600 dark:text-red-300" : "text-muted-foreground dark:text-white/42"}`}>{maskError || (locale === "zh-CN" ? "绿色区域是唯一允许重绘的范围，未涂抹区域应保持不变。" : "Only the green area may be regenerated; unpainted areas should remain unchanged.")}</p>
      </aside>
    </div>
  </EditorFrame>;
}

export function MultiViewPanel({ asset, locale, onCancel, onConfirm }: { asset: MediaAsset; locale: Locale; onCancel: () => void; onConfirm: (views: MediaViewAngle[], prompt: string) => void }) {
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [activePreset, setActivePreset] = useState("front");
  const selectPreset = (view: ViewPreset) => {
    setActivePreset(view.id);
    setYaw(view.yaw);
    setPitch(view.pitch);
  };
  const confirm = () => {
    const preset = viewPresets.find((view) => view.id === activePreset);
    const view = preset
      ? { id: preset.id, label: preset.label[locale], yaw: preset.yaw, pitch: preset.pitch }
      : { id: "custom", label: locale === "zh-CN" ? `自定义 ${yaw}°/${pitch}°` : `Custom ${yaw}°/${pitch}°`, yaw, pitch };
    onConfirm([view], prompt.trim());
  };
  return <div className="nodrag nopan h-[248px] w-[500px] overflow-hidden rounded-[8px] border border-[#deded7] bg-white px-2.5 pb-2.5 pt-2 text-foreground shadow-[0_16px_44px_rgba(43,48,34,.18)] dark:border-white/10 dark:bg-[#20211e] dark:text-white dark:shadow-[0_16px_44px_rgba(0,0,0,.34)]" onClick={(event) => event.stopPropagation()}>
    <header className="flex h-6 items-center justify-between"><h2 className="text-[13px] font-semibold">{locale === "zh-CN" ? "角度" : "Angle"}</h2><button aria-label={locale === "zh-CN" ? "关闭" : "Close"} className="grid h-6 w-6 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white" onClick={onCancel} type="button"><X className="h-4 w-4" /></button></header>
    <div className="mt-2 grid grid-cols-[192px_minmax(0,1fr)] gap-2.5">
      <div className="min-w-0"><ThreeCubePreview imageUrl={asset.url} pitch={pitch} yaw={yaw} /><div className="mt-2 space-y-1.5"><ViewSlider label={locale === "zh-CN" ? "旋转" : "Rotate"} max={90} min={-90} onValueChange={(value) => { setYaw(value); setActivePreset("custom"); }} value={yaw} /><ViewSlider label={locale === "zh-CN" ? "倾斜" : "Tilt"} max={75} min={-75} onValueChange={(value) => { setPitch(value); setActivePreset("custom"); }} value={pitch} /></div></div>
      <div className="flex min-w-0 flex-col"><h3 className="mb-1 text-[10px] font-semibold text-muted-foreground dark:text-white/65">{locale === "zh-CN" ? "摄像机" : "Camera"}</h3><div className="grid h-[94px] grid-cols-2 auto-rows-11 gap-1.5 overflow-y-auto pr-1">{viewPresets.map((view) => <button aria-pressed={activePreset === view.id} className={`group relative flex h-11 min-w-0 items-center gap-2 rounded-[6px] border p-1 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[#8da553] ${activePreset === view.id ? "border-[#9fb86a] bg-[#eef4df] dark:border-[#ccf257] dark:bg-[#ccf257]/10" : "border-[#e1e1db] bg-[#fafaf7] hover:border-[#bac69b] hover:bg-white dark:border-white/10 dark:bg-black/10 dark:hover:border-white/35 dark:hover:bg-white/[.04]"}`} key={view.id} onClick={() => selectPreset(view)} type="button"><span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[5px] bg-[#e9ebe3] dark:bg-black/20"><img alt="" className="h-full w-full object-cover opacity-90 transition-transform duration-200 group-hover:scale-[1.03]" src={view.preview} /></span><span className="min-w-0 truncate text-[9px] font-medium leading-3 text-foreground/80 dark:text-white/75">{view.label[locale]}</span>{activePreset === view.id ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#8da553] dark:bg-[#ccf257]" /> : null}</button>)}</div><div className="mt-1.5 flex h-[72px] flex-col overflow-hidden rounded-[6px] border border-[#deded7] bg-[#fafaf7] shadow-inner shadow-[#d9dbd2]/35 transition-colors focus-within:border-[#8da553] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#b8d85f]/25 dark:border-white/10 dark:bg-[#171814] dark:shadow-black/20 dark:focus-within:border-[#b8d85f] dark:focus-within:bg-white/[.08]"><textarea aria-label={locale === "zh-CN" ? "镜头效果描述" : "Camera effect description"} className="min-h-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[2px] leading-[4px] text-foreground outline-none placeholder:text-muted-foreground dark:text-white dark:placeholder:text-white/30" onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); confirm(); } }} placeholder={locale === "zh-CN" ? "简单描述你想要的镜头效果" : "Describe the camera effect"} value={prompt} /><div className="flex h-[18px] shrink-0 items-center justify-end px-1"><button aria-label={locale === "zh-CN" ? "生成多视角" : "Generate view"} className="grid !h-3.5 !w-3.5 place-items-center rounded-[3px] bg-accent text-accent-foreground transition-colors hover:brightness-95" onClick={confirm} title={locale === "zh-CN" ? "生成多视角" : "Generate view"} type="button"><ArrowUp className="h-[7px] w-[7px]" /></button></div></div></div>
    </div>
  </div>;
}

type ViewPreset = { id: string; label: { "zh-CN": string; "en-US": string }; pitch: number; preview: string; yaw: number };
const viewPresets: ViewPreset[] = [
  { id: "front", label: { "zh-CN": "平视", "en-US": "Eye level" }, yaw: 0, pitch: 0, preview: eyeLevelPreview },
  { id: "top", label: { "zh-CN": "俯视", "en-US": "Top view" }, yaw: 0, pitch: -55, preview: highAnglePreview },
  { id: "low", label: { "zh-CN": "仰视", "en-US": "Low angle" }, yaw: 0, pitch: 35, preview: lowAnglePreview },
  { id: "three-quarter", label: { "zh-CN": "3/4 视角", "en-US": "3/4 view" }, yaw: 45, pitch: -8, preview: threeQuarterPreview },
  { id: "side", label: { "zh-CN": "侧面", "en-US": "Side" }, yaw: 90, pitch: 0, preview: profilePreview },
  { id: "bird", label: { "zh-CN": "鸟瞰", "en-US": "Bird's eye" }, yaw: 35, pitch: -62, preview: birdsEyePreview },
  { id: "fish-eye", label: { "zh-CN": "鱼眼", "en-US": "Fisheye" }, yaw: -35, pitch: 10, preview: fishEyePreview },
  { id: "worms-eye", label: { "zh-CN": "虫视", "en-US": "Worm's eye" }, yaw: -15, pitch: 58, preview: wormsEyePreview },
  { id: "wide", label: { "zh-CN": "广角", "en-US": "Wide angle" }, yaw: 20, pitch: 5, preview: wideAnglePreview },
];

function ThreeCubePreview({ imageUrl, pitch, yaw }: { imageUrl: string | null; pitch: number; yaw: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<THREE.Mesh | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(-3.1, 2.35, 4.8);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.replaceChildren(renderer.domElement);
    renderer.domElement.style.display = "block";
    const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x464741, roughness: 0.82, metalness: 0.04 });
    const frontMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.02 });
    // BoxGeometry uses +z as material slot 4. It is the image-bearing front face.
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), [cubeMaterial, cubeMaterial, cubeMaterial, cubeMaterial, frontMaterial, cubeMaterial]);
    const cubeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0x55574f, opacity: 0.75, transparent: true }));
    cube.add(cubeEdges);
    scene.add(cube);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x252720, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(-3, 4, 5);
    scene.add(keyLight);
    const render = () => renderer.render(scene, camera);
    const resize = () => { const width = Math.max(1, container.clientWidth); const height = Math.max(1, container.clientHeight); renderer.setSize(width, height, true); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    if (imageUrl) { const loader = new THREE.TextureLoader(); loader.setCrossOrigin(""); loader.load(imageUrl, (texture) => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); frontMaterial.map = texture; frontMaterial.needsUpdate = true; render(); }); }
    cubeRef.current = cube;
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    return () => { observer.disconnect(); cubeEdges.geometry.dispose(); (cubeEdges.material as THREE.LineBasicMaterial).dispose(); cube.geometry.dispose(); cubeMaterial.dispose(); frontMaterial.map?.dispose(); frontMaterial.dispose(); renderer.dispose(); rendererRef.current = null; sceneRef.current = null; cameraRef.current = null; cubeRef.current = null; };
  }, [imageUrl]);
  useEffect(() => { const cube = cubeRef.current; const renderer = rendererRef.current; const scene = sceneRef.current; const camera = cameraRef.current; if (!cube || !renderer || !scene || !camera) return; cube.rotation.y = THREE.MathUtils.degToRad(yaw); cube.rotation.x = THREE.MathUtils.degToRad(pitch); renderer.render(scene, camera); }, [pitch, yaw]);
  return <div className="mx-auto h-[110px] w-[120px] overflow-hidden rounded-[7px] border border-[#deded7] bg-[#edf0e6] dark:border-white/10 dark:bg-[#292a27]" ref={containerRef} />;
}

function EditorFrame({ children, icon: Icon, locale, onCancel, onConfirm, surface = "dark", title }: { children: ReactNode; icon: typeof Crop; locale: Locale; onCancel: () => void; onConfirm: () => void; surface?: "dark" | "light"; title: string }) {
  const light = surface === "light";
  return <div className={`absolute inset-0 z-[100] flex flex-col p-5 backdrop-blur-sm ${light ? "bg-[#f6f7f2]/96 text-foreground dark:bg-[#11120f]/95 dark:text-white" : "bg-[#11120f]/95 text-white"}`}><header className="flex items-center justify-between"><div className="flex items-center gap-2 text-[13px] font-semibold"><Icon className="h-4 w-4 text-[#829a4d] dark:text-[#ccf257]" />{title}</div><button aria-label="Close" className={`grid h-8 w-8 place-items-center rounded-[6px] ${light ? "text-muted-foreground hover:bg-muted hover:text-foreground dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`} onClick={onCancel} type="button"><X className="h-4 w-4" /></button></header><div className="min-h-0 flex-1 py-5">{children}</div><footer className="flex justify-end gap-2"><button className={`h-8 rounded-[6px] px-3 text-[11px] ${light ? "text-muted-foreground hover:bg-muted hover:text-foreground dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white" : "text-white/65 hover:bg-white/10"}`} onClick={onCancel} type="button">{locale === "zh-CN" ? "取消" : "Cancel"}</button><button className="flex h-8 items-center gap-1.5 rounded-[6px] bg-[#ccf257] px-3 text-[11px] font-semibold text-[#20270b]" onClick={onConfirm} type="button"><Check className="h-3.5 w-3.5" />{locale === "zh-CN" ? "应用" : "Apply"}</button></footer></div>;
}

function EditorTool({ active, disabled, icon: Icon, label, light = false, onClick }: { active?: boolean; disabled?: boolean; icon: typeof Brush; label: string; light?: boolean; onClick: () => void }) {
  return <button aria-label={label} className={`grid h-8 w-8 place-items-center rounded-[5px] disabled:cursor-not-allowed disabled:opacity-35 ${active ? "bg-[#ccf257] text-[#20270b]" : light ? "text-muted-foreground hover:bg-muted hover:text-foreground dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white" : "text-white/65 hover:bg-white/10 hover:text-white"}`} disabled={disabled} onClick={onClick} title={label} type="button"><Icon className="h-4 w-4" /></button>;
}

function ViewSlider({ label, max, min, onValueChange, value }: { label: string; max: number; min: number; onValueChange: (value: number) => void; value: number }) {
  return <label className="grid h-7 grid-cols-[46px_minmax(0,1fr)_38px] items-center gap-1.5 rounded-[6px] border border-[#deded7] bg-white px-2 text-[10px] text-muted-foreground dark:border-white/8 dark:bg-black/10 dark:text-white/65"><span className="truncate font-medium">{label}</span><Slider max={max} min={min} onValueChange={(next) => onValueChange(next[0] ?? value)} step={1} value={[value]} /><span className="rounded-[4px] bg-[#edf0e6] px-1 py-0.5 text-right font-mono text-[9px] text-[#718743] dark:bg-white/[.07] dark:text-[#d8f478]">{value}°</span></label>;
}
