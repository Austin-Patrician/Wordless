import type { WorkbenchMainView } from "./sidebar-nav";

/**
 * Which session's chat is on screen, as the host needs to hear it.
 *
 * The host suppresses a desktop notification only when the window is focused
 * *and* the output the notification is about is already visible. The renderer owns
 * the second half — it is the only side that knows what is drawn — and this is
 * that half, stated once so the list of things that cover the chat is in one place
 * instead of inline in a JSX file.
 *
 * Returning null is the important case: a focused window showing something *else*
 * must still notify. The previous rule ("any focused window suppresses") dropped
 * exactly that notification.
 */
export function foregroundSessionId(input: {
  mainView: WorkbenchMainView;
  selectedSessionId: string | null;
  /** The settings dialog is an overlay, so it covers the chat. */
  settingsOpen: boolean;
  /** The welcome screen or the tour, likewise. */
  tourActive: boolean;
}): string | null {
  if (input.mainView !== "thread") return null;
  if (input.settingsOpen || input.tourActive) return null;
  return input.selectedSessionId;
}
