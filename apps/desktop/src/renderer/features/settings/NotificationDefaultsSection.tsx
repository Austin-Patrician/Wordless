import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@wordless/ui-kit";
import { LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NOTIFICATION_TEMPLATE_VARIABLES,
  type NotificationDefaults,
  type WebhookEndpointPublic,
} from "@wordless/protocol";
import type { MessageKey } from "../../shared/i18n";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";

/**
 * The global push subscription.
 *
 * This answers "what happens to an automation nobody configured", which is a
 * different question from the channel list above ("what can this machine send
 * through"). It lives on the same page because that is where the user is already
 * thinking about push, and every field here can be overridden per automation.
 *
 * The template is validated here as well as on save: a typo reaching a group chat is
 * read by everyone in it, so the field says so before the user leaves the page.
 */
const INPUT_CLASS =
  "h-9 w-full rounded-lg border bg-white px-3 text-[12px] outline-none placeholder:text-[#90938e] focus:ring-2 focus:ring-ring dark:bg-[#181912] dark:placeholder:text-[#747870]";
const LABEL_CLASS = "mb-1.5 block text-[11px] font-medium text-foreground";
export const TRANSIENT_MS = 3_000;

const WHEN_LABELS: Record<NotificationDefaults["when"], MessageKey> = {
  always: "notificationWhenAlways",
  success: "notificationWhenSuccess",
  failure: "notificationWhenFailure",
};

/** The built-in body, mirrored from the main process so the field starts non-empty. */
const DEFAULT_TEMPLATE = "{{duration}}\n\n{{reply}}\n\n{{error}}";

function templateProblem(template: string): MessageKey | null {
  if (template.trim() === "") return "notificationTemplateEmpty";
  const known = new Set<string>(NOTIFICATION_TEMPLATE_VARIABLES);
  for (const match of template.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
    if (!known.has(match[1])) return "notificationTemplateUnknownVariable";
  }
  return null;
}

export function NotificationDefaultsSection({ endpoints }: { endpoints: WebhookEndpointPublic[] }) {
  const { t } = usePreferences();
  const client = useRuntimeClient();

  const [defaults, setDefaults] = useState<NotificationDefaults | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await client.getNotificationDefaults();
        if (!cancelled) setDefaults(next);
      } catch (error) {
        if (!cancelled) setNotice({ ok: false, text: (error as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!notice?.ok) return;
    const timer = setTimeout(() => setNotice(null), TRANSIENT_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const problem = useMemo(
    () => (defaults?.template === undefined ? null : templateProblem(defaults.template)),
    [defaults?.template],
  );

  const update = useCallback((patch: Partial<NotificationDefaults>) => {
    setDefaults((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const toggleChannel = useCallback(
    (id: string, on: boolean) => {
      setDefaults((current) =>
        current
          ? { ...current, endpointIds: on ? [...current.endpointIds, id] : current.endpointIds.filter((value) => value !== id) }
          : current,
      );
    },
    [],
  );

  const save = useCallback(async () => {
    if (!defaults || saving || problem) return;
    setSaving(true);
    try {
      const result = await client.setNotificationDefaults({
        enabled: defaults.enabled,
        endpointIds: defaults.endpointIds,
        when: defaults.when,
        // An empty field means the built-in body, which the host then uses.
        ...(defaults.template === undefined ? {} : { template: defaults.template }),
      });
      if (!result.ok) {
        setNotice({ ok: false, text: t(result.code === "template-empty" ? "notificationTemplateEmpty" : "notificationTemplateUnknownVariable") });
        return;
      }
      setDefaults(result.defaults);
      setNotice({ ok: true, text: t("notificationDefaultsSaved") });
    } catch (error) {
      setNotice({ ok: false, text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }, [client, defaults, problem, saving, t]);

  if (!defaults) return null;

  return (
    <section className="rounded-2xl border border-border bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{t("notificationDefaults")}</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("notificationDefaultsHelp")}</p>
        </div>
        <Switch
          aria-label={t("notificationDefaultsEnabled")}
          checked={defaults.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
        />
      </div>

      <div className={`mt-4 space-y-3 ${defaults.enabled ? "" : "opacity-45"}`}>
        <div>
          <span className={LABEL_CLASS}>{t("notificationDefaultsChannels")}</span>
          {endpoints.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("notificationDefaultsNoChannels")}</p>
          ) : (
            <div className="divide-y divide-[#e1e1db] dark:divide-border">
              {endpoints.map((endpoint) => (
                <div className="flex items-center justify-between gap-3 py-2" key={endpoint.id}>
                  <div className="min-w-0">
                    <p className="truncate text-[12px]">{endpoint.name}</p>
                    {endpoint.urlMask ? <p className="truncate text-[11px] text-muted-foreground">{endpoint.urlMask}</p> : null}
                  </div>
                  <Switch
                    aria-label={endpoint.name}
                    checked={defaults.endpointIds.includes(endpoint.id)}
                    disabled={!defaults.enabled}
                    onCheckedChange={(on) => toggleChannel(endpoint.id, on)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className={LABEL_CLASS}>{t("notificationDefaultsWhen")}</span>
          <Select
            onValueChange={(value) => update({ when: value as NotificationDefaults["when"] })}
            value={defaults.when}
          >
            <SelectTrigger className="h-9 w-full rounded-lg border-border bg-white px-3 text-left text-[12px] dark:bg-[#181912]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["always", "success", "failure"] as const).map((when) => (
                <SelectItem key={when} value={when}>
                  {t(WHEN_LABELS[when])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="notification-template">
            {t("notificationDefaultsTemplate")}
          </label>
          <textarea
            className={`${INPUT_CLASS} min-h-[72px] py-2 ${problem ? "border-destructive" : "border-border"}`}
            disabled={!defaults.enabled}
            id="notification-template"
            onChange={(event) => update({ template: event.target.value })}
            value={defaults.template ?? DEFAULT_TEMPLATE}
          />
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {t("notificationDefaultsTemplateHelp").replace(
              "{vars}",
              NOTIFICATION_TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(" "),
            )}
          </p>
          {problem ? <p className="mt-1 text-[11px] text-destructive">{t(problem)}</p> : null}
        </div>

        <div className="flex items-center gap-2">
          <Button disabled={saving || problem !== null} onClick={() => void save()} size="sm" type="button">
            {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t("webhookSave")}
          </Button>
          {notice ? (
            <p className={`text-[12px] ${notice.ok ? "text-[#5d823e] dark:text-[#a8c47a]" : "text-destructive"}`}>{notice.text}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
