import { Button, Dialog, DialogClose, DialogContent, DialogTitle } from "@wordless/ui-kit";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignFrameDto, DesignManifestDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { attachMockupFrame, detachMockupFrame, mockupRailFrames, swapMockupFrames } from "./mockup-attach.ts";
import { MockupFrameRail, type MockupRailFrame } from "./mockup-frame-rail.tsx";
import { loadMockupOptions, maxMockupRadius, saveMockupOptions, defaultMockupOptions } from "./mockup-options.ts";
import { MockupOptionsPanel } from "./mockup-options-panel.tsx";
import { paginateMockup } from "./mockup-paginate.ts";
import { buildMockupPdf } from "./mockup-pdf.ts";
import { mockupCanvasToJpegBytes, mockupCanvasToPngBytes, renderMockupToCanvas, stitchMockupPages } from "./mockup-render.ts";
import { MockupStage } from "./mockup-stage.tsx";
import { parseThemeTokens } from "./style-tokens.ts";
import type { MockupOptions, MockupShot } from "./mockup-types.ts";

/**
 * 导出渲染图:把选中的几帧合成一张图。
 *
 * 数据流是单向的:
 *
 * ```
 *   已加入的 id(attach)  ──┐
 *                          ├─→ shots ─→ 分页 ─→ 每页画布 ─→ PNG / 长图 / PDF
 *   抓到的位图(captures) ──┘
 * ```
 *
 * 三件事刻意放在这里,而不是散开:**分页结果**(预览、页码文案、导出必须看到同一份)、
 * **抓图倍率**(= `options.scale`,所以画进那一页的位图与它要占的像素数**一一对应**)、
 * 以及**"还有帧没渲染出来就不许导出"**这条闸门。
 */
export function MockupExportDialog({
  bridge,
  designDir,
  designPath,
  manifest,
  onClose,
  sessionId,
}: {
  bridge: DesktopBridge;
  /** 设计包目录,用于读 `theme.css` 取色板。 */
  designDir: string;
  designPath: string;
  manifest: DesignManifestDto;
  onClose: () => void;
  sessionId: string;
}) {
  const { t } = usePreferences();
  const frames = manifest.frames;

  const normalizedHeight = useMemo(
    () => Math.max(1, ...frames.map((frame: DesignFrameDto) => frame.height)),
    [frames],
  );

  const [attached, setAttached] = useState<string[]>([]);
  const [options, setOptions] = useState<MockupOptions>(() => loadMockupOptions(designPath, normalizedHeight));
  /**
   * 抓到的位图,**按倍率记住**。
   *
   * 这里踩过一次:一开始只按 `frameId` 存,于是用户切到 2x 之后不会重新抓 —— 合成用的
   * 还是那张 1x 的位图被放大,而这正是这个功能最不该出错的地方。位图的倍率与它要落的格子
   * 必须同源,所以倍率是缓存键的一部分。
   */
  const [captures, setCaptures] = useState<ReadonlyMap<string, { scale: number; image: CanvasImageSource }>>(new Map());
  /** 失败也按倍率记:同一帧在 1x 抓不出来、在 2x 未必。 */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const [palette, setPalette] = useState<readonly string[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [format, setFormat] = useState<"image" | "pdf">("image");
  const [busy, setBusy] = useState<"save" | "copy" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const decoded = useRef<CanvasImageSource[]>([]);

  // 设置是**本机习惯**,不是设计内容 —— 存 localStorage,不进 design.json(那是画布拥有、
  // agent 读的文件)。见 `mockup-options.ts`。
  useEffect(() => {
    saveMockupOptions(designPath, options);
  }, [designPath, options]);

  /** 色板取这份设计自己的 `theme.css` —— 导出图的底色与设计稿同源。 */
  useEffect(() => {
    let active = true;
    void bridge
      .readSessionWorkspaceTextFile(sessionId, `${designDir.replace(/[\\/]+$/, "")}/theme.css`)
      .then((file) => {
        if (!active) return;
        setPalette(file.status === "available" ? Object.values(parseThemeTokens(file.content).colors) : []);
      })
      .catch(() => {
        if (active) setPalette([]);
      });
    return () => {
      active = false;
    };
  }, [bridge, designDir, sessionId]);

  /**
   * 抓图。**按导出倍率抓**(`bucket = options.scale`)。
   *
   * 这不是省事:布局把每一帧归一到 CSS 高度,而画进那一页的位图要在 `scale` 倍下**逐像素**
   * 对上 —— 抓 1 倍再放大就会糊,抓 2 倍而按 1 倍画就会缩掉一半细节。所以两者必须同源。
   */
  useEffect(() => {
    const missing = attached.filter(
      (frameId) => captures.get(frameId)?.scale !== options.scale && !broken.has(`${frameId}@${options.scale}`),
    );
    if (missing.length === 0) return;
    let active = true;

    void bridge
      .rasterizeDesignFrames({
        path: designPath,
        frames: missing.map((frameId) => ({ frameId, bucket: options.scale })),
      })
      .then(async (results) => {
        if (!active) return;
        const next = new Map(captures);
        const failed = new Set(broken);
        for (const result of results) {
          const frameId = result.key.split("@")[0] ?? "";
          if (!result.ok) {
            failed.add(`${frameId}@${options.scale}`);
            continue;
          }
          try {
            const bitmap = await createImageBitmap(new Blob([result.bytes], { type: "image/jpeg" }));
            decoded.current.push(bitmap);
            // 换倍率时把上一张放掉:一个 ImageBitmap 是一块真实的解码内存。
            const previous = next.get(frameId)?.image;
            if (previous !== undefined && "close" in previous) (previous as ImageBitmap).close();
            next.set(frameId, { scale: options.scale, image: bitmap });
          } catch {
            failed.add(`${frameId}@${options.scale}`);
          }
        }
        setCaptures(next);
        setBroken(failed);
      })
      .catch(() => {
        // 整批失败就照实标出来,由界面显示"这一帧没渲染出来"——而不是留一张猜的图。
        if (!active) return;
        setBroken(new Set([...broken, ...missing.map((frameId) => `${frameId}@${options.scale}`)]));
      });

    return () => {
      active = false;
    };
  }, [attached, bridge, broken, captures, designPath, options.scale]);

  // 位图要在卸载时释放:一个 ImageBitmap 是一块真实的解码内存。
  useEffect(() => {
    const held = decoded.current;
    return () => {
      for (const bitmap of held) if ("close" in bitmap) (bitmap as ImageBitmap).close();
    };
  }, []);

  const shots: MockupShot[] = useMemo(() => {
    const byId = new Map(frames.map((frame) => [frame.id, frame]));
    const next: MockupShot[] = [];
    for (const frameId of attached) {
      const frame = byId.get(frameId);
      if (frame === undefined) continue;
      next.push({
        frameId,
        title: frame.title,
        cssWidth: frame.width,
        cssHeight: frame.height,
        // 倍率对不上的位图**不算数** —— 否则切档之后会拿旧图凑,而那正是要避免的。
        image: captures.get(frameId)?.scale === options.scale ? captures.get(frameId)!.image : null,
      });
    }
    return next;
  }, [attached, captures, frames, options.scale]);

  const pages = useMemo(() => paginateMockup(shots, options.perPage), [options.perPage, shots]);
  /** 还在抓(不是失败):状态行据此说"正在渲染…"。 */
  const pending = shots.some((shot) => shot.image === null && !broken.has(`${shot.frameId}@${options.scale}`));
  /**
   * **每一帧都有位图**才允许导出。
   *
   * 这里踩过一次:我一开始把失败的帧从 `pending` 里排掉,于是"失败"反而**解锁**了导出 ——
   * 而它导出的正好是那块灰色占位。失败与还在抓都必须挡住,区别只在状态行怎么说
   * (「正在渲染…」vs「N 帧没渲染出来」)。
   */
  const ready = shots.length > 0 && shots.every((shot) => shot.image !== null);

  const rail: MockupRailFrame[] = useMemo(() => {
    const available = mockupRailFrames(frames, attached);
    return available.map((frame) => ({
      id: frame.id,
      title: frame.title,
      width: frame.width,
      height: frame.height,
      // 缩略图用已经抓到的位图,**不为缩略图再截一次**。
      thumbnail: null,
    }));
  }, [attached, frames]);

  const composePages = useCallback(
    () => pages.map((pageShots) => renderMockupToCanvas(pageShots, { ...options, scale: 1 }, options.perPage)),
    [options, pages],
  );

  const onCopy = useCallback(async () => {
    setBusy("copy");
    setNotice(null);
    try {
      // 复制的是"你会保存的那张图":多页就是长图,与保存走同一条合成路径。
      const image = stitchMockupPages(composePages(), options);
      const copied = await bridge.copyDesignImage(await mockupCanvasToPngBytes(image));
      setNotice(copied ? t("mockupCopyDone") : t("mockupCopyFailed"));
    } catch {
      setNotice(t("mockupCopyFailed"));
    } finally {
      setBusy(null);
    }
  }, [bridge, composePages, options, t]);

  const onSave = useCallback(async () => {
    setBusy("save");
    setNotice(null);
    try {
      const composed = composePages();
      const bytes =
        format === "pdf"
          ? buildMockupPdf(
              await Promise.all(
                composed.map(async (page) => ({
                  jpeg: await mockupCanvasToJpegBytes(page),
                  width: page.width,
                  height: page.height,
                })),
              ),
              composed[0]?.width ?? 1,
            )
          : await mockupCanvasToPngBytes(stitchMockupPages(composed, options));

      const result = await bridge.saveDesignImage(
        { fileName: designNameOf(designPath), extension: format === "pdf" ? "pdf" : "png" },
        bytes,
      );
      if (result.ok) {
        setNotice(t("mockupSaveDone").replace("{path}", result.path));
      } else {
        // 取消不是错误 —— 不报红,只是什么都不说。
        setNotice(result.reason === "cancelled" ? null : t("mockupSaveFailed"));
      }
    } catch {
      setNotice(t("mockupSaveFailed"));
    } finally {
      setBusy(null);
    }
  }, [bridge, composePages, designPath, format, options, t]);

  const railFramesNode = frames.length === 0 ? [] : rail;

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="flex h-[min(760px,calc(100vh-2rem))] w-[min(1100px,calc(100vw-2rem))] flex-col rounded-[10px] p-0">
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[14px] font-semibold">{t("mockupTitle")}</DialogTitle>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{t("mockupSubtitle")}</p>
          </div>
          <DialogClose asChild>
            <button
              aria-label={t("mockupClose")}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        <div className="flex min-h-0 flex-1">
          <MockupFrameRail
            frames={railFramesNode}
            onAttach={(frameId) => setAttached((current) => attachMockupFrame(current, frameId))}
            onAttachAll={() => setAttached(frames.map((frame) => frame.id))}
            total={frames.length}
          />

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="pointer-events-none absolute right-3 top-3 z-10">
              <MockupOptionsPanel
                maxRadius={maxMockupRadius(normalizedHeight)}
                onChange={(patch) => setOptions((current) => ({ ...current, ...patch }))}
                onRemoveSelected={() =>
                  setSelectedFrameId((current) => {
                    if (current !== null) setAttached((list) => detachMockupFrame(list, current));
                    return null;
                  })
                }
                onReset={() => setOptions(defaultMockupOptions(normalizedHeight))}
                options={options}
                palette={palette}
                selected={
                  selectedFrameId === null
                    ? null
                    : { frameId: selectedFrameId, title: shotTitle(shots, selectedFrameId) }
                }
              />
            </div>

            {shots.length === 0 ? (
              <div className="grid flex-1 place-items-center px-8 text-center">
                <div>
                  <p className="text-[12px] text-foreground">{t("mockupEmptyTitle")}</p>
                  <p className="mt-1 max-w-[320px] text-[11px] leading-5 text-muted-foreground">
                    {t("mockupEmptyDesc")}
                  </p>
                </div>
              </div>
            ) : (
              <MockupStage
                onSelect={setSelectedFrameId}
                onSwap={(from, to) => setAttached((current) => swapMockupFrames(current, from, to))}
                options={options}
                pages={pages}
                selectedFrameId={selectedFrameId}
                slots={options.perPage}
                zoom={zoom}
              />
            )}

            <div className="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1.5">
              <IconButton label={t("mockupViewZoomOut")} onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}>
                <Minus className="size-3.5" />
              </IconButton>
              <span className="w-10 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <IconButton label={t("mockupViewZoomIn")} onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>
                <Plus className="size-3.5" />
              </IconButton>
              <IconButton label={t("mockupViewActual")} onClick={() => setZoom(1)}>
                <Maximize2 className="size-3.5" />
              </IconButton>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {notice ??
              (pending
                ? t("mockupStatusCapturing")
                : broken.size > 0
                  ? t("mockupStatusFailed").replace("{count}", String(broken.size))
                  : t("mockupStatusPages").replace("{count}", String(pages.length)))}
          </span>

          {broken.size > 0 ? (
            /**
             * 重试:把失败的那几帧从 `broken` 里放回待抓集合,抓图那个 effect 会自然重跑。
             *
             * 不做自动重试 —— 一帧渲染不出来通常是这份帧源本身有问题(布局探针/截图那侧会
             * 报原因),自动重试只会把同一个失败刷很多遍。
             */
            <button
              className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              onClick={() => setBroken(new Set())}
              type="button"
            >
              {t("mockupShotRetry")}
            </button>
          ) : null}

          <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
            {(
              [
                ["image", pages.length > 1 ? t("mockupFormatLongImage") : t("mockupFormatPng")],
                ["pdf", t("mockupFormatPdf")],
              ] as const
            ).map(([value, label]) => (
              <button
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  format === value ? "bg-[#252624] text-white dark:bg-[#c4eb58] dark:text-[#202225]" : "text-muted-foreground hover:bg-muted"
                }`}
                key={value}
                onClick={() => setFormat(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <Button
            className="h-7 rounded-lg px-3 text-[11px]"
            disabled={!ready || busy !== null}
            onClick={() => void onCopy()}
            type="button"
            variant="ghost"
          >
            {busy === "copy" ? t("mockupCopyRunning") : t("mockupCopy")}
          </Button>
          <Button
            className="h-7 rounded-lg px-3 text-[11px]"
            disabled={!ready || busy !== null}
            onClick={() => void onSave()}
            type="button"
          >
            {busy === "save" ? t("mockupSaveRunning") : t("mockupSave")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function shotTitle(shots: readonly MockupShot[], frameId: string): string {
  return shots.find((shot) => shot.frameId === frameId)?.title ?? frameId;
}

/** 设计包目录名去掉 `.wdesign` —— 当保存对话框的建议文件名。 */
function designNameOf(designPath: string): string {
  const base = designPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "design";
  return base.replace(/\.wdesign$/i, "") || "design";
}

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
