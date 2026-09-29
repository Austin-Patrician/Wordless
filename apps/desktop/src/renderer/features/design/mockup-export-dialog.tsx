import { Button, Dialog, DialogClose, DialogContent, DialogTitle } from "@wordless/ui-kit";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignFrameDto, DesignManifestDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { attachMockupFrame, detachMockupFrame, mockupRailFrames, swapMockupFrames } from "./mockup-attach.ts";
import { MockupFrameRail, type MockupRailFrame } from "./mockup-frame-rail.tsx";
import { useMockupBrandLogo } from "./mockup-logo.ts";
import { loadMockupOptions, maxMockupRadius, saveMockupOptions, defaultMockupOptions } from "./mockup-options.ts";
import { MockupOptionsPanel } from "./mockup-options-panel.tsx";
import { paginateMockup } from "./mockup-paginate.ts";
import { buildMockupPdf } from "./mockup-pdf.ts";
import {
  bytesToBase64,
  mockupCanvasToJpegBytes,
  mockupCanvasToPngBytes,
  renderMockupToCanvas,
  stitchMockupPages,
} from "./mockup-render.ts";
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
  thumbnails,
}: {
  bridge: DesktopBridge;
  /** 设计包目录,用于读 `theme.css` 取色板。 */
  designDir: string;
  designPath: string;
  manifest: DesignManifestDto;
  onClose: () => void;
  sessionId: string;
  /**
   * frameId → 缩略图 URL,由画布把**它已经光栅过的**位图交上来。
   *
   * 左栏列的是"还没进渲染区"的那几帧,而它们恰好是**这一趟不会去抓的**帧 —— 所以缩略图不能
   * 从抓图结果里来。要么复用画布已有的位图,要么为了一列小图把每帧重新离屏渲染一遍;后者
   * 是真实成本,而位图就在画布里。
   */
  thumbnails: ReadonlyMap<string, string>;
}) {
  const { t } = usePreferences();
  /** 水印左边的品牌标。预览与导出用的是**同一个**对象,于是"看到的"和"拿到的"是同一张。 */
  const brandLogo = useMockupBrandLogo();
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
      // 缩略图用画布已经光栅过的位图,**不为缩略图再截一次**。没有就出占位 ——
      // 那比一张猜的图好:用户能看出"这一帧还没有预览",而不是以为设计长那样。
      thumbnail: thumbnails.get(frame.id) ?? null,
    }));
  }, [attached, frames, thumbnails]);

  const composePages = useCallback(
    () =>
      pages.map((pageShots) =>
        renderMockupToCanvas(pageShots, { ...options, scale: 1 }, options.perPage, brandLogo),
      ),
    [brandLogo, options, pages],
  );

  const onCopy = useCallback(async () => {
    setBusy("copy");
    setNotice(null);
    try {
      // 复制的是"你会保存的那张图":多页就是长图,与保存走同一条合成路径。
      const image = stitchMockupPages(composePages(), options);
      const copied = await bridge.copyDesignImage({ data: bytesToBase64(await mockupCanvasToPngBytes(image)) });
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

      /**
       * 载荷是 **base64 字符串**,不是 `Uint8Array` —— 这条通道要过 `contextBridge`,而类型化
       * 数组在桥上不可靠(那曾经让"点保存就失败")。见 `DesignSaveImageRequestSchema`。
       */
      const result = await bridge.saveDesignImage({
        data: bytesToBase64(bytes),
        extension: format === "pdf" ? "pdf" : "png",
        fileName: designNameOf(designPath),
      });
      if (result.ok) {
        setNotice(t("mockupSaveDone").replace("{path}", result.path));
      } else {
        // 取消不是错误 —— 不报红,只是什么都不说。
        if (result.reason === "cancelled") setNotice(null);
        // 失败时把主进程给的原因带出来:一句光秃秃的"保存失败"没法修、也没法报。
        else {
          const detail = result.detail ?? "";
          setNotice(`${t("mockupSaveFailed")}${detail ? ` — ${detail}` : ""}${saveHint(detail, t("mockupSaveNoPermission"))}`);
        }
      }
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      setNotice(`${t("mockupSaveFailed")} — ${detail}${saveHint(detail, t("mockupSaveNoPermission"))}`);
    } finally {
      setBusy(null);
    }
  }, [bridge, composePages, designPath, format, options, t]);

  const railFramesNode = frames.length === 0 ? [] : rail;

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      {/*
        `showCloseButton={false}`:标题栏里那个 ✕ 是**这个弹窗自己的**(与参考实现一样,它是
        标题行的一份子)。ui-kit 的 `DialogContent` 默认还会在右上角**绝对定位**再放一个 ✕
        —— 两个叠在一起,看起来像渲染坏了。
      */}
      <DialogContent
        className="flex h-[min(760px,calc(100vh-2rem))] w-[min(1100px,calc(100vw-2rem))] flex-col rounded-[10px] p-0"
        showCloseButton={false}
      >
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
            {/*
              设置卡是**预览台上的一层**,所以它与预览台同一块定位区(而不是整个右栏):
              上面贴着标题栏、下面贴着缩放条时,控件一多就会长到压住缩放条。
            */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className="pointer-events-none absolute inset-y-3 right-3 z-10 flex justify-end"
                data-mockup-overlay
              >
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

              {/**
                * 预览台**始终**渲染 —— 它是"从左侧把画框拖进来"的落点,没画框时也有空态(see `MockupStage`)。
                * 缩放条浮在它的左下角,不占一行高度。
                */}
              <MockupStage
                brandLogo={brandLogo}
                onDropRailFrame={(frameId) => setAttached((current) => attachMockupFrame(current, frameId))}
                onSelect={setSelectedFrameId}
                onSwap={(from, to) => setAttached((current) => swapMockupFrames(current, from, to))}
                options={options}
                pages={pages}
                selectedFrameId={selectedFrameId}
                slots={options.perPage}
              />
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

/**
 * 写不进去时补一句"那该怎么办"。
 *
 * 权限类的失败是最常见的一种,而 `EPERM: operation not permitted, open 'E:\...'` 这句话没告诉
 * 用户下一步做什么 —— 它只说了发生了什么。别的失败(磁盘满、路径太长)不猜,照实报。
 */
function saveHint(detail: string, hint: string): string {
  if (!/EPERM|EACCES|EROFS/i.test(detail)) return "";
  return `(${hint})`;
}

function shotTitle(shots: readonly MockupShot[], frameId: string): string {
  return shots.find((shot) => shot.frameId === frameId)?.title ?? frameId;
}

/** 设计包目录名去掉 `.wdesign` —— 当保存对话框的建议文件名。 */
function designNameOf(designPath: string): string {
  const base = designPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "design";
  return base.replace(/\.wdesign$/i, "") || "design";
}
