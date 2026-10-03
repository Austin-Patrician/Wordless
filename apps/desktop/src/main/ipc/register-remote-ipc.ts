import { BrowserWindow, ipcMain } from "electron";
import { createRemoteAccessHandlers } from "../remote/handlers.ts";
import type { RemoteAccessService } from "../remote/remote-access-service.ts";

/**
 * 把远程访问的几个通道接到它们的处理器上。
 *
 * **刻意薄**:校验与调用都在 `remote/handlers.ts`(不 import Electron,可直接测),
 * 这样渲染层↔主进程的契约在类型上是看得见的 —— 与消息推送那边同一套做法。
 */
export interface RemoteIpcDeps {
  readonly service: RemoteAccessService;
}

export function registerRemoteIpc(deps: RemoteIpcDeps): void {
  const handlers = createRemoteAccessHandlers(deps.service);

  ipcMain.handle("wordless:remote:state", async () => await handlers.getState());
  ipcMain.handle("wordless:remote:set-enabled", async (_event, payload: unknown) => await handlers.setEnabled(payload));
  ipcMain.handle("wordless:remote:set-relay-url", async (_event, payload: unknown) => await handlers.setRelayUrl(payload));
  ipcMain.handle("wordless:remote:test-relay", async (_event, payload: unknown) => await handlers.testRelay(payload));
  ipcMain.handle("wordless:remote:create-invite", async () => await handlers.createInvite());
  ipcMain.handle("wordless:remote:withdraw-invite", async () => await handlers.withdrawInvite());
  ipcMain.handle("wordless:remote:revoke-device", async (_event, payload: unknown) => await handlers.revokeDevice(payload));

  /**
   * 状态**变了就推**,不让界面去猜。
   *
   * 少了这一条,设置页只在打开的那一刻取一次状态:手机扫码连上之后,设备列表永远停在"不在线",
   * 二维码也不会收起 —— 用户看到的是"我的手机连不上",而其实早就连上了。
   * 这类"主进程知道、界面不知道"的错位,只能靠推送消除。
   */
  // 服务与进程同寿,所以这里不需要退订。
  deps.service.subscribe(() => {
    const state = deps.service.getState();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("wordless:remote:changed", state);
    }
  });
}
