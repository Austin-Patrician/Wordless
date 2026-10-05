import { ipcMain } from "electron";
import { createRemoteAccessHandlers, type RemoteAccessHandlerPaths } from "../remote/handlers.ts";
import type { RemoteAccessService } from "../remote/remote-access-service.ts";
import { sendToRendererWindow, type RendererWindowLike } from "../renderer-window.ts";

/**
 * 把远程访问的几个通道接到它们的处理器上。
 *
 * **刻意薄**:校验与调用都在 `remote/handlers.ts`(不 import Electron,可直接测),
 * 这样渲染层↔主进程的契约在类型上是看得见的 —— 与消息推送那边同一套做法。
 */
export interface RemoteIpcDeps {
  readonly service: RemoteAccessService;
  /**
   * 应用窗口(晚绑定:注册时它可能还没建出来)。
   *
   * 事件只发给它,不发给"所有窗口" —— 辅助窗口(OCR 运行器、设计离屏栅格池)不订阅这些事件,
   * 而且随时在关;往一个正在关掉的窗口发,就是那句 "Render frame was disposed"(见 `renderer-window.ts`)。
   */
  readonly getWindow: () => RendererWindowLike | undefined;
  /** 部署包相关的路径(要 `app.getPath`,所以由调用方给)。 */
  readonly paths: RemoteAccessHandlerPaths;
}

export function registerRemoteIpc(deps: RemoteIpcDeps): void {
  const handlers = createRemoteAccessHandlers(deps.service, deps.paths, {
    /**
     * 部署进度**逐步推给渲染层**。
     *
     * 自动部署要跑几分钟(装 Node、起服务),没有进度就只能看着一个转圈猜;
     * 失败时那一步的输出也要能看到 —— 否则"部署失败"四个字等于没说。
     */
    onDeployProgress: (progress) => {
      sendToRendererWindow(deps.getWindow(), "wordless:remote:deploy-progress", progress);
    },
  });

  ipcMain.handle("wordless:remote:state", async () => await handlers.getState());
  ipcMain.handle("wordless:remote:set-enabled", async (_event, payload: unknown) => await handlers.setEnabled(payload));
  ipcMain.handle("wordless:remote:set-relay-url", async (_event, payload: unknown) => await handlers.setRelayUrl(payload));
  ipcMain.handle("wordless:remote:set-mode", async (_event, payload: unknown) => await handlers.setMode(payload));
  ipcMain.handle("wordless:remote:prepare-deploy-bundle", async () => await handlers.prepareDeployBundle());
  ipcMain.handle("wordless:remote:deploy-plan", async (_event, payload: unknown) => await handlers.deployPlan(payload));
  ipcMain.handle("wordless:remote:deploy-probe", async (_event, payload: unknown) => await handlers.deployProbe(payload));
  ipcMain.handle("wordless:remote:deploy-run", async (_event, payload: unknown) => await handlers.deployRun(payload));
  ipcMain.handle("wordless:remote:deploy-cancel", async () => await handlers.deployCancel());
  // 撤下来:停服务 / 卸载(与部署同一套"先看计划再执行";进度走同一个事件)。
  ipcMain.handle("wordless:remote:uninstall-plan", async (_event, payload: unknown) => await handlers.uninstallPlan(payload));
  ipcMain.handle("wordless:remote:uninstall-run", async (_event, payload: unknown) => await handlers.uninstallRun(payload));
  ipcMain.handle("wordless:remote:set-lan-mode", async (_event, payload: unknown) => await handlers.setLanMode(payload));
  ipcMain.handle("wordless:remote:set-lan-address", async (_event, payload: unknown) => await handlers.setLanAddress(payload));
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
    sendToRendererWindow(deps.getWindow(), "wordless:remote:changed", state);
  });
}
