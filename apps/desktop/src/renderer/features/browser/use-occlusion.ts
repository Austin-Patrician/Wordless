import { useEffect } from "react";
import { browserOcclusion, type OcclusionReason } from "./occlusion";

/**
 * Declares that `active` UI overlaps the browser panel, so the native page steps
 * aside while it is open.
 *
 * One line at the call site, and deliberately keyed on a boolean the component
 * already tracks — overlays that are hand-rolled rather than portalled have no
 * other way to be noticed. See `occlusion.ts` for why detection alone is not
 * enough.
 */
export function useBrowserOcclusion(active: boolean, reason: OcclusionReason): void {
  useEffect(() => {
    if (!active) return;
    return browserOcclusion.acquire(reason);
  }, [active, reason]);
}
