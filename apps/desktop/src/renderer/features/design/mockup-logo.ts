import { useEffect, useState } from "react";
import brandUrl from "../../../icons/common-icons/wordless-brand.svg";

/**
 * 水印左边那个品牌标。
 *
 * 用**应用自己的品牌资源**(和"关于"页、引导页同一个文件),不另画一个近似图形 —— 水印上
 * 的标一旦和 app 里的不是同一个,它就只是长得像而已。
 *
 * 返回 `null` 表示还没加载好(或加载失败)。那时水印只画字,而**版面照样占着那个方块的位置**
 * (见 `mockup-layout.ts` 的 `brand.logo`),所以文字不会跟着跳一下。导出也一样:`null` 的那
 * 一瞬间导出的图会少那个标,而它下一秒就有了 —— 为一个装饰性的标去阻塞导出不划算。
 */
export function useMockupBrandLogo(): HTMLImageElement | null {
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = new Image();
    // 内联 SVG 是**同一个源**,画进 canvas 不会污染它(污染会让导出报错)。
    image.src = brandUrl;
    const onLoad = (): void => setLogo(image);
    image.addEventListener("load", onLoad);
    return () => image.removeEventListener("load", onLoad);
  }, []);

  return logo;
}
