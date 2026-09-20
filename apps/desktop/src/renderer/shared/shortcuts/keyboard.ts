/**
 * Key event serialization for global shortcuts.
 *
 * Bindings are written the way the native menu writes accelerators
 * (`CommandOrControl+,`): "mod" is the platform command key — Command on
 * macOS, Control elsewhere. The dispatcher and, later, the settings recorder
 * share this module so a recorded binding always matches a pressed key.
 */

/** The platform command key. */
export type ShortcutModifier = "meta" | "control";

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);

export function shortcutModifier(platform: string | undefined): ShortcutModifier {
  return platform === "darwin" ? "meta" : "control";
}

/**
 * Serializes a key event as `mod+ctrl+shift+alt+key`, or null when the event is
 * not a shortcut. `key` is lowercased, so `mod+n` matches both `n` and `N`.
 */
export function shortcutFromEvent(event: KeyboardEvent, modifier: ShortcutModifier): string | null {
  // An input method owns the keystroke while it is composing.
  if (event.isComposing) return null;
  const key = event.key;
  // A bare modifier press is never a shortcut on its own.
  if (!key || MODIFIER_KEYS.has(key)) return null;

  const parts: string[] = [];
  if (modifier === "meta" ? event.metaKey : event.ctrlKey) parts.push("mod");
  // On macOS Control is an extra modifier next to Command, so `Ctrl+N` must not
  // read as `mod+n`. On the other platforms Control *is* mod and the two cannot
  // be told apart.
  if (modifier === "meta" && event.ctrlKey) parts.push("ctrl");
  if (event.shiftKey) parts.push("shift");
  if (event.altKey) parts.push("alt");
  parts.push(key === " " ? "space" : key.toLowerCase());
  return parts.join("+");
}

export function matchesShortcut(event: KeyboardEvent, combo: string, modifier: ShortcutModifier): boolean {
  return shortcutFromEvent(event, modifier) === combo;
}

/**
 * Each platform is written the way its own system settings are: macOS glues the
 * glyphs in Apple's order ("⇧⌘,"), the others separate the words
 * ("Ctrl + Shift + ,") because "Ctrl N" reads as two keys rather than a chord.
 */
const MODIFIER_ORDER: Record<ShortcutModifier, readonly string[]> = {
  meta: ["ctrl", "alt", "shift", "mod"],
  control: ["mod", "ctrl", "shift", "alt"],
};

const MODIFIER_LABELS: Record<ShortcutModifier, Record<string, string>> = {
  meta: { mod: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥" },
  control: { mod: "Ctrl", ctrl: "Ctrl", shift: "Shift", alt: "Alt" },
};

/** Named keys worth spelling out; anything else is shown as written. */
const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Del",
  tab: "Tab",
};

/** macOS names the same keys with a symbol. */
const MAC_KEY_GLYPHS: Record<string, string> = {
  escape: "⎋",
  enter: "↩",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
};

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
}

/** "mod+shift+," → "Ctrl + Shift + ," on Windows and Linux. */
function formatShortcutForWords(combo: string): string {
  const parts = combo.split("+");
  const key = parts.at(-1) ?? "";
  const present = parts.slice(0, -1);
  // Written order is normally already canonical; sorting keeps a stored combo
  // that is not from showing its modifiers in a jumbled order.
  const labels = MODIFIER_ORDER.control.filter((token) => present.includes(token)).map((token) => MODIFIER_LABELS.control[token] ?? token);
  return [...labels, keyLabel(key)].join(" + ");
}

/** "mod+shift+," → "⇧⌘," on macOS, the way its menus write it. */
function formatShortcutForGlyphs(combo: string): string {
  const parts = combo.split("+");
  const key = parts.at(-1) ?? "";
  const present = parts.slice(0, -1);
  const glyphs = MODIFIER_ORDER.meta.filter((token) => present.includes(token)).map((token) => MODIFIER_LABELS.meta[token] ?? token);
  return [...glyphs, MAC_KEY_GLYPHS[key] ?? keyLabel(key)].join("");
}

export function formatShortcut(combo: string, modifier: ShortcutModifier): string {
  return modifier === "meta" ? formatShortcutForGlyphs(combo) : formatShortcutForWords(combo);
}
