import { useEffect, useState } from "react";
import { backgroundAssetUrl, backgroundPreviewStyle } from "./backgrounds";
import { usePreferences } from "../../shared/preferences";

export function AppBackgroundLayer() {
  const { appearance } = usePreferences();
  const { background } = appearance;
  const customAssetId = background.source.kind === "custom" ? background.source.assetId : null;
  const [customReady, setCustomReady] = useState(false);

  useEffect(() => {
    if (!customAssetId) {
      setCustomReady(false);
      return;
    }
    setCustomReady(false);
    let active = true;
    const image = new Image();
    image.onload = () => { if (active) setCustomReady(true); };
    image.onerror = () => { if (active) setCustomReady(false); };
    image.src = backgroundAssetUrl(customAssetId);
    return () => { active = false; };
  }, [customAssetId]);

  if (background.source.kind === "none") return null;

  return (
    <div aria-hidden="true" className="app-background-layer fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {background.source.kind !== "custom" || customReady ? <div className="app-background-image absolute inset-0" style={{ ...backgroundPreviewStyle(background.source, background.fit, background.position), filter: background.blurPx > 0 ? `blur(${background.blurPx}px)` : undefined, opacity: background.intensity / 100, transform: background.blurPx > 0 ? "scale(1.025)" : undefined }} /> : null}
      <div className="app-background-scrim absolute inset-0" />
    </div>
  );
}
