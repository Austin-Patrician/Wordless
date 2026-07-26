import { TooltipProvider } from "@wordless/ui-kit";
import { WorkbenchShell } from "../features/workbench/WorkbenchShell";
import { PreferencesProvider } from "../shared/preferences";
import { RuntimeProvider } from "../shared/runtime";
import { DesktopHostProvider } from "../platform/desktop-host";

export function App() {
  return (
    <RuntimeProvider>
      <DesktopHostProvider>
        <PreferencesProvider>
          <TooltipProvider delayDuration={250}>
            <WorkbenchShell />
          </TooltipProvider>
        </PreferencesProvider>
      </DesktopHostProvider>
    </RuntimeProvider>
  );
}
