/**
 * 让浏览器**不要画原生拖影**。
 *
 * ## 为什么必须去掉它
 *
 * 原生拖影不是 DOM:它由操作系统合成,**不受我们的窗口裁剪** —— 光标走到哪儿它跟到哪儿,
 * 于是很容易飘出 app 的窗口、盖在左侧栏或对话框外面。用户看到的是"拖一帧的时候那张图从
 * app 里溢出来了",而它其实是系统画的一个浮层。
 *
 * 它也不带任何我们需要的信息:会落在哪由**落点自己**说(预览台在拖拽期间高亮成虚线框)。
 * 换句话说,把拖影去掉不是丢掉反馈,而是把反馈从系统手里拿回到应用里 —— 那条虚线框是
 * 裁剪在弹窗内的,永远不会飘到窗口外面。
 *
 * 实现上给的是一个 1×1 的透明元素:规范要求拖影必须是**已经渲染**的元素,而"什么都不画"
 * 只有这一种写法。它必须挂在文档里(挂在外面的元素不算已渲染),所以这里懒建一个并复用。
 */

let ghost: HTMLElement | null = null;

export function suppressNativeDragImage(dataTransfer: DataTransfer): void {
  if (dataTransfer.setDragImage === undefined) return;
  if (ghost === null) {
    ghost = document.createElement("div");
    ghost.style.cssText =
      "position:fixed;left:-1000px;top:-1000px;width:1px;height:1px;opacity:0;pointer-events:none";
  }
  if (!ghost.isConnected) document.body.append(ghost);
  dataTransfer.setDragImage(ghost, 0, 0);
}
