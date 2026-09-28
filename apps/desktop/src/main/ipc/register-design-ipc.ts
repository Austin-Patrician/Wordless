import { ipcMain } from "electron";
import { Value } from "typebox/value";
import {
  DesignListRequestSchema,
  DesignMoveFramesRequestSchema,
  DesignOpenRequestSchema,
  CreateDesignRequestSchema,
  DesignLiveFrameRequestSchema,
  DesignRasterRequestSchema,
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
export const DESIGN_MOVE_FRAMES_CHANNEL = "wordless:design:move-frames";
export const DESIGN_RASTERIZE_CHANNEL = "wordless:design:rasterize";
export const DESIGN_LIVE_FRAME_CHANNEL = "wordless:design:live-frame";
export const DESIGN_STYLES_CHANNEL = "wordless:design:styles";
export const DESIGN_CREATE_CHANNEL = "wordless:design:create";

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

  ipcMain.handle(DESIGN_MOVE_FRAMES_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignMoveFramesRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.moveFrames(payload as { path: string; moves: { frameId: string; x: number; y: number }[] });
  });

  ipcMain.handle(DESIGN_RASTERIZE_CHANNEL, async (_event, payload: unknown) => {
    if (!Value.Check(DesignRasterRequestSchema, payload)) throw new Error("Invalid request payload");
    return await deps.handlers.rasterizeFrames(
      payload as { path: string; frames: { frameId: string; bucket: number }[] },
    );
  });

  ipcMain.handle(DESIGN_STYLES_CHANNEL, async () => await deps.handlers.listStyles());

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
