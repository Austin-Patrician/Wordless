import { Slider, Switch } from "@wordless/ui-kit";
import { usePreferences } from "../../shared/preferences";
import { MockupColorPicker } from "./mockup-color-picker.tsx";
import { MOCKUP_FRAMES_PER_PAGE, type MockupFramesPerPage, type MockupOptions } from "./mockup-types.ts";

/**
 * 浮在预览区上的设置卡。
 *
 * 每个控件都对应 `MockupOptions` 里的一个字段,而**几何与绘制都从同一份选项读**(见
 * `mockup-layout.ts` / `mockup-render.ts`)—— 所以这里没有"预览用一套、导出用一套"的可能。
 */
export function MockupOptionsPanel({
  maxRadius,
  onChange,
  onRemoveSelected,
  onReset,
  options,
  palette,
  selected,
}: {
  /** 圆角上限:归一化高度的一半(再大圆角就吞掉整个屏幕)。 */
  maxRadius: number;
  onChange: (patch: Partial<MockupOptions>) => void;
  onRemoveSelected: () => void;
  onReset: () => void;
  options: MockupOptions;
  /** 来自设计令牌的颜色,给两个取色器当色板。 */
  palette: readonly string[];
  /** 预览里当前选中的那一帧;没选就不出移除区。 */
  selected: { frameId: string; title: string } | null;
}) {
  const { t } = usePreferences();

  return (
    <div
      className="pointer-events-auto flex max-h-full w-60 flex-col gap-3.5 overflow-y-auto rounded-xl border border-border bg-popover/95 p-3 shadow-lg backdrop-blur-md"
      // 卡片浮在预览台之上:指针事件漏下去会变成拖画布。
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {selected === null ? null : (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-2.5">
          <span className="truncate text-[11px] font-medium text-foreground" title={selected.title}>
            {selected.title}
          </span>
          <button
            className="rounded-lg border border-border px-2 py-1 text-[11px] text-[#b4524f] hover:bg-muted"
            onClick={onRemoveSelected}
            type="button"
          >
            {t("mockupSelectedRemove")}
          </button>
        </div>
      )}

      <SliderRow
        display={String(Math.round(options.radius))}
        label={t("mockupOptionRadius")}
        max={Math.max(8, Math.round(maxRadius))}
        onChange={(radius) => onChange({ radius })}
        value={Math.round(options.radius)}
      />
      <SliderRow
        display={String(options.borderWidth)}
        label={t("mockupOptionBorder")}
        max={48}
        onChange={(borderWidth) => onChange({ borderWidth })}
        value={options.borderWidth}
      />

      <MockupColorPicker
        color={options.borderColor}
        // 边框宽度为 0 时边框色没有意义 —— 置灰,不隐藏(隐藏会让下面的控件跳位置)。
        disabled={options.borderWidth === 0}
        label={t("mockupOptionBorderColor")}
        onPick={(borderColor) => onChange({ borderColor })}
        palette={palette}
      />
      <MockupColorPicker
        color={options.background}
        disabled={options.transparent}
        label={t("mockupOptionBackground")}
        onPick={(background) => onChange({ background })}
        palette={palette}
      />

      <div className="flex flex-col gap-2.5 rounded-lg border border-border p-2.5">
        {(
          [
            ["transparent", "mockupOptionTransparent"],
            ["shadow", "mockupOptionShadow"],
            ["brand", "mockupOptionBrand"],
          ] as const
        ).map(([key, labelKey]) => (
          <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-foreground" key={key}>
            {t(labelKey)}
            <Switch
              aria-label={t(labelKey)}
              checked={options[key]}
              onCheckedChange={(checked) => onChange({ [key]: checked })}
            />
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t("mockupOptionScale")}</span>
        <div className="flex gap-1">
          {([1, 2] as const).map((value) => (
            <button
              className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                options.scale === value
                  ? "bg-[#252624] text-white dark:bg-[#c4eb58] dark:text-[#202225]"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              key={value}
              onClick={() => onChange({ scale: value })}
              type="button"
            >
              {value}x
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t("mockupOptionPerPage")}</span>
        <div className="flex gap-1">
          {MOCKUP_FRAMES_PER_PAGE.map((value: MockupFramesPerPage) => (
            <button
              className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                options.perPage === value
                  ? "bg-[#252624] text-white dark:bg-[#c4eb58] dark:text-[#202225]"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              key={value}
              onClick={() => onChange({ perPage: value })}
              type="button"
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <button
        className="rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
        onClick={onReset}
        type="button"
      >
        {t("mockupOptionReset")}
      </button>
    </div>
  );
}

function SliderRow({
  display,
  label,
  max,
  onChange,
  value,
}: {
  display: string;
  label: string;
  max: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-foreground">{display}</span>
      </div>
      <Slider
        aria-label={label}
        max={max}
        min={0}
        onValueChange={([next]) => onChange(next ?? 0)}
        step={1}
        value={[value]}
      />
    </div>
  );
}
