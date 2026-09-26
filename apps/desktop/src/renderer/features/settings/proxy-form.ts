import type {
  DesktopProxyConfigPatch,
  DesktopProxyConfigSnapshot,
  DesktopProxyProtocol,
} from "@wordless/protocol";

/**
 * Form state for the proxy settings page, kept apart from the component so the
 * parts that can be wrong are testable.
 *
 * The port is held as a string because it is a text field: round-tripping it
 * through a number would fight the user mid-typing, and an empty field has to
 * stay empty rather than collapsing to 0.
 */
export type ProxyDraft = {
  enabled: boolean;
  protocol: DesktopProxyProtocol;
  host: string;
  port: string;
  username: string;
  password: string;
};

export function proxyDraftFromSnapshot(config: DesktopProxyConfigSnapshot): ProxyDraft {
  return {
    enabled: config.enabled,
    protocol: config.protocol,
    host: config.host,
    // A stored port of 0 is our "never set" value; showing it would be noise.
    port: config.port === 0 ? "" : String(config.port),
    username: config.username,
    password: "",
  };
}

/**
 * The patch to save.
 *
 * The password is included only when the user actually typed in the field. The
 * page never receives the stored password, so omitting it is the only way to
 * change any other field without wiping it — and an explicit empty string is
 * still how the user clears one.
 */
export function proxyPatchFromDraft(draft: ProxyDraft, passwordTouched: boolean): DesktopProxyConfigPatch {
  const parsed = Number.parseInt(draft.port.trim(), 10);
  return {
    enabled: draft.enabled,
    protocol: draft.protocol,
    host: draft.host.trim(),
    // An unparsable or empty port is sent as 0, which the host reports as
    // invalid rather than silently substituting a default and connecting
    // somewhere the user did not ask for.
    port: Number.isFinite(parsed) ? parsed : 0,
    username: draft.username.trim(),
    ...(passwordTouched ? { password: draft.password } : {}),
  };
}

/** Field-level problem, or null. Empty host/port only matter once enabled. */
export function proxyFormError(draft: ProxyDraft): "host" | "port" | null {
  if (!draft.enabled) return null;
  if (draft.host.trim() === "") return "host";
  const port = Number.parseInt(draft.port.trim(), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65_535) return "port";
  return null;
}

/** Whether the draft differs from what is stored, ignoring the password. */
export function proxyDraftIsDirty(draft: ProxyDraft, config: DesktopProxyConfigSnapshot, passwordTouched: boolean): boolean {
  if (passwordTouched) return true;
  const stored = proxyDraftFromSnapshot(config);
  return (
    draft.enabled !== stored.enabled ||
    draft.protocol !== stored.protocol ||
    draft.host !== stored.host ||
    draft.port !== stored.port ||
    draft.username !== stored.username
  );
}
