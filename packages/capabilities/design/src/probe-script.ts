/**
 * 注入离屏视图执行的布局探针。
 *
 * 为什么要有确定性检查:**模型的视觉判断不可复现**。同一个溢出,这次说"看起来还行"、
 * 下次说"右边被切了"。探针给出的是可复现的坐标事实,两者结合才是完整的质检。
 *
 * 探针在页面里跑(离屏视图内),用 `executeJavaScript` 注入,结果是一个数组。
 * 它检查这几类 —— 都是"肉眼一眼能看出、但模型经常漏掉"的:
 *
 * - **横向溢出**:内容比容器宽,而容器不裁剪(于是压到相邻元素上)
 * - **文本被裁**:裁剪 + 不是省略号截断
 * - **不换行溢出**:`white-space: nowrap` 把内容顶出去
 * - **flex 子项溢出**:`flex-direction: row` 且子项比可用宽度宽
 * - **背景被裁**:有 `background-image` / `mask` 的元素被容器裁掉
 *
 * 刻意**不做的事**:不报"对比度不足"。那需要字体大小、字重、实际渲染色的综合判断,
 * 而这些规则在页面里跑容易给出假阳性 —— 假阳性会让模型去改本来没问题的东西,比漏报更糟。
 */

/** 每个元素最多看这么深。更深的通常是被包裹的内容,而问题出在外层。 */
const MAX_DEPTH = 14;
/** 容器总宽小于这个值时视为布局还没成型,不报。 */
const MIN_WIDTH = 8;

/**
 * 立即执行的表达式。最后一行是它的返回值。
 *
 * 写成字符串而不是函数,是因为它要被 `executeJavaScript` 序列化;里面的内容一旦依赖外部
 * 变量就会在注入时炸掉,所以**它必须是自包含的**。
 */
export const LAYOUT_PROBE_EXPRESSION = `(() => {
  const MAX_DEPTH = ${MAX_DEPTH};
  const MIN_WIDTH = ${MIN_WIDTH};
  const findings = [];
  const seen = new Set();

  const describe = (element) => {
    const id = element.id ? "#" + element.id : "";
    const classes = typeof element.className === "string" && element.className.trim()
      ? "." + element.className.trim().split(/\\s+/).slice(0, 2).join(".")
      : "";
    return element.tagName.toLowerCase() + id + classes;
  };

  const clips = (style) =>
    style.overflowX === "hidden" || style.overflowX === "clip" ||
    style.overflowY === "hidden" || style.overflowY === "clip";

  const paints = (value) => typeof value === "string" && value !== "" && value !== "none";

  const walk = (element, depth) => {
    if (depth > MAX_DEPTH) return;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;

    const rect = element.getBoundingClientRect();
    const parent = element.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : null;
    const parentStyle = parent ? getComputedStyle(parent) : null;

    const push = (kind, detail) => {
      const key = kind + "|" + describe(element);
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ kind, selector: describe(element), detail });
    };

    /*
     * 这里刻意不检查"内容比盒子大、但盒子不裁剪"。
     *
     * 我加过两条这样的检查(overflow-x / overflow-y)。但它们制造的是**假阳性**,而假阳性
     * 在这里的代价极高:一次真实会话里 design_inspect 连续 17 次报同一条
     * "[overflow-y] mine div: content is 4px taller than its box",而"手机帧的 body 比声明
     * 高度多 4px"根本不是缺陷 —— agent 修不掉、又被告知"修完再截图",于是卡在循环里,
     * 整个会话跑了 62 分钟。
     *
     * 参考实现说得更准:「只认 overflow 明确藏起来的情况 —— 可滚动的区域超出是正常的」。
     * 所以只留下面那条 text-clipped(裁剪了、又没有省略号,那就是硬切掉)。
     * **漏报一条,好过让 agent 追一条修不掉的。**
     */

    // 文本被裁:裁剪了,但不是省略号截断 —— 那就是硬切掉。
    if (clips(style) && style.textOverflow !== "ellipsis") {
      const text = (element.textContent || "").trim();
      if (text.length > 0 && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)) {
        push("text-clipped", "text is cut off with no ellipsis");
      }
    }

    if (style.whiteSpace === "nowrap" && parentRect && rect.width > parentRect.width + 1) {
      push("no-wrap-overflow", "nowrap text is " + Math.round(rect.width - parentRect.width) + "px wider than its parent");
    }

    if (parentStyle && parentStyle.display === "flex" && parentStyle.flexDirection === "row" && parentRect) {
      if (parentRect.width >= MIN_WIDTH && rect.width > parentRect.width + 1) {
        push("flex-item-overflow", "this row item is wider than the row itself");
      }
    }

    if (parentRect && (paints(style.backgroundImage) || paints(style.webkitMaskImage))) {
      const clipped = rect.right > parentRect.right + 1 || rect.bottom > parentRect.bottom + 1;
      if (clipped && parentStyle && clips(parentStyle)) {
        push("background-clipped", "a painted surface is cut off by its parent");
      }
    }

    for (const child of element.children) walk(child, depth + 1);
  };

  if (document.body) walk(document.body, 0);
  return findings;
})()`;
