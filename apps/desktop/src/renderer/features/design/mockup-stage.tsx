import { useEffect, useRef } from "react";
import { layoutMockup } from "./mockup-layout.ts";
import { renderMockup } from "./mockup-render.ts";
import type { MockupOptions, MockupShot } from "./mockup-types.ts";

/**
 * 预览台:把每页的合成结果画到 `<canvas>` 上,竖着堆叠。
 *
 * **用的是导出那一个渲染器**(`renderMockup`),预览只是把它画在 1 倍上 —— 所以"预览看起来
 * 什么样,导出就是什么样"这条纪律在代码上是**同一个函数调用**,而不是两处长得像的绘制。
 *
 * 几何也来自同一份 `layoutMockup`(`fit` 只影响导出的倍率,不影响版面尺寸),所以页宽、
 * 间距、边框位置在预览与导出里逐一对应。
 *
 * 与参考实现的一处偏差:它把预览台接进了画布那套平移/缩放手势;这里用 `overflow: auto`
 * 加一个缩放倍数。手势少了一层,而版面是同一份 —— 要补上它应当复用画布的相机,不该另写一套。
 */
export function MockupStage({
  onSelect,
  onSwap,
  options,
  pages,
  selectedFrameId,
  slots,
  zoom,
}: {
  onSelect: (frameId: string | null) => void;
  /** 把 `from` 拖到 `to` 上 = **两者互换**(Figma 式),见 `mockup-attach.ts`。 */
  onSwap: (from: number, to: number) => void;
  options: MockupOptions;
  /** 每页的 shots —— 分页结果由调用方给(预览、导出、页码文案必须看到同一份)。 */
  pages: readonly (readonly MockupShot[])[];
  selectedFrameId: string | null;
  /** 每页留几格:末页不满也占满宽度,多页叠起来才等宽。 */
  slots: number;
  zoom: number;
}) {
  const dragFrom = useRef<number | null>(null);

  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6" onClick={() => onSelect(null)}>
      <div className="flex flex-col gap-4" style={{ gap: 24 * zoom }}>
        {pages.map((pageShots, pageIndex) => (
          <div
            className="flex flex-col items-center gap-1"
            key={pageIndex}
            // 拖到另一页上 = 换位。点空白处取消选中,所以这里要拦住冒泡。
            onClick={(event) => event.stopPropagation()}
          >
            {pages.length > 1 ? (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {pageIndex + 1} / {pages.length}
              </span>
            ) : null}
            <div className="flex items-start" style={{ gap: 8 * zoom }}>
              {pageShots.map((shot, indexInPage) => {
                const globalIndex = pages.slice(0, pageIndex).reduce((sum, page) => sum + page.length, 0) + indexInPage;
                return (
                  <button
                    className={`shrink-0 rounded-[4px] border transition-shadow ${
                      selectedFrameId === shot.frameId
                        ? "border-[#4f7df3] shadow-[0_0_0_2px_rgba(79,125,243,0.35)]"
                        : "border-transparent"
                    }`}
                    draggable
                    key={shot.frameId}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(shot.frameId);
                    }}
                    onDragEnd={() => {
                      dragFrom.current = null;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragStart={() => {
                      dragFrom.current = globalIndex;
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = dragFrom.current;
                      dragFrom.current = null;
                      if (from !== null) onSwap(from, globalIndex);
                    }}
                    title={shot.title}
                    type="button"
                  >
                    <MockupPageCanvas options={options} shots={[...pageShots]} slots={slots} zoom={zoom} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 一页的位图。每帧的位图在这里画进去,而**整页一起画**:一页里的几帧共享一次布局计算,
 * 分开画的话每帧都会自己算一遍整页的尺寸。
 */
function MockupPageCanvas({
  options,
  shots,
  slots,
  zoom,
}: {
  options: MockupOptions;
  shots: MockupShot[];
  slots: number;
  zoom: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const layout = layoutMockup(shots, options, slots);
    // 预览画在 1 倍上,再由 CSS 缩放到 zoom —— 版面尺寸与导出完全一致,差的只是倍率。
    canvas.width = Math.max(1, Math.round(layout.width));
    canvas.height = Math.max(1, Math.round(layout.height));
    const g = canvas.getContext("2d");
    if (g === null) return;
    renderMockup(g, shots, options, layout, 1);
  }, [options, shots, slots]);

  return <canvas ref={ref} style={{ height: undefined, width: `${100 * zoom}%` }} />;
}
