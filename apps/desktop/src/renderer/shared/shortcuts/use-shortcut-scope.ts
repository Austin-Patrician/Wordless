import { useEffect, useRef } from "react";
import { getShortcutScopeStack, type ShortcutScopeKind } from "./scope-stack";

export interface UseShortcutScopeOptions {
  id: string;
  kind: ShortcutScopeKind;
  /** While false the scope is not registered at all. Default true. */
  active?: boolean;
  exclusive?: boolean;
  enabled?: () => boolean;
  claim: (event: KeyboardEvent) => boolean;
}

/**
 * Registers a keyboard scope for as long as the component is mounted and
 * `active`. The callbacks are read from refs, so a scope that closes over
 * component state registers once instead of on every render.
 */
export function useShortcutScope({
  id,
  kind,
  active = true,
  exclusive = false,
  enabled,
  claim,
}: UseShortcutScopeOptions): void {
  const claimRef = useRef(claim);
  claimRef.current = claim;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!active) return;
    return getShortcutScopeStack().register({
      id,
      kind,
      exclusive,
      enabled: () => enabledRef.current?.() ?? true,
      claim: (event) => claimRef.current(event),
    }).dispose;
  }, [active, exclusive, id, kind]);
}
