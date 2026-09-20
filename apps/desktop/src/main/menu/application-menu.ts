import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import type { DesktopCommand, DesktopHostInfo, DesktopMenuId } from "@wordless/protocol";
import type { ShortcutBindings } from "@wordless/domain";
import { buildApplicationMenu, buildMenuItems, menuShortcutSignature, type MenuTemplateOptions } from "./menu-template";

function emitCommand(command: DesktopCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("wordless:host-event", { type: "command", command });
}

export class ApplicationMenuController {
  private readonly host: DesktopHostInfo;
  private bindings: ShortcutBindings;
  private shortcutSignature: string;

  constructor(host: DesktopHostInfo, bindings: ShortcutBindings = {}) {
    this.host = host;
    this.bindings = bindings;
    this.shortcutSignature = menuShortcutSignature({ host, bindings });
  }

  /**
   * Redraws the menu with the user's keys.
   *
   * Called for every preference change, so it compares the keys the menu shows
   * and does nothing when an unrelated preference moved.
   */
  applyShortcutBindings(bindings: ShortcutBindings): void {
    const signature = menuShortcutSignature({ host: this.host, bindings });
    if (signature === this.shortcutSignature) return;
    this.bindings = bindings;
    this.shortcutSignature = signature;
    if (this.host.menuPresentation === "system") this.install();
  }

  private templateOptions(): MenuTemplateOptions {
    return { bindings: this.bindings, host: this.host, run: emitCommand };
  }

  install(): void {
    if (this.host.menuPresentation !== "system") {
      Menu.setApplicationMenu(null);
      return;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenu(this.templateOptions())));
  }

  show(menuId: DesktopMenuId, window: BrowserWindow): void {
    if (this.host.menuPresentation === "system") return;
    const items: MenuItemConstructorOptions[] = buildMenuItems(this.templateOptions())[menuId];
    Menu.buildFromTemplate(items).popup({ window });
  }
}
