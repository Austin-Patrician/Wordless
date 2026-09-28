import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";

/**
 * 一套风格的正文(示例页 + 规范)的按需取用。
 *
 * ## 为什么按需
 *
 * 列表 DTO 里只有 `hasDemo` 这个事实 —— 一份示例 20–30KB、一份规范 2–6KB,而风格墙每次进页都要
 * 把目录拉一遍,用户真正看详情的次数却少得多。所以正文按 id 现取,取到就缓存在模块级 Map 里:
 * 悬停一张卡看一眼、再点开详情,不该拉两次。
 *
 * ## 悬停就取
 *
 * 卡片悬停时那一份已经开始取 —— 等它到了才换成示例页,所以不会闪一下再换(见 `DesignStyleCard`)。
 * 取不到(IPC 失败、id 不认识)就**保持缩略图**:一张卡画不出示例不该让整面墙出错。
 */

const cache = new Map<string, DesignStyleDetail>();

export interface DesignStyleDetail {
  demoHtml: string;
  designMd: string;
}

interface DetailState {
  detail: DesignStyleDetail | null;
  loading: boolean;
}

/** 测试用:清掉模块级缓存,免得用例之间互相影响。 */
export function resetStyleDetailCache(): void {
  cache.clear();
}

/**
 * `enabled` 为 true 时才去取。返回的东西**稳定**:同一个 id 在缓存命中后每次返回同一份。
 */
export function useDesignStyleDetail(
  bridge: DesktopBridge | undefined,
  id: string,
  enabled: boolean,
): DetailState {
  const cached = cache.get(id) ?? null;
  const [detail, setDetail] = useState<DesignStyleDetail | null>(cached);
  const [loading, setLoading] = useState(enabled && cached === null);

  useEffect(() => {
    if (!enabled || bridge === undefined) return;
    const hit = cache.get(id);
    if (hit !== undefined) {
      setDetail(hit);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void bridge
      .getDesignStyleDetail({ id })
      .then((result) => {
        if (!active) return;
        if (result !== null) cache.set(id, result);
        setDetail(result);
      })
      .catch(() => {
        // 取不到就当没有示例:卡片回落到缩略图,详情页只显示色板与规范目录。
        if (active) setDetail(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bridge, enabled, id]);

  return { detail: detail ?? cached, loading };
}

/**
 * 示例页。自包含的整页 HTML 放进一个 `sandbox` 的 iframe,按卡片宽度整体缩放。
 *
 * 五处取舍(与参考实现同构,理由逐条):
 *
 * - **按 1280px 布局再缩放**,不是改 iframe 宽度:否则卡片一窄就会触发示例页自己的响应式断点,
 *   看到的是手机版,而不是"这套风格在桌面上长什么样"。
 * - **缩放值只写 DOM,不进 state**。它随卡片宽度连续变化,而卡片宽度随窗口、侧栏、列数变化;
 *   每次变化都 setState 就是一次重渲染,而这棵子树里还挂着整页文档。
 * - **`sandbox` 只给 `allow-same-origin`**:示例页里一个脚本都没有(进包时校验过),而这条属性
 *   只是用来量它的内容高度以便自动滚动。两道一起,远端 HTML 做不了任何事。
 * - **自动滚动用 CSS 动画**,不是每帧改 `srcDoc`(会让 iframe 反复重载)也不是 rAF + setState
 *   (每帧重渲染)。动画交给合成器,静止时零开销 —— 只有详情页开它(`active`),卡片上不滚动:
 *   一屏好几张同时动只会让人眼花,而卡片要回答的是"长什么样",不是"滚起来什么样"。
 * - **量不到高度就不滚**:没有 `allow-scripts` 时量高度仍然可行(同源),量不到就退回单屏。
 */

/** 示例页按这个宽度布局,再整体缩放进卡片。桌面断点以上,免得落进它自己的移动端样式。 */
const DEMO_WIDTH = 1280;
/** 卡片/详情里露出的可视高度(示例坐标系内)。 */
const VIEWPORT_HEIGHT = 900;
const SCROLL_PIXELS_PER_SECOND = 110;
const MIN_DURATION_MS = 3000;
const MAX_DURATION_MS = 16000;

export function StyleDemo({
  html,
  active = false,
  className,
}: {
  html: string;
  /** 详情页里开自动滚动;卡片上不开。 */
  active?: boolean;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const scaledRef = useRef<HTMLDivElement | null>(null);
  /** 当前缩放:只在 DOM 与这个 ref 之间流动,不进 state(见文件头)。 */
  const scaleRef = useRef(0.25);
  const [contentHeight, setContentHeight] = useState(VIEWPORT_HEIGHT);
  const [ready, setReady] = useState(false);

  const applyScale = (): void => {
    const scaled = scaledRef.current;
    if (scaled !== null) scaled.style.transform = `scale(${scaleRef.current})`;
  };

  // 挂上来的那一帧要把此刻的缩放补上。
  useLayoutEffect(applyScale, []);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const applyWidth = (width: number): void => {
      if (width <= 0) return;
      scaleRef.current = width / DEMO_WIDTH;
      applyScale();
    };
    applyWidth(box.clientWidth);
    const observer = new ResizeObserver((entries) => {
      // 用 entry 的宽度,别再读 clientWidth:一屏几张卡"写完这张的 transform 再去读下一张的
      // 宽度"会把一次尺寸变化变成一串强制同步布局。
      for (const entry of entries) applyWidth(entry.contentRect.width);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const distance = Math.max(0, contentHeight - VIEWPORT_HEIGHT);
  // 动画名带一个固定前缀就够:同一时刻页面上最多一个详情在滚,卡片不滚。
  const animationName = "wt-style-demo-scroll";

  return (
    <div ref={boxRef} className={`relative w-full overflow-hidden ${className ?? ""}`}>
      {active && distance > 0 ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: 关键帧由本文件拼出,唯一的变量是数字
        <style dangerouslySetInnerHTML={{ __html: `@keyframes ${animationName}{from{transform:translateY(0)}to{transform:translateY(-${distance}px)}}` }} />
      ) : null}
      <div
        aria-hidden
        className="absolute left-0 top-0 origin-top-left overflow-hidden bg-white transition-opacity duration-300"
        ref={scaledRef}
        style={{ height: VIEWPORT_HEIGHT, opacity: ready ? 1 : 0, transform: `scale(${scaleRef.current})`, width: DEMO_WIDTH }}
      >
        <iframe
          className="pointer-events-none block border-0"
          // 只给同源(量高度用),不给脚本执行权。示例页里本来也没有脚本。
          sandbox="allow-same-origin"
          scrolling="no"
          srcDoc={html}
          style={{
            height: contentHeight,
            width: DEMO_WIDTH,
            ...(active && distance > 0
              ? {
                  animation: `${animationName} ${Math.min(
                    MAX_DURATION_MS,
                    Math.max(MIN_DURATION_MS, (distance / SCROLL_PIXELS_PER_SECOND) * 1000),
                  )}ms ease-in-out infinite alternate`,
                }
              : {}),
          }}
          title=""
          onLoad={(event) => {
            setReady(true);
            const height = event.currentTarget.contentDocument?.documentElement?.scrollHeight ?? 0;
            if (height > 0) setContentHeight(height);
          }}
        />
      </div>
    </div>
  );
}
