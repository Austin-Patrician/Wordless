import { Button, Switch } from "@wordless/ui-kit";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionAccessLevel } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";

type AccessPickerProps = {
  disabled?: boolean;
  onChange: (accessLevel: SessionAccessLevel) => void | Promise<void>;
  value: SessionAccessLevel;
};

export function AccessPicker({ disabled = false, onChange, value }: AccessPickerProps) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fullAccess = value === "full";

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);

  const setDefaultAccess = async () => {
    setSaving(true);
    try {
      await onChange("default");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const allowFullAccess = async () => {
    if (!acknowledged) return;
    setSaving(true);
    try {
      await onChange("full");
      setConfirmOpen(false);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium transition-colors hover:bg-[#f1f1ee] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-muted ${fullAccess ? "text-[#b34b42] dark:text-[#f29a8f]" : "text-[#5f5f59] dark:text-muted-foreground"}`}
        disabled={disabled || saving}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {fullAccess ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        <span>{fullAccess ? t("fullAccess") : t("defaultAccess")}</span>
      </button>
      {open ? (
        <div className="absolute bottom-[34px] left-0 z-40 w-[250px] rounded-[10px] border border-[#dfdfdb] bg-white p-3 shadow-[0_14px_34px_rgba(28,28,25,0.12)] dark:border-border dark:bg-card">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b34b42] dark:text-[#f29a8f]" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-[#3d3d38] dark:text-foreground">{t("allowFullAccess")}</p>
              <p className="mt-1 text-[11px] leading-4 text-[#85857e] dark:text-muted-foreground">{t("fullAccessHelp")}</p>
            </div>
            <Switch aria-label={t("allowFullAccess")} checked={fullAccess} disabled={saving} onCheckedChange={(checked) => checked ? setConfirmOpen(true) : void setDefaultAccess()} />
          </div>
        </div>
      ) : null}
      {confirmOpen ? (
        <div aria-modal="true" className="fixed inset-x-0 bottom-0 top-[30px] z-[70] grid place-items-center bg-[#21211f]/45 p-4 backdrop-blur-[2px]" role="dialog">
          <div className="w-full max-w-[410px] rounded-xl border border-white/60 bg-white p-5 shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:border-border dark:bg-[#1c1d18]">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f9e9e6] text-[#b34b42] dark:bg-[#3a241f] dark:text-[#f29a8f]"><ShieldAlert className="h-4 w-4" /></span>
              <div>
                <h2 className="text-[15px] font-semibold">{t("allowFullAccess")}</h2>
                <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{t("fullAccessWarning")}</p>
              </div>
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#e5d6d1] bg-[#fdf8f6] p-3 text-[12px] leading-5 text-[#5c4944] dark:border-[#5c3d36] dark:bg-[#2b201d] dark:text-[#e8c9c1]">
              <input checked={acknowledged} className="mt-1 h-3.5 w-3.5 accent-[#b34b42]" onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" />
              <span>{t("fullAccessAcknowledgement")}</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => { setConfirmOpen(false); setAcknowledged(false); }} type="button" variant="ghost">{t("cancel")}</Button>
              <Button className="bg-[#b34b42] text-white hover:bg-[#963d35] disabled:bg-[#d5a29c]" disabled={!acknowledged || saving} onClick={() => void allowFullAccess()} type="button">{t("allowFullAccess")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
