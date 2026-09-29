import { ipcMain } from "electron";
import { Value } from "typebox/value";
import {
  DesignListRequestSchema,
  DesignMoveFramesRequestSchema,
  DesignOpenRequestSchema,
  ApplyDesignStyleRequestSchema,
  CreateDesignFrameRequestSchema,
  DesignExportRequestSchema,
  DeleteDesignFrameRequestSchema,
  DesignRefreshRequestSchema,
  DesignUpdateFrameMetaRequestSchema,
  CreateDesignRequestSchema,
  DesignCopyImageRequestSchema,
  DesignSaveImageRequestSchema,
  isDesignImagePayload,
  DesignLiveFrameRequestSchema,
  DesignRasterRequestSchema,
  DesignStyleDetailRequestSchema,
} from "@wordless/protocol";
import type { DesignHandlers } from "../design/handlers.ts";

/**
 * 设计画布的两条通道。
 *
 * 载荷校验走 DTO 里那份 schema(`additionalProperties: false`),所以形状不一致在这里
 * 就被挡住,而不是变成渲染层一个看不懂的 `undefined`。
 */

export const DESIGN_LIST_CHANNEL = "wordless:design:list";
export const DESIGN_OPEN_CHANNEL = "wordless:design:open";
export const DESIGN_REFRESH_CHANNEL = "wordless:design:refresh";
export const DESIGN_MOVE_FRAMES_CHANNEL = "wordless:design:move-frames";
export const DESIGN_CREATE_FRAME_CHANNEL = "wordless:design:create-frame";
export const DESIGN_DELETE_FRAME_CHANNEL = "wordless:design:delete-frame";
export const DESIGN_EXPORT_CHANNEL = "wordless:design:export";
export const DESIGN_APPLY_STYLE_CHANNEL = "wordless:design:apply-style";
export const DESIGN_UPDATE_FRAME_META_CHANNEL = "wordless:design:update-frame-meta";
export const DESIGN_RASTERIZE_CHANNEL = "wordless:design:rasterize";
export const DESIGN_LIVE_FRAME_CHANNEL = "wordless:design:live-frame";
export const DESIGN_STYLES_CHANNEL = "wordless:design:styles";
export const DESIGN_STYLE_DETAIL_CHANNEL = "wordless:design:style-detail";
export const DESIGN_CREATE_CHANNEL = "wordless:design:create";
export const DESIGN_SAVE_IMAGE_CHANNEL = "wordless:design:save-image";
export const DESIGN_COPY_IMAGE_CHANNEL = "wordless:design:copy-image";

/** 解码渲染层送上来的 base64。空载荷在上面就被 schema 挡掉了。 */
function decodeDesignImage(data: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(data, "base64");
  // `Buffer` 是 `Uint8Array` 的一个视图,但它常常背在共享的池子上 —— 复制一份交给下游
  // (写文件与剪贴板都会持有它一段时间)。
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

export interface DesignIpcDeps {
  handlers: DesignHandlers;
}

export function registerDesignIpc(deps: DesignIpcDeps): void {
  ipcMain.handle(DESIGN_LIST_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignListRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.listDesigns(payload as { root: string });
  });

  ipcMain.handle(DESIGN_OPEN_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignOpenRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.openDesign(payload as { path: string });
  });

  ipcMain.handle(DESIGN_REFRESH_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignRefreshRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.refreshDesign(payload as { path: string; force?: boolean });
  });

  ipcMain.handle(DESIGN_MOVE_FRAMES_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignMoveFramesRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.moveFrames(payload as { path: string; moves: { frameId: string; x: number; y: number }[] });
  });

  ipcMain.handle(DESIGN_CREATE_FRAME_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(CreateDesignFrameRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.createFrame(
      payload as { path: string; title?: string; width?: number; height?: number },
    );
  });

  ipcMain.handle(DESIGN_DELETE_FRAME_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DeleteDesignFrameRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.deleteFrame(payload as { path: string; frameId: string });
  });

  ipcMain.handle(DESIGN_APPLY_STYLE_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(ApplyDesignStyleRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.applyStyle(payload as { path: string; styleId: string });
  });

  ipcMain.handle(DESIGN_EXPORT_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignExportRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.exportDesign(payload as { path: string; what: "frames" | "assets" });
  });

  /**
   * 存一张合成图。
   *
   * 图在载荷里是 **base64**,所以它能被 schema 校验(`maxLength` 就是上限)。原来的写法是把
   * 几 MB 的 `Uint8Array` 当**独立实参**递过来 —— 而那正是它一直失败的地方:这条通道要过
   * `contextBridge`,类型化数组在那儿不可靠(见 `DesignSaveImageRequestSchema`)。
   *
   * `isDesignImagePayload` 是同一件事的第二道,留给直接调 handler 的路径。
   */
  ipcMain.handle(DESIGN_SAVE_IMAGE_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignSaveImageRequestSchema, payload)) throw new Error("Invalid request payload");
    const { fileName, extension, data } = payload as {
      fileName: string;
      extension: "png" | "pdf";
      data: string;
    };
    if (!isDesignImagePayload(data)) throw new Error("Invalid image payload");
    return await deps.handlers.saveMockupImage({ bytes: decodeDesignImage(data), extension, fileName });
  });

  ipcMain.handle(DESIGN_COPY_IMAGE_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignCopyImageRequestSchema, payload)) throw new Error("Invalid request payload");
    const { data } = payload as { data: string };
    if (!isDesignImagePayload(data)) throw new Error("Invalid image payload");
    return await deps.handlers.copyMockupImage({ bytes: decodeDesignImage(data) });
  });

  ipcMain.handle(DESIGN_UPDATE_FRAME_META_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignUpdateFrameMetaRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.updateFrameMeta(
      payload as { path: string; frameId: string; meta: { title?: string; width?: number; height?: number } },
    );
  });

  ipcMain.handle(DESIGN_RASTERIZE_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignRasterRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.rasterizeFrames(
      payload as { path: string; frames: { frameId: string; bucket: number }[] },
    );
  });

  ipcMain.handle(DESIGN_STYLES_CHANNEL, async () => await deps.handlers.listStyles());

  ipcMain.handle(DESIGN_STYLE_DETAIL_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignStyleDetailRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.styleDetail(payload as { id: string });
  });

  ipcMain.handle(DESIGN_CREATE_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(CreateDesignRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.createDesign(payload as { root: string; name: string; styleId: string | null });
  });

  ipcMain.handle(DESIGN_LIVE_FRAME_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignLiveFrameRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.setLiveFrame(
      payload as {
        path: string;
        frameId: string | null;
        bounds: { x: number; y: number; width: number; height: number } | null;
      },
    );
  });
}
