import { contextBridge, ipcRenderer } from "electron";
import { OCR_BRIDGE_KEY, OCR_CHANNELS, type OcrProgressEvent, type OcrRunnerRequest, type OcrRunnerResult, type WordlessOcrBridge } from "../ocr-runner/ocr-bridge";

/**
 * OCR 运行器窗口的 preload。
 *
 * 只做一件事:把桥暴露成 `window.wordlessOcr`。窗口是 `sandbox: true` +
 * `contextIsolation: true` 的,页面脚本够不到 `ipcRenderer`,也够不到 Node —— 它能做的
 * 只有这个桥上的五个方法。
 */

const bridge: WordlessOcrBridge = {
  notifyReady: (sessionId) => ipcRenderer.send(OCR_CHANNELS.ready, sessionId),
  onStart: (handler) => {
    ipcRenderer.on(OCR_CHANNELS.start, (_event, request: OcrRunnerRequest) => handler(request));
  },
  reportProgress: (sessionId, event: OcrProgressEvent) => ipcRenderer.send(OCR_CHANNELS.progress, sessionId, event),
  reportDone: (sessionId, result: OcrRunnerResult) => ipcRenderer.send(OCR_CHANNELS.done, sessionId, result),
  reportError: (sessionId, code, message) => ipcRenderer.send(OCR_CHANNELS.error, sessionId, code, message),
};

contextBridge.exposeInMainWorld(OCR_BRIDGE_KEY, bridge);
