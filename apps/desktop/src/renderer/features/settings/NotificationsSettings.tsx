import { Button, Switch } from "@wordless/ui-kit";
import { BellRing, LoaderCircle, Pencil, Plus, Send, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  WebhookEndpointPublic,
  WebhookKind,
  WebhookMessage,
  WebhookProviderDescriptor,
} from "@wordless/protocol";
import type { MessageKey } from "../../shared/i18n";
import { NotificationDefaultsSection } from "./NotificationDefaultsSection";
import { WebhookEditorDialog } from "./WebhookEditorDialog";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import {
  UNTOUCHED_DRAFT,
  emptyNotificationDraft,
  firstProviderKind,
  notificationCreateInput,
  notificationDraftFromEndpoint,
  notificationDraftIsDirty,
  notificationFormError,
  notificationUpdatePatch,
  webhookMutationField,
  webhookMutationMessageKey,
  webhookProviderLabelKey,
  webhookSendMessageKey,
  webhookSendWasDegraded,
  type NotificationDraft,
  type NotificationDraftTouched,
  type NotificationEditorState,
} from "./notification-form";
import { readOption, withOption } from "./webhook-options";

/** How long a success message stays before it gets out of the way. */
export const TRANSIENT_MS = 3_000;

type Notice = { ok: boolean; text: string };

/**
 * Message push settings.
 *
 * Its own page rather than a section inside General: unlike the proxy, which owns
 * a single record, this owns a *collection*. Every other collection in the app —
 * sessions, shortcuts, providers — gets a page, and so does this.
 *
 * Editing happens in an inline panel instead of a nested dialog. The settings
 * dialog is already a Radix dialog, and stacking a second one inside it brings
 * focus-trap and z-index problems for no gain over a panel that appears above the
 * list.
 *
 * No credential ever reaches this component: rows carry a masked address and a
 * "a key is stored" flag, and the editor starts with both fields empty. An
 * untouched field is omitted from the save, which is the only way to change an
 * unrelated field without wiping what is stored.
 */
export function NotificationsSettings() {
  const { t } = usePreferences();
  // The non-null accessor: this page is useless without the bridge, and the 22
  // other screens that need the client use the same one.
  const client = useRuntimeClient();

  const [endpoints, setEndpoints] = useState<WebhookEndpointPublic[]>([]);
  const [providers, setProviders] = useState<WebhookProviderDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<NotificationEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fieldError, setFieldError] = useState<"name" | "url" | null>(null);

  const refresh = useCallback(async () => {
    const [nextEndpoints, nextProviders] = await Promise.all([
      client.listWebhookEndpoints(),
      client.listWebhookProviders(),
    ]);
    setEndpoints(nextEndpoints);
    setProviders(nextProviders);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextEndpoints, nextProviders] = await Promise.all([
          client.listWebhookEndpoints(),
          client.listWebhookProviders(),
        ]);
        if (cancelled) return;
        setEndpoints(nextEndpoints);
        setProviders(nextProviders);
      } catch (error) {
        if (!cancelled) setNotice({ ok: false, text: (error as Error).message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Success messages get out of the way; failures stay until the next action,
  // because a failure is something the user has to read.
  useEffect(() => {
    if (!notice?.ok) return;
    const timer = setTimeout(() => setNotice(null), TRANSIENT_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const startCreate = useCallback(() => {
    const kind = firstProviderKind(providers);
    if (!kind) return;
    setEditor({ mode: "create", draft: emptyNotificationDraft(kind), touched: { ...UNTOUCHED_DRAFT } });
    setFieldError(null);
    setNotice(null);
  }, [providers]);

  const startEdit = useCallback((endpoint: WebhookEndpointPublic) => {
    setEditor({
      mode: "edit",
      id: endpoint.id,
      draft: notificationDraftFromEndpoint(endpoint),
      touched: { ...UNTOUCHED_DRAFT },
      ...(endpoint.urlMask ? { urlMask: endpoint.urlMask } : {}),
    });
    setFieldError(null);
    setNotice(null);
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setFieldError(null);
  }, []);

  const update = useCallback((patch: Partial<NotificationDraft>, touched?: Partial<NotificationDraftTouched>) => {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        draft: { ...current.draft, ...patch },
        touched: touched ? { ...current.touched, ...touched } : current.touched,
      };
    });
  }, []);

  const save = useCallback(async () => {
    if (!editor || saving) return;
    // A blank address is only allowed when editing and the user left it alone:
    // that is the case where the stored one is kept.
    const urlRequired = editor.mode === "create" || editor.touched.url;
    const local = notificationFormError(editor.draft, { urlRequired });
    if (local) {
      setFieldError(local);
      return;
    }
    setFieldError(null);
    setSaving(true);
    try {
      const result =
        editor.mode === "create"
          ? await client.createWebhookEndpoint(notificationCreateInput(editor.draft))
          : await client.updateWebhookEndpoint(editor.id, notificationUpdatePatch(editor.draft, editor.touched));
      if (!result.ok) {
        const field = webhookMutationField(result.code);
        if (field === "url" || field === "signSecret") setFieldError("url");
        else setFieldError(null);
        setNotice({ ok: false, text: t(webhookMutationMessageKey(result.code)) });
        return;
      }
      await refresh();
      setEditor(null);
      setNotice({ ok: true, text: t("webhookSaved") });
    } catch (error) {
      setNotice({ ok: false, text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }, [client, editor, refresh, saving, t]);

  const toggle = useCallback(
    async (endpoint: WebhookEndpointPublic, enabled: boolean) => {
      try {
        const result = await client.setWebhookEndpointEnabled(endpoint.id, enabled);
        if (!result.ok) {
          setNotice({ ok: false, text: t(webhookMutationMessageKey(result.code)) });
          return;
        }
        await refresh();
      } catch (error) {
        setNotice({ ok: false, text: (error as Error).message });
      }
    },
    [client, refresh, t],
  );

  const remove = useCallback(
    async (endpoint: WebhookEndpointPublic) => {
      try {
        await client.deleteWebhookEndpoint(endpoint.id);
        await refresh();
        setNotice({ ok: true, text: t("webhookSaved") });
      } catch (error) {
        setNotice({ ok: false, text: (error as Error).message });
      }
    },
    [client, refresh, t],
  );

  /**
   * The test text is built here, not in the main process: automating the host's
   * own copy table for one string would be a second place to keep in sync, and the
   * host can run scheduled work with no window at all.
   */
  const sendTest = useCallback(
    async (endpoint: WebhookEndpointPublic) => {
      setTesting(endpoint.id);
      setNotice(null);
      try {
        const message: WebhookMessage = {
          title: t("webhookTestTitle"),
          text: t("webhookTestText").replace("{time}", new Date().toLocaleString()),
          level: "info",
        };
        const result = await client.testWebhookEndpoint(endpoint.id, message);
        if (result.ok) {
          setNotice({ ok: true, text: t(webhookSendWasDegraded(result) ? "webhookTestDegraded" : "webhookTestOk") });
        } else {
          setNotice({ ok: false, text: t("webhookTestFailed").replace("{reason}", t(webhookSendMessageKey(result.code))) });
        }
      } catch (error) {
        setNotice({ ok: false, text: (error as Error).message });
      } finally {
        setTesting(null);
      }
    },
    [client, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Feedback lives above the list and outside the scroll area: testing the
          last of several channels should not require scrolling back up to find out
          whether it worked. */}
      <div className="shrink-0 px-6 pt-6 sm:px-9">
        <div className="mx-auto max-w-[680px] space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium">{t("webhookChannels")}</p>
              <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{t("webhookChannelsHelp")}</p>
            </div>
            <Button disabled={providers.length === 0} onClick={startCreate} size="sm" type="button">
              <Plus className="h-3.5 w-3.5" />
              {t("webhookAdd")}
            </Button>
          </div>
          {notice ? (
            <p className={`text-[12px] leading-5 ${notice.ok ? "text-[#5d823e] dark:text-[#a8c47a]" : "text-destructive"}`}>
              {notice.text}
            </p>
          ) : null}
        </div>
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3 sm:px-9">
        <div className="mx-auto max-w-[680px] space-y-2.5">

          {loading ? (
            <p className="flex items-center gap-2 px-1 py-6 text-[12px] text-muted-foreground">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {t("webhookChannels")}
            </p>
          ) : endpoints.length === 0 ? (
            <section className="rounded-2xl bg-[#f7f7f5] p-6 text-center dark:bg-[#22241c]">
              <BellRing className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-[12px] font-medium">{t("webhookEmpty")}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("webhookEmptyHelp")}</p>
            </section>
          ) : (
            <section className="divide-y divide-[#e9e9e4] rounded-2xl bg-[#f7f7f5] px-4 dark:divide-border dark:bg-[#22241c]">
              {endpoints.map((endpoint) => (
                <div className="flex items-center justify-between gap-3 py-3" key={endpoint.id}>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{endpoint.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {t(webhookProviderLabelKey(endpoint.kind))}
                      {endpoint.urlMask ? ` · ${endpoint.urlMask}` : ""}
                      {` · ${t(endpoint.hasSignSecret ? "webhookSignSecretSet" : "webhookSignSecretMissing")}`}
                      {/* A row that silently pings the whole group should say so
                          without having to be opened. */}
                      {readOption(endpoint.options, "mentionAll") ? ` · ${t("webhookMentionAllOn")}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      disabled={testing === endpoint.id}
                      onClick={() => void sendTest(endpoint)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {testing === endpoint.id ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      {t(testing === endpoint.id ? "webhookTestSending" : "webhookTest")}
                    </Button>
                    <Button aria-label={t("webhookEdit")} onClick={() => startEdit(endpoint)} size="sm" type="button" variant="ghost">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button aria-label={t("webhookDelete")} onClick={() => void remove(endpoint)} size="sm" type="button" variant="ghost">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Switch
                      aria-label={t("webhookEnabled")}
                      checked={endpoint.enabled}
                      onCheckedChange={(enabled) => void toggle(endpoint, enabled)}
                    />
                  </div>
                </div>
              ))}
            </section>
          )}

          <NotificationDefaultsSection endpoints={endpoints} />

          <p className="flex items-start gap-1.5 px-1 text-[11px] leading-5 text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            {t("webhookSecurityNote")}
          </p>
        </div>
      </section>

      {/* Portals above the page, so it can live anywhere in the tree. */}
      <WebhookEditorDialog
        editor={editor}
        endpoints={endpoints}
        error={notice && !notice.ok ? notice.text : null}
        fieldError={fieldError}
        onChange={update}
        onClose={closeEditor}
        onSave={() => void save()}
        providers={providers}
        saving={saving}
      />
    </div>
  );
}
