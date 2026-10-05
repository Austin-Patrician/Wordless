import { Suspense, lazy, type ComponentProps } from "react";

/**
 * 文件类型图标 —— **按需加载**(与桌面端同一份表,`@wordless/ui-kit`)。
 *
 * 为什么不能直接 `import { FileTypeIcon } from "@wordless/ui-kit"`:
 *
 * 那张表是一千多个内联 SVG,按引用摇完还剩两百多个 —— **+59KB gzip**,而这个网页端的主包
 * 现在是 309KB gzip。手机上一次首屏多背 19%,只为了"输入框里 `@` 时能看见文件类型" ——
 * 而**不用 `@` 的人一个字节都不该付**。所以它走动态 import:只有真的画出第一个图标时才下载。
 *
 * 与桌面端同一份表、同一个组件(见 `packages/ui-kit/src/components/file-type-icon.tsx`):
 * 两端认出来的图标因此永远一致。桌面端是**静态**引用 —— 它的包本来就在本地,不需要为省几十 KB
 * 换来一次异步。
 *
 * 加载中那一下给一个**同尺寸的空盒子**(而不是一个通用文件图标):先画一个错的图标再换成对的,
 * 比先空着更晃眼。
 */
const LazyFileTypeIcon = lazy(async () => {
	// **子路径,不是 `@wordless/ui-kit`**:那个 index 被主包静态引用了(`Button` / `ProviderIcon`),
	// 图标要是挂在它下面,这一次动态 import 什么也拆不出来 —— 主包照样多 59KB。
	const { FileTypeIcon } = await import("@wordless/ui-kit/file-type-icon");
	return { default: FileTypeIcon };
});

export function FileTypeIcon(props: ComponentProps<typeof LazyFileTypeIcon>) {
	return (
		<Suspense fallback={<span aria-hidden className={props.className} />}>
			<LazyFileTypeIcon {...props} />
		</Suspense>
	);
}
