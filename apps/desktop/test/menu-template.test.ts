import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopCommand, DesktopHostInfo, DesktopMenuId } from "@wordless/protocol";
import type { MenuItemConstructorOptions } from "electron";
import { buildApplicationMenu, buildMenuItems, menuShortcutSignature, toElectronAccelerator } from "../src/main/menu/menu-template.ts";

function host(platform: DesktopHostInfo["platform"]): DesktopHostInfo {
  return {
    platform,
    arch: "x64",
    windowChrome: "overlay",
    menuPresentation: platform === "darwin" ? "system" : "in-window",
    modifier: platform === "darwin" ? "meta" : "control",
    shellFamily: "bash",
    capabilities: { dockBadge: false, nativeNotifications: true, titleBarOverlay: true },
  };
}

function acceleratorOf(items: MenuItemConstructorOptions[], label: string): string | undefined {
  return items.find((entry) => entry.label === label)?.accelerator;
}

test("binding tokens become the accelerator names Electron parses", () => {
  assert.equal(toElectronAccelerator("mod+n", "darwin"), "Command+N");
  assert.equal(toElectronAccelerator("mod+n", "win32"), "CommandOrControl+N");
  assert.equal(toElectronAccelerator("mod+shift+,", "darwin"), "Command+Shift+,");
  assert.equal(toElectronAccelerator("mod+ctrl+j", "darwin"), "Command+Control+J");
  assert.equal(toElectronAccelerator("alt+space", "win32"), "Alt+Space");
  // Named arrows are what Electron expects; "arrowleft" would be rejected.
  assert.equal(toElectronAccelerator("mod+arrowleft", "darwin"), "Command+Left");
});

test("the menu shows the key the user bound, not the one it shipped with", () => {
  const run = (): void => {};
  const defaults = buildMenuItems({ bindings: {}, host: host("darwin"), run });
  assert.equal(acceleratorOf(defaults.file, "New Thread"), "Command+N");
  assert.equal(acceleratorOf(defaults.window, "Settings"), "Command+,");

  const rebound = buildMenuItems({ bindings: { "open-settings": "mod+shift+," }, host: host("darwin"), run });
  // The old key must be gone, otherwise a rebound action answers to two keys.
  assert.equal(acceleratorOf(rebound.window, "Settings"), "Command+Shift+,");
  assert.equal(acceleratorOf(rebound.file, "New Thread"), "Command+N");
});

test("the window menu of the in-window platforms keeps its own spelling", () => {
  const items = buildMenuItems({ bindings: { "new-thread": "mod+alt+n" }, host: host("win32"), run: () => {} });
  assert.equal(acceleratorOf(items.file, "New Thread"), "CommandOrControl+Alt+N");
  assert.equal(acceleratorOf(items.window, "Settings"), "CommandOrControl+,");
});

test("the application menu carries the settings key on macOS too", () => {
  const appMenu = buildApplicationMenu({ bindings: {}, host: host("darwin"), run: () => {} });
  const submenu = appMenu[0]?.submenu as MenuItemConstructorOptions[];
  assert.equal(acceleratorOf(submenu, "Settings"), "Command+,");
  assert.deepEqual(appMenu.slice(1).map((entry) => entry.label), ["File", "Edit", "Window", "Help"]);
});

test("a menu item runs the command it stands for", () => {
  const commands: DesktopCommand[] = [];
  const items = buildMenuItems({ bindings: {}, host: host("darwin"), run: (command) => commands.push(command) });

  (items.window.find((entry) => entry.label === "Settings")?.click as () => void)();
  (items.file.find((entry) => entry.label === "New Thread")?.click as () => void)();
  (items.help.find((entry) => entry.label === "About Wordless")?.click as () => void)();

  assert.deepEqual(commands, ["open-settings", "new-thread", "show-about"]);
});

test("search is advertised without being configurable", () => {
  const items = buildMenuItems({ bindings: { "open-settings": "mod+j" }, host: host("darwin"), run: () => {} });
  assert.equal(acceleratorOf(items.window, "Search"), undefined);
  assert.equal((items.window as Array<{ role?: string }>).some((entry) => entry.role === "minimize"), true);
});

test("only a change to the shown keys changes the signature", () => {
  const darwin = host("darwin");
  const before = menuShortcutSignature({ bindings: {}, host: darwin });
  // Another preference changing must not make the menu rebuild, and a binding
  // that merely restates a default is not a change either.
  assert.equal(menuShortcutSignature({ bindings: {}, host: darwin }), before);
  assert.equal(menuShortcutSignature({ bindings: { "open-settings": "mod+," }, host: darwin }), before);
  assert.notEqual(menuShortcutSignature({ bindings: { "open-settings": "mod+j" }, host: darwin }), before);
});

test("menu ids stay the ones the protocol declares", () => {
  const ids: DesktopMenuId[] = ["file", "edit", "window", "help"];
  const items = buildMenuItems({ bindings: {}, host: host("win32"), run: () => {} });
  assert.deepEqual(Object.keys(items).sort(), [...ids].sort());
});
