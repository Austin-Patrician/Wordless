import { usePreferences } from "../../shared/preferences";

/**
 * 颜色选择:主题色板 + 系统取色器 + hex 输入。
 *
 * 三个入口各有各的用处:
 * - **色板**来自这份设计自己的 `theme.css` —— 导出图的底色与设计稿同源,而不是随手挑一个。
 * - **系统取色器**(`<input type="color">`)给任意颜色。
 * - **hex 输入**给"我从别处抄了个色号"这种最常见的情形。
 *
 * 参考实现自带一个 270 行的 HSV 取色面板。这里用系统取色器替代 —— 少一个自绘控件,
 * 而且 macOS/Windows 上它本来就带取色功能。**这是与参考实现的一处有意偏差。**
 */
export function MockupColorPicker({
  color,
  disabled = false,
  label,
  palette,
  onPick,
}: {
  color: string;
  /** 边框宽度为 0、或勾了透明底时,这个控件没有意义 —— 置灰而不是隐藏(隐藏会让布局跳动)。 */
  disabled?: boolean;
  label: string;
  /** 来自设计令牌的颜色。为空就不出这一行。 */
  palette: readonly string[];
  onPick: (color: string) => void;
}) {
  const { t } = usePreferences();

  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          aria-label={label}
          // 正方形:`h-7 w-9` 那个长方形读起来像输入框的一部分,而它是"现在是什么颜色"的色块。
          className="size-7 shrink-0 cursor-pointer rounded-[5px] border border-border bg-transparent p-0 disabled:cursor-not-allowed"
          disabled={disabled}
          onChange={(event) => onPick(event.target.value)}
          type="color"
          value={normalizeHex(color)}
        />
        <input
          aria-label={`${label} ${t("mockupColorHex")}`}
          className="h-7 min-w-0 flex-1 rounded-[5px] border border-border bg-transparent px-2 font-mono text-[11px] outline-none focus:border-[#879b65] disabled:cursor-not-allowed"
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value.trim();
            // 只在**完整**时才提交:半截的 `#4f4` 会被下游当成一个颜色传给 canvas,
            // 而 canvas 会静默忽略它 —— 用户看到的是"输入没反应"。
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(next)) onPick(next.toLowerCase());
          }}
          spellCheck={false}
          value={color}
        />
      </div>
      {palette.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {palette.map((swatch) => (
            <button
              aria-label={swatch}
              className={`size-5 rounded-[4px] border transition-transform hover:scale-110 ${
                swatch.toLowerCase() === color.toLowerCase() ? "border-[#252624] dark:border-[#c4eb58]" : "border-border"
              }`}
              disabled={disabled}
              key={swatch}
              onClick={() => onPick(swatch)}
              style={{ background: swatch }}
              title={swatch}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** `<input type="color">` 只认真六位形式;三位简写在这里补齐。 */
export function normalizeHex(color: string): string {
  const match = /^#([0-9a-f]{3})$/i.exec(color.trim());
  if (!match) return /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : "#000000";
  const [r, g, b] = [...match[1]!].map((char) => char + char);
  return `#${r}${g}${b}`;
}
