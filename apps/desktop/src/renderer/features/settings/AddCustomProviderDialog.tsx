import type { ConfiguredModelKind, ProviderAvatarId } from "@wordless/domain";
import { Button } from "@wordless/ui-kit";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ProviderAvatarPicker } from "./ProviderAvatarPicker";
import { usePreferences } from "../../shared/preferences";

type AddCustomProviderDialogProps = {
  disabled: boolean;
  kind: ConfiguredModelKind;
  onAdd: (providerId: string, avatarId: ProviderAvatarId) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  providerIds: string[];
};

export function AddCustomProviderDialog({ disabled, kind, onAdd, onOpenChange, open, providerIds }: AddCustomProviderDialogProps) {
  const { t } = usePreferences();
  const [avatarId, setAvatarId] = useState<ProviderAvatarId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerIdError, setProviderIdError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) return;
    setAvatarId(null);
    setError(null);
    setProviderIdError(null);
    setProviderId("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open, saving]);

  if (!open) return null;

  const create = async () => {
    const normalizedId = providerId.trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(normalizedId)) {
      setProviderIdError(t("customProviderIdHelp"));
      return;
    }
    if (providerIds.includes(normalizedId)) {
      setProviderIdError(t("customProviderIdExists"));
      return;
    }
    setProviderIdError(null);
    if (!avatarId) {
      setError(t("selectProviderAvatar"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAdd(normalizedId, avatarId);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-[30px] z-[70] grid place-items-center bg-[#21211f]/35 px-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onOpenChange(false); }}>
      <section aria-describedby="add-custom-provider-description" aria-labelledby="add-custom-provider-title" aria-modal="true" className="w-full max-w-[560px] rounded-[10px] border border-[#363632] bg-white p-5 text-[#292925] shadow-[0_20px_50px_rgba(0,0,0,0.22)] dark:border-border dark:bg-card dark:text-foreground" role="dialog">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-[16px] font-bold" id="add-custom-provider-title">{t("addCustomProvider")}</h2><p className="mt-1 text-[11px] text-muted-foreground" id="add-custom-provider-description">{kind === "chat" ? "LLM" : "Image"}</p></div>
          <Button aria-label={t("cancel")} disabled={saving} onClick={() => onOpenChange(false)} size="icon" type="button" variant="ghost"><X className="h-4 w-4" /></Button>
        </div>
        <label className="mt-5 block"><span className="mb-1.5 block text-[12px] font-medium">{t("providerId")}</span><input aria-describedby="custom-provider-id-help" aria-invalid={Boolean(providerIdError)} autoFocus className={`h-9 w-full rounded-[7px] border bg-[#fafaf9] px-3 font-mono text-[12px] outline-none placeholder:text-[#a0a09a] dark:bg-muted ${providerIdError ? "border-[#b42318] focus:border-[#b42318] dark:border-[#ffb4ab] dark:focus:border-[#ffb4ab]" : "border-[#deded8] focus:border-[#91a769] dark:border-border"}`} disabled={saving} onChange={(event) => { setProviderId(event.target.value); setError(null); setProviderIdError(null); }} placeholder="company-ai" value={providerId} /></label>
        {providerIdError ? <p className="mt-1.5 text-[10px] leading-4 text-[#b42318] dark:text-[#ffb4ab]" id="custom-provider-id-help" role="alert">{providerIdError}</p> : <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground" id="custom-provider-id-help">{t("customProviderIdHelp")}</p>}
        <section className="mt-5"><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[12px] font-medium">{t("providerAvatar")}</h3><span className="text-[10px] text-muted-foreground">{t("providerAvatarHelp")}</span></div><ProviderAvatarPicker disabled={saving} onChange={(nextAvatarId) => { setAvatarId(nextAvatarId); setError(null); }} value={avatarId} /></section>
        {error ? <p className="mt-3 text-[11px] text-destructive" role="alert">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2"><Button disabled={saving} onClick={() => onOpenChange(false)} type="button" variant="outline">{t("cancel")}</Button><Button disabled={saving || !providerId.trim() || !avatarId} onClick={() => void create()} type="button">{t("create")}</Button></div>
      </section>
    </div>,
    document.body,
  );
}
