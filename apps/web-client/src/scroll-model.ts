/**
 * 滚动行为的三条规则(纯函数,直接可测)。
 *
 * 之所以抽出来:这是**行为缺陷**而不是样式问题 —— 之前的实现是无条件 `scrollTo` 到底,
 * 于是用户往上翻历史时会被不停地拽回底部。规则只有三条,但每一条都会有人踩:
 *
 * 1. **贴底才跟随**:只有用户本来就在底部附近,新内容才自动滚动;
 * 2. **离开底部就计数**:不在底部时到来的新内容计入"未读",由那个跳转按钮带出来;
 * 3. **换会话立刻到底**:不做平滑滚动(切会话是"换了一个地方",不是"往下走一点")。
 */

export interface ScrollMetrics {
	readonly scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
}

/**
 * 是否"贴着底部"。
 *
 * 阈值给 80px 而不是几像素:移动端惯性滚动、内容高度变化、图片加载都会让位置抖动,
 * 用严格相等会导致"明明在底部却不跟随"。
 */
export function isNearBottom(metrics: ScrollMetrics, threshold = 80): boolean {
	const distance = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
	return distance <= threshold;
}

/** 新内容到来后的未读计数:贴底就清零,否则累加。 */
export function nextUnseenCount(current: number, input: { readonly appended: number; readonly nearBottom: boolean }): number {
	if (input.appended <= 0) return current;
	return input.nearBottom ? 0 : current + input.appended;
}

export interface JumpButtonView {
	readonly visible: boolean;
	/** 电脑还在执行时用三点动画代替箭头(和桌面端一样:它在说"还在往下长")。 */
	readonly showProgress: boolean;
	/** 未读条数;0 表示不显示数字。 */
	readonly unseen: number;
}

export function jumpButtonView(input: {
	readonly nearBottom: boolean;
	readonly running: boolean;
	readonly unseen: number;
}): JumpButtonView {
	return {
		visible: !input.nearBottom,
		showProgress: input.running,
		unseen: Math.max(0, input.unseen),
	};
}

/** 换会话时到底:立刻,不平滑(`instant`)。 */
export function scrollBehaviorForSessionChange(): ScrollBehavior {
	return "instant";
}
