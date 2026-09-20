import type { MenuItemConstructorOptions } from "electron";
import type { DesktopCommand, DesktopHostInfo, DesktopMenuId } from "@wordless/protocol";
import { getEffectiveShortcut, type ShortcutActionId, type ShortcutBindings } from "@wordless/domain";

/**
 * The application menu, with accelerators taken from the user's bindings.
 *
 * macOS is the only platform with a native menu, and a menu accelerator is
 * handled by the system before the page sees the key. Registering the stored key
 * therefore keeps the menu and the renderer in agreement: the menu shows the key
 * the user chose, and the old key stops working once it is rebound. Everything
 * here is pure so the template can be asserted without an Electron runtime.
 */

/** Binding tokens → the names Electron parses in an accelerator. */
const MODIFIER_NAMES: Record<string, string> = {
  mod: "CommandOrControl",
  ctrl: "Control",
  shift: "Shift",
  alt: "Alt",
};

const KEY_NAMES: Record<string, string> = {
  space: "Space",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
};

export function toElectronAccelerator(combo: string, platform: DesktopHostInfo["platform"]): string {
  const parts = combo.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts
    .slice(0, -1)
    // "CommandOrControl" means Control everywhere but macOS; spelling it out for
    // macOS keeps the label the user sees in the menu exactly what it does.
    .map((token) => (token === "mod" && platform === "darwin" ? "Command" : (MODIFIER_NAMES[token] ?? token)));
  const keyName = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...modifiers, keyName].join("+");
}

export interface MenuTemplateOptions {
  host: DesktopHostInfo;
  bindings: ShortcutBindings;
  /** Runs the command a menu item stands for. */
  run: (command: DesktopCommand) => void;
}

/** The configurable actions the menu carries a key for. Search has none yet. */
const MENU_SHORTCUT_ACTIONS = ["new-thread", "open-settings"] as const satisfies readonly ShortcutActionId[];

/** The keys the menu displays; a change here is what warrants rebuilding it. */
export function menuShortcutSignature(options: Omit<MenuTemplateOptions, "run">): string {
  return MENU_SHORTCUT_ACTIONS.map((actionId) => `${actionId}=${getEffectiveShortcut(actionId, options.bindings)}`).join("|");
}

function item(options: MenuTemplateOptions, label: string, command: DesktopCommand, actionId?: ShortcutActionId): MenuItemConstructorOptions {
  const accelerator = actionId ? toElectronAccelerator(getEffectiveShortcut(actionId, options.bindings), options.host.platform) : undefined;
  return { accelerator, click: () => options.run(command), label };
}

export function buildMenuItems(options: MenuTemplateOptions): Record<DesktopMenuId, MenuItemConstructorOptions[]> {
  return {
    file: [item(options, "New Thread", "new-thread", "new-thread"), { type: "separator" }, { role: "close" }],
    edit: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    // Search is advertised but not configurable: nothing handles that command yet.
    window: [item(options, "Search", "search"), item(options, "Settings", "open-settings", "open-settings"), { type: "separator" }, { role: "minimize" }, { role: "zoom" }],
    help: [item(options, "About Wordless", "show-about")],
  };
}

export function buildApplicationMenu(options: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const menus = buildMenuItems(options);
  return [
    {
      label: "Wordless",
      submenu: [
        { role: "about" },
        { type: "separator" },
        item(options, "Settings", "open-settings", "open-settings"),
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "File", submenu: menus.file },
    { label: "Edit", submenu: menus.edit },
    { label: "Window", submenu: menus.window },
    { label: "Help", submenu: menus.help },
  ];
}
