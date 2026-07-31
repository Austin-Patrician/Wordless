import { TooltipProvider } from "@wordless/ui-kit";
import { WorkbenchShell } from "../features/workbench/WorkbenchShell";
import { PreferencesProvider } from "../shared/preferences";
import { RuntimeProvider } from "../shared/runtime";
import { DesktopHostProvider } from "../platform/desktop-host";
import { DesktopUpdateProvider } from "../platform/desktop-update";

export function App() {
  return (
    <RuntimeProvider>
      <DesktopHostProvider>
        <DesktopUpdateProvider>
          <PreferencesProvider>
            <TooltipProvider delayDuration={250}>
              <WorkbenchShell />
            </TooltipProvider>
          </PreferencesProvider>
        </DesktopUpdateProvider>
      </DesktopHostProvider>
    </RuntimeProvider>
  );
}
