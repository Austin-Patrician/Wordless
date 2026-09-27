import { Button, Dialog, DialogClose, DialogContent, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@wordless/ui-kit";
import { LoaderCircle, Save, X } from "lucide-react";
import type { WebhookEndpointPublic, WebhookKind, WebhookProviderDescriptor } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";
import {
  notificationDraftIsDirty,
  webhookProviderLabelKey,
  type NotificationEditorState,
  type NotificationDraft,
  type NotificationDraftTouched,
} from "./notification-form";
import {
  formatListOption,
  listOptionTextIsCurrent,
  parseListOption,
  readListOption,
  readOption,
  readTextOption,
  webhookOptionFields,
  withListOption,
  withOption,
  withTextOption,
  type WebhookOptionField,
} from "./webhook-options";
import { useState } from "react";

/**
 * Adding or editing one push channel.
 *
 * A modal rather than a card in the list. The card pushed the list down, so the row
 * the user had just clicked moved out from under them, and on this page it also
 * shoved the default-push block below the fold. Every other list-and-edit screen in
 * the app uses a dialog for the same job, with this same header/body/footer shape.
 *
 * It is nested inside the settings dialog, which is itself a Radix dialog. That is
 * fine — Radix stacks dialogs (separate focus scopes, and Escape closes only the top
 * one) and both portal to the body. The overlay does double up, so the window behind
 * is dimmed twice; that reads as "you are editing this one thing", which is what it
 * is.
 */
const INPUT_CLASS =
  "h-9 w-full rounded-lg border bg-white px-3 text-[12px] outline-none placeholder:text-[#90938e] focus:ring-2 focus:ring-ring dark:bg-[#181912] dark:placeholder:text-[#747870]";
const LABEL_CLASS = "mb-1.5 block text-[11px] font-medium text-foreground";

export interface WebhookEditorDialogProps {
  editor: NotificationEditorState | null;
  /** Every channel this build can send through; drives the type dropdown and the fields. */
  providers: WebhookProviderDescriptor[];
  fieldError: "name" | "url" | null;
  saving: boolean;
  /** Why the last save was refused, shown here because the dialog covers the page. */
  error: string | null;
  /** Needed for the dirty check when editing an existing channel. */
  endpoints: WebhookEndpointPublic[];
  onChange: (patch: Partial<NotificationDraft>, touched?: Partial<NotificationDraftTouched>) => void;
  onSave: () => void;
  onClose: () => void;
}

export function WebhookEditorDialog(props: WebhookEditorDialogProps) {
  const { t } = usePreferences();
  const { editor, providers, endpoints, saving, fieldError, error } = props;
  if (!editor) return null;
  // The declaration for the channel being edited decides which fields appear at all —
  // no branch on the kind anywhere below.
  const provider = providers.find((candidate) => candidate.kind === editor.draft.kind);

  // Driven by the channel's own declaration, filtered by its capabilities, so no
  // branch on the kind appears below.
  const optionFields = webhookOptionFields(editor.draft.kind, provider?.capabilities);

  const stored = editor.mode === "edit" ? endpoints.find((candidate) => candidate.id === editor.id) : undefined;
  // Nothing to save when nothing changed. `save()` enforces this too; disabling the
  // button just makes it visible.
  const unchanged = editor.mode === "edit" && stored !== undefined && !notificationDraftIsDirty(editor.draft, stored, editor.touched);

  return (
    <Dialog onOpenChange={(open) => { if (!open) props.onClose(); }} open>
      <DialogContent
        className="flex max-h-[min(640px,calc(100vh-2rem))] w-[min(30rem,calc(100vw-2rem))] flex-col rounded-[10px] p-0"
        showCloseButton={false}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <DialogTitle className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {t(editor.mode === "create" ? "webhookDialogCreate" : "webhookDialogEdit")}
          </DialogTitle>
          <DialogClose asChild>
            <button
              aria-label={t("webhookCancel")}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mt-3 grid gap-3">
            <div>
              <label className={LABEL_CLASS} htmlFor="webhook-kind">
                {t("webhookFieldKind")}
              </label>
              <Select
                disabled={editor.mode === "edit"}
                onValueChange={(value) =>
                  // Options are per channel and their meanings differ, so they are
                  // cleared rather than carried across: DingTalk's `keyword` left
                  // behind on a Feishu endpoint is an unknown key, which the Feishu
                  // schema refuses, turning a channel switch into an unexplainable
                  // save failure.
                  props.onChange({ kind: value as WebhookKind, options: {} })
                }
                value={editor.draft.kind}
              >
                <SelectTrigger
                  className="h-9 w-full rounded-lg border-border bg-white px-3 text-left text-[12px] dark:bg-[#181912]"
                  id="webhook-kind"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((candidate) => (
                    <SelectItem key={candidate.kind} value={candidate.kind}>
                      {t(webhookProviderLabelKey(candidate.kind))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="webhook-name">
                {t("webhookFieldName")}
              </label>
              <input
                className={`${INPUT_CLASS} ${fieldError === "name" ? "border-destructive" : "border-border"}`}
                id="webhook-name"
                onChange={(event) => props.onChange({ name: event.target.value })}
                placeholder={t("webhookFieldNamePlaceholder")}
                value={editor.draft.name}
              />
              {fieldError === "name" ? (
                <p className="mt-1 text-[11px] text-destructive">{t("webhookFieldNameRequired")}</p>
              ) : null}
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="webhook-url">
                {t("webhookFieldUrl")}
              </label>
              <input
                className={`${INPUT_CLASS} ${fieldError === "url" ? "border-destructive" : "border-border"}`}
                id="webhook-url"
                onChange={(event) => props.onChange({ url: event.target.value }, { url: true })}
                placeholder={editor.mode === "edit" ? t("webhookFieldUrlStored") : provider?.credentialFields.find((field) => field.key === "url")?.urlHint ?? ""}
                type="password"
                value={editor.draft.url}
              />
              {editor.mode === "edit" && editor.urlMask && editor.draft.url === "" ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{editor.urlMask}</p>
              ) : null}
            </div>

            {provider?.capabilities.supportsSign ? (
              <div>
                <label className={LABEL_CLASS} htmlFor="webhook-sign-secret">
                  {t("webhookFieldSignSecret")}
                </label>
                <input
                  className={`${INPUT_CLASS} border-border`}
                  id="webhook-sign-secret"
                  onChange={(event) => props.onChange({ signSecret: event.target.value }, { signSecret: true })}
                  placeholder={t("webhookFieldSignSecretHelp")}
                  type="password"
                  value={editor.draft.signSecret}
                />
              </div>
            ) : null}

            {optionFields.length > 0 ? (
              <div className="border-t border-border pt-3">
                <p className="mb-2.5 text-[11px] font-medium text-muted-foreground">{t("webhookSectionOptions")}</p>
                <div className="grid gap-3.5">
                  {optionFields.map((field) => (
                    <WebhookOptionControl
                      field={field}
                      key={field.key}
                      onChange={props.onChange}
                      options={editor.draft.options}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-medium">{t("webhookFieldEnabled")}</span>
              <Switch
                aria-label={t("webhookFieldEnabled")}
                checked={editor.draft.enabled}
                onCheckedChange={(enabled) => props.onChange({ enabled })}
              />
            </div>
          </div>

        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="min-w-0 flex-1 text-[11px] leading-5 text-destructive">{error ?? ""}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={props.onClose} size="sm" type="button" variant="outline">
              {t("webhookCancel")}
            </Button>
            <Button disabled={saving || unchanged} onClick={props.onSave} size="sm" type="button">
              {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {t("webhookSave")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface WebhookOptionControlProps {
  field: WebhookOptionField;
  options: Record<string, unknown>;
  onChange: WebhookEditorDialogProps["onChange"];
}

/** One declared option, rendered by its control kind. */
function WebhookOptionControl({ field, options, onChange }: WebhookOptionControlProps) {
  const { t } = usePreferences();
  const id = `webhook-option-${field.key}`;
  const help = <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t(field.helpKey)}</p>;

  if (field.control === "toggle") {
    const label = t(field.labelKey);
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium">{label}</span>
          <Switch
            aria-label={label}
            checked={readOption(options, field.key)}
            onCheckedChange={(value) => onChange({ options: withOption(options, field.key, value) })}
          />
        </div>
        {help}
      </div>
    );
  }

  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={id}>
        {t(field.labelKey)}
      </label>
      {field.control === "text" ? (
        <input
          className={`${INPUT_CLASS} border-border`}
          id={id}
          onChange={(event) => onChange({ options: withTextOption(options, field.key, event.target.value) })}
          placeholder={t(field.placeholderKey)}
          value={readTextOption(options, field.key)}
        />
      ) : (
        <ListOptionInput
          id={id}
          onChange={(values) => onChange({ options: withListOption(options, field.key, values) })}
          placeholder={t(field.placeholderKey)}
          values={readListOption(options, field.key)}
        />
      )}
      {help}
    </div>
  );
}

/**
 * A list option in a single text box.
 *
 * The raw text is held here rather than derived from the parsed list, because
 * deriving it would delete the separator the moment it is typed: "138, " parses to
 * one number, which formats back without the comma, and the second number could then
 * never be entered. So the box keeps what the user typed and only pushes the parsed
 * value upward.
 *
 * That leaves one question — when is a change to `values` someone else's rather than
 * our own echo? `listOptionTextIsCurrent` answers it: if the text already parses to
 * the incoming value, it came from here. A channel switch clearing the options is the
 * case that must win, and it does not.
 */
function ListOptionInput({
  id,
  values,
  placeholder,
  onChange,
}: {
  id: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const incoming = formatListOption(values);
  const [text, setText] = useState(incoming);
  if (!listOptionTextIsCurrent(text, incoming)) setText(incoming);

  return (
    <input
      className={`${INPUT_CLASS} border-border`}
      id={id}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseListOption(event.target.value));
      }}
      placeholder={placeholder}
      value={text}
    />
  );
}
