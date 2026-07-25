import { TooltipProvider } from "@wordless/ui-kit";
import { WorkbenchShell } from "../features/workbench/WorkbenchShell";
import { PreferencesProvider } from "../shared/preferences";
import { RuntimeProvider } from "../shared/runtime";

export function App() {
  return (
    <RuntimeProvider>
      <PreferencesProvider>
        <TooltipProvider delayDuration={250}>
          <WorkbenchShell />
        </TooltipProvider>
      </PreferencesProvider>
    </RuntimeProvider>
  );
}
