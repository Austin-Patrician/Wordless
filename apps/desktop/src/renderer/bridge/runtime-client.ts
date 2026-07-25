import { desktopBridgeError, isDesktopBridge, type DesktopBridge } from "../../bridge/desktop-bridge";

export type RuntimeClient = DesktopBridge;

declare global {
  interface Window {
    wordless?: DesktopBridge;
  }
}

export function getRuntimeClient(): RuntimeClient {
  if (isDesktopBridge(window.wordless)) return window.wordless;
  throw new Error(desktopBridgeError(window.wordless) ?? "Electron preload bridge is unavailable.");
}
