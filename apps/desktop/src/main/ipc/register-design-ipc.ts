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
  DesignSaveImageRequestSchema,
  isDesignImageBytes,
  DesignLiveFrameRequestSchema,
  DesignRasterRequestSchema,
  DesignStyleDetailRequestSchema,
  InstallDesignStyleResourcesRequestSchema,
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
export const DESIGN_STYLE_RESOURCES_CHANNEL = "wordless:design:style-resources";
export const DESIGN_CREATE_CHANNEL = "wordless:design:create";
export const DESIGN_SAVE_IMAGE_CHANNEL = "wordless:design:save-image";
export const DESIGN_COPY_IMAGE_CHANNEL = "wordless:design:copy-image";

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
   * **字节作为独立的实参,不进 schema。** schema 只声明它真的会校验的标量;几 MB 的
   * `Uint8Array` 由 `isDesignImageBytes` 以 O(1) 校验(`instanceof` + 上限)。把它塞进
   * `Type.Object` 只有两种结局:要么让 schema 声称校验了一个它不会去 walk 的字段,要么真的
   * 逐字节走一遍 —— 后者是白花成本。
   */
  ipcMain.handle(DESIGN_SAVE_IMAGE_CHANNEL, async (_event, metadata: unknown, bytes: unknown) => {
    if (!Value.Check(DesignSaveImageRequestSchema, metadata)) throw new Error("Invalid request payload");
    if (!isDesignImageBytes(bytes)) throw new Error("Invalid image payload");
    return await deps.handlers.saveMockupImage({
      ...(metadata as { fileName: string; extension: "png" | "pdf" }),
      bytes,
    });
  });

  ipcMain.handle(DESIGN_COPY_IMAGE_CHANNEL, async (_event, bytes: unknown) => {
    if (!isDesignImageBytes(bytes)) throw new Error("Invalid image payload");
    return await deps.handlers.copyMockupImage({ bytes });
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

  ipcMain.handle(DESIGN_STYLE_RESOURCES_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(InstallDesignStyleResourcesRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.installStyleResources(payload as { root: string; styleId: string });
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
