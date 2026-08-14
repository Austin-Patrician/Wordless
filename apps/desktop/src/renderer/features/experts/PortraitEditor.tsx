import { RotateCcw, Shuffle, X } from "lucide-react";
import { useState } from "react";
import type { AvataaarsPortraitOptions } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { ExpertPortrait } from "./ExpertPortrait";
import {
  AVATAAARS_ACCESSORIES,
  AVATAAARS_BACKGROUND_COLORS,
  AVATAAARS_CLOTHES_COLORS,
  AVATAAARS_CLOTHING,
  AVATAAARS_EYEBROWS,
  AVATAAARS_EYES,
  AVATAAARS_FACIAL_HAIR,
  AVATAAARS_HAIR_COLORS,
  AVATAAARS_MOUTHS,
  AVATAAARS_SKIN_COLORS,
  AVATAAARS_TOPS,
  DEFAULT_AVATAAARS_OPTIONS,
  randomAvataaarsOptions,
} from "./avataaars-portrait";

type StringOptionKey = {
  [K in keyof AvataaarsPortraitOptions]: AvataaarsPortraitOptions[K] extends string ? K : never;
}[keyof AvataaarsPortraitOptions];

function humanize(value: string, noneLabel: string): string {
  if (value === "none") return noneLabel;
  return value
    .replace(/0(\d)/g, " $1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function OptionSelect({
  label,
  noneLabel,
  onChange,
  options,
  value,
}: {
  label: string;
  noneLabel: string;
  onChange: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  return (
    <label className="block text-[10px] font-semibold text-[#666760] dark:text-muted-foreground">
      {label}
      <select
        className="mt-1 h-8 w-full rounded-[6px] border border-[#deded8] bg-white px-2 text-[11px] font-normal text-[#30312d] outline-none focus:border-[#91a365] dark:border-border dark:bg-muted dark:text-foreground"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>{humanize(option, noneLabel)}</option>
        ))}
      </select>
    </label>
  );
}

function ColorSwatches({
  colors,
  label,
  onChange,
  value,
}: {
  colors: readonly string[];
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <fieldset>
      <legend className="text-[10px] font-semibold text-[#666760] dark:text-muted-foreground">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {colors.map((color) => (
          <button
            aria-label={`${label} #${color}`}
            className={`h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-105 ${value === color ? "ring-2 ring-[#768b45] ring-offset-2 dark:ring-offset-card" : ""}`}
            key={color}
            onClick={() => onChange(color)}
            style={{ backgroundColor: `#${color}` }}
            title={`#${color}`}
            type="button"
          />
        ))}
      </div>
    </fieldset>
  );
}

export function PortraitEditor({
  initial,
  name,
  onApply,
  onClose,
}: {
  initial: AvataaarsPortraitOptions;
  name: string;
  onApply: (options: AvataaarsPortraitOptions) => void;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const [options, setOptions] = useState<AvataaarsPortraitOptions>(() => ({ ...initial }));
  const update = <K extends StringOptionKey>(key: K, value: AvataaarsPortraitOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));
  const select = (key: StringOptionKey) => (value: string) =>
    update(key, value as AvataaarsPortraitOptions[typeof key]);

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center bg-black/35 p-4" onMouseDown={onClose}>
      <section
        aria-label={t("expertsPortraitEditor")}
        className="flex max-h-[min(720px,calc(100vh-40px))] w-full max-w-[760px] flex-col overflow-hidden rounded-[8px] border border-[#deded8] bg-white shadow-[0_24px_70px_rgba(0,0,0,.25)] dark:border-border dark:bg-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center border-b border-[#e8e8e2] px-4 dark:border-border">
          <h2 className="text-[14px] font-semibold">{t("expertsPortraitEditor")}</h2>
          <div className="ml-auto flex items-center gap-1">
            <button className="grid h-7 w-7 place-items-center rounded-[5px] text-[#777870] hover:bg-muted" onClick={() => setOptions(randomAvataaarsOptions())} title={t("expertsPortraitRandomize")} type="button"><Shuffle className="h-3.5 w-3.5" /></button>
            <button className="grid h-7 w-7 place-items-center rounded-[5px] text-[#777870] hover:bg-muted" onClick={() => setOptions({ ...DEFAULT_AVATAAARS_OPTIONS })} title={t("expertsPortraitReset")} type="button"><RotateCcw className="h-3.5 w-3.5" /></button>
            <button className="grid h-7 w-7 place-items-center rounded-[5px] text-[#777870] hover:bg-muted" onClick={onClose} title={t("expertsCancel")} type="button"><X className="h-4 w-4" /></button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr] max-sm:grid-cols-1 max-sm:overflow-y-auto">
          <div className="grid place-items-center border-r border-[#e8e8e2] bg-[#f7f8f4] p-6 dark:border-border dark:bg-muted/40">
            <ExpertPortrait className="h-40 w-40 shadow-[0_10px_30px_rgba(35,36,31,.12)]" name={name} portrait={{ kind: "avataaars", schemaVersion: 1, options }} />
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div className="col-span-2 border-b border-[#ecece7] pb-2 text-[11px] font-semibold dark:border-border">{t("expertsPortraitFace")}</div>
              <ColorSwatches colors={AVATAAARS_SKIN_COLORS} label={t("expertsPortraitSkin")} onChange={select("skinColor")} value={options.skinColor} />
              <ColorSwatches colors={AVATAAARS_BACKGROUND_COLORS} label={t("expertsPortraitBackground")} onChange={select("backgroundColor")} value={options.backgroundColor} />
              <OptionSelect label={t("expertsPortraitEyes")} noneLabel={t("expertsPortraitNone")} onChange={select("eyes")} options={AVATAAARS_EYES} value={options.eyes} />
              <OptionSelect label={t("expertsPortraitEyebrows")} noneLabel={t("expertsPortraitNone")} onChange={select("eyebrows")} options={AVATAAARS_EYEBROWS} value={options.eyebrows} />
              <OptionSelect label={t("expertsPortraitMouth")} noneLabel={t("expertsPortraitNone")} onChange={select("mouth")} options={AVATAAARS_MOUTHS} value={options.mouth} />

              <div className="col-span-2 mt-1 border-b border-[#ecece7] pb-2 text-[11px] font-semibold dark:border-border">{t("expertsPortraitHair")}</div>
              <OptionSelect label={t("expertsPortraitTop")} noneLabel={t("expertsPortraitNone")} onChange={select("top")} options={AVATAAARS_TOPS} value={options.top} />
              <ColorSwatches colors={AVATAAARS_HAIR_COLORS} label={t("expertsPortraitHairColor")} onChange={select("hairColor")} value={options.hairColor} />
              <OptionSelect label={t("expertsPortraitFacialHair")} noneLabel={t("expertsPortraitNone")} onChange={select("facialHair")} options={AVATAAARS_FACIAL_HAIR} value={options.facialHair} />

              <div className="col-span-2 mt-1 border-b border-[#ecece7] pb-2 text-[11px] font-semibold dark:border-border">{t("expertsPortraitClothing")}</div>
              <OptionSelect label={t("expertsPortraitClothingStyle")} noneLabel={t("expertsPortraitNone")} onChange={select("clothing")} options={AVATAAARS_CLOTHING} value={options.clothing} />
              <ColorSwatches colors={AVATAAARS_CLOTHES_COLORS} label={t("expertsPortraitClothingColor")} onChange={select("clothesColor")} value={options.clothesColor} />

              <div className="col-span-2 mt-1 border-b border-[#ecece7] pb-2 text-[11px] font-semibold dark:border-border">{t("expertsPortraitAccessories")}</div>
              <OptionSelect label={t("expertsPortraitAccessory")} noneLabel={t("expertsPortraitNone")} onChange={select("accessories")} options={AVATAAARS_ACCESSORIES} value={options.accessories} />
            </div>
          </div>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-[#e8e8e2] px-4 py-3 dark:border-border">
          <button className="h-8 rounded-[6px] px-3 text-[11px] text-[#66665f] hover:bg-muted" onClick={onClose} type="button">{t("expertsCancel")}</button>
          <button className="h-8 rounded-[6px] bg-[#596b35] px-4 text-[11px] font-semibold text-white hover:bg-[#4b5c2b]" onClick={() => onApply(options)} type="button">{t("expertsPortraitApply")}</button>
        </footer>
      </section>
    </div>
  );
}
