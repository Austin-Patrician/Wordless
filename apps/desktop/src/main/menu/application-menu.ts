import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import type { DesktopCommand, DesktopHostInfo, DesktopMenuId } from "@wordless/protocol";

function emitCommand(command: DesktopCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("wordless:host-event", { type: "command", command });
}

function item(label: string, command: DesktopCommand, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, click: () => emitCommand(command) };
}

function submenus(): Record<DesktopMenuId, MenuItemConstructorOptions[]> {
  return {
    file: [item("New Thread", "new-thread", "CommandOrControl+N"), { type: "separator" }, { role: "close" }],
    edit: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    window: [item("Search", "search", "CommandOrControl+K"), item("Settings", "open-settings", "CommandOrControl+,") , { type: "separator" }, { role: "minimize" }, { role: "zoom" }],
    help: [item("About Wordless", "show-about")],
  };
}

export class ApplicationMenuController {
  private readonly menus = submenus();
  private readonly host: DesktopHostInfo;

  constructor(host: DesktopHostInfo) {
    this.host = host;
  }

  install(): void {
    if (this.host.menuPresentation !== "system") {
      Menu.setApplicationMenu(null);
      return;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: "Wordless",
        submenu: [{ role: "about" }, { type: "separator" }, item("Settings", "open-settings", "Command+,") , { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }],
      },
      { label: "File", submenu: this.menus.file },
      { label: "Edit", submenu: this.menus.edit },
      { label: "Window", submenu: this.menus.window },
      { label: "Help", submenu: this.menus.help },
    ]));
  }

  show(menuId: DesktopMenuId, window: BrowserWindow): void {
    if (this.host.menuPresentation === "system") return;
    Menu.buildFromTemplate(this.menus[menuId]).popup({ window });
  }
}
