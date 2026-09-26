import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@wordless/ui-kit";
import { LoaderCircle, PlugZap, Radar, Save, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DesktopProxyActive, DesktopProxySnapshot, ProxyTestFailure, ProxyTestResult } from "@wordless/protocol";
import type { MessageKey } from "../../shared/i18n";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import {
  proxyDraftFromSnapshot,
  proxyDraftIsDirty,
  proxyFormError,
  proxyPatchFromDraft,
  type ProxyDraft,
} from "./proxy-form";

const INPUT_CLASS =
  "h-9 w-full rounded-lg border bg-white px-3 text-[12px] outline-none placeholder:text-[#90938e] focus:ring-2 focus:ring-ring dark:bg-[#181912] dark:placeholder:text-[#747870]";
const LABEL_CLASS = "mb-1.5 block text-[11px] font-medium text-foreground";

/** How long a success message stays before it gets out of the way. */
export const TRANSIENT_MS = 3_000;

/**
 * Explicit maps rather than key templates: a template string is unchecked, so a
 * renamed key would fail silently at runtime instead of at type-check time.
 */
const SOURCE_LABEL: Record<DesktopProxyActive["source"], MessageKey> = {
  application: "proxySourceApplication",
  direct: "proxyStatusDirect",
  environment: "proxySourceEnvironment",
  system: "proxySourceSystem",
};

const TEST_FAILURE_LABEL: Record<ProxyTestFailure, MessageKey> = {
  invalid: "proxyTestInvalid",
  unreachable: "proxyTestUnreachable",
};

const FIELD_LABEL: Record<"host" | "port", MessageKey> = {
  host: "proxyFieldHost",
  port: "proxyFieldPort",
};

function fieldClass(invalid: boolean): string {
  return `${INPUT_CLASS} ${invalid ? "border-destructive" : "border-border"}`;
}

/**
 * The proxy section of General settings.
 *
 * A section rather than its own page because it owns a single record, not a
 * collection: every other settings page lists things (sessions, rules,
 * providers, shortcuts), and this one is six fields. It also matches the
 * reference implementation, where the same settings live under General.
 *
 * The form is explicit rather than auto-saving: writing a half-typed host into
 * the process environment would reconfigure the network on every keystroke, and
 * a save the user deliberately triggers is a save they can see succeed.
 *
 * The password field is never populated. It starts empty with a hint saying
 * whether one is stored, and an untouched field is omitted from the save, which
 * is what lets every other field change without wiping it.
 */
export function ProxySettingsSection() {
  const { t } = usePreferences();
  const { client } = useRuntime();

  const [snapshot, setSnapshot] = useState<DesktopProxySnapshot | null>(null);
  const [draft, setDraft] = useState<ProxyDraft | null>(null);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [test, setTest] = useState<ProxyTestResult | null>(null);
  const [notice, setNotice] = useState<{ kind: "attention" | "success"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: DesktopProxySnapshot) => {
    setSnapshot(next);
    setDraft(proxyDraftFromSnapshot(next.config));
    setPasswordTouched(false);
  }, []);

  useEffect(() => {
    if (!client) return;
    void client
      .getProxySnapshot()
      .then(adopt)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [adopt, client]);

  // A success message is an acknowledgement, not information: it confirms the
  // thing the user just did worked, and it stops being read after a moment.
  // Anything that still needs acting on — a failed test, an error, a warning —
  // stays until the user deals with it.
  useEffect(() => {
    if (notice?.kind !== "success") return;
    const timer = setTimeout(() => setNotice(null), TRANSIENT_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!test?.ok) return;
    const timer = setTimeout(() => setTest(null), TRANSIENT_MS);
    return () => clearTimeout(timer);
  }, [test]);

  // Nothing to show yet, but a failure still has to say so: an empty section with
  // no message is worse than a short one.
  if (!client || !draft || !snapshot) {
    return error ? <p className="text-[12px] text-destructive">{error}</p> : null;
  }

  const update = (patch: Partial<ProxyDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setTest(null);
    setNotice(null);
  };

  const fieldError = proxyFormError(draft);
  const dirty = proxyDraftIsDirty(draft, snapshot.config, passwordTouched);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      adopt(await client.setProxyConfig(proxyPatchFromDraft(draft, passwordTouched)));
      setNotice({ kind: "success", text: t("proxySaved") });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await client.testProxyConnection());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTesting(false);
    }
  };

  const detect = async () => {
    setDetecting(true);
    setError(null);
    try {
      const found = await client.detectLocalProxy();
      if (!found) {
        setNotice({ kind: "attention", text: t("proxyDetectNone") });
      } else {
        update({ enabled: true, protocol: "http", host: found.host, port: String(found.port) });
        setNotice({ kind: "success", text: t("proxyDetectFound").replace("{target}", `${found.host}:${found.port}`) });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDetecting(false);
    }
  };

  // Shown only when the process is using something the form does not show: an
  // environment variable or the OS proxy while this section has the proxy
  // switched off, or a configuration that cannot take effect at all. When the
  // form *is* what is in effect, saying so would just repeat it.
  const differsFromForm = snapshot.active.invalid || snapshot.active.source !== "application";
  const activeLine = snapshot.active.invalid
    ? t("proxyStatusInvalid")
    : `${t("proxyStatusTitle")}：${t(SOURCE_LABEL[snapshot.active.source])}${snapshot.active.target ? ` · ${snapshot.active.target}` : ""}`;

  return (
    <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
      <label className="block text-[13px] font-semibold">{t("proxy")}</label>
      <p className="mt-1 text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{t("proxyHelp")}</p>

      {differsFromForm ? (
        <p className={`mt-3 flex items-start gap-2 text-[11px] leading-5 ${snapshot.active.invalid ? "text-destructive" : "text-[#73736d] dark:text-muted-foreground"}`}>
          {snapshot.active.invalid ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
          <span>{activeLine}</span>
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-5">
        <span>
          <span className="block text-[12px] font-medium">{t("proxyEnabled")}</span>
          <span className="mt-0.5 block text-[11px] leading-5 text-[#73736d] dark:text-muted-foreground">{t("proxyEnabledHelp")}</span>
        </span>
        <Switch aria-label={t("proxyEnabled")} checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} />
      </div>

      {draft.enabled ? (
        <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            <label className="mb-3 block">
              <span className={LABEL_CLASS}>{t("proxyProtocol")}</span>
              <Select onValueChange={(value) => update({ protocol: value === "https" ? "https" : "http" })} value={draft.protocol}>
                <SelectTrigger className="h-9 w-full rounded-lg border-border bg-white px-3 text-left text-[12px] dark:bg-[#181912]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="https">HTTPS</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="mb-3 block">
              <span className={LABEL_CLASS}>{t("proxyHost")}</span>
              <input
                aria-invalid={fieldError === "host"}
                className={fieldClass(fieldError === "host")}
                onChange={(event) => update({ host: event.target.value })}
                placeholder="127.0.0.1"
                value={draft.host}
              />
            </label>
          </div>
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            <label className="mb-3 block">
              <span className={LABEL_CLASS}>{t("proxyPort")}</span>
              <input
                aria-invalid={fieldError === "port"}
                className={fieldClass(fieldError === "port")}
                inputMode="numeric"
                onChange={(event) => update({ port: event.target.value })}
                placeholder="7890"
                value={draft.port}
              />
            </label>
            <label className="mb-3 block">
              <span className={LABEL_CLASS}>{t("proxyUsername")}</span>
              <input
                className={fieldClass(false)}
                onChange={(event) => update({ username: event.target.value })}
                value={draft.username}
              />
            </label>
          </div>
          <label className="block">
            <span className={LABEL_CLASS}>{t("proxyPassword")}</span>
            <input
              className={fieldClass(false)}
              onChange={(event) => {
                setPasswordTouched(true);
                update({ password: event.target.value });
              }}
              placeholder={snapshot.config.passwordConfigured ? t("proxyPasswordStored") : t("proxyPasswordEmpty")}
              type="password"
              value={draft.password}
            />
            <span className="mt-1.5 block text-[11px] leading-5 text-[#73736d] dark:text-muted-foreground">{t("proxyPasswordHelp")}</span>
          </label>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={saving || !dirty || fieldError !== null} onClick={() => void save()} size="sm" type="button">
          {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t("proxySave")}
        </Button>
        <Button disabled={testing || !draft.enabled} onClick={() => void runTest()} size="sm" type="button" variant="outline">
          {testing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
          {t("proxyTest")}
        </Button>
        <Button disabled={detecting} onClick={() => void detect()} size="sm" type="button" variant="outline">
          {detecting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
          {t("proxyDetect")}
        </Button>
      </div>

      {test || notice || error || fieldError ? (
        <div className="mt-3 space-y-1.5 text-[11px]">
          {fieldError ? <p className="text-destructive">{t(FIELD_LABEL[fieldError])}</p> : null}
          {test ? (
            <p className={test.ok ? "text-[#6f8b2f] dark:text-[#c8df89]" : "text-destructive"}>
              {test.ok ? t("proxyTestOk") : t(TEST_FAILURE_LABEL[test.reason])}
            </p>
          ) : null}
          {notice ? <p className="text-[#73736d] dark:text-muted-foreground">{notice.text}</p> : null}
          {error ? <p className="text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
