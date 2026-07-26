import type { WorkbenchId } from "@wordless/domain";
import { CircleAlert, File, LayoutDashboard, PanelTop, Presentation, Sparkles } from "lucide-react";
import { CodingContextPanel } from "../artifacts/CodingContextPanel";
import { PresentationContextPanel } from "../artifacts/PresentationContextPanel";
import type { WorkbenchContextPanelDefinition, WorkbenchContextPanelProps } from "./context-panel-types";

function UnsupportedContextPanel(_props: WorkbenchContextPanelProps) {
  return <div className="p-4 text-[12px] text-muted-foreground">No session context is available for this workbench.</div>;
}

class WorkbenchContextPanelRegistry {
  private readonly panels = new Map<WorkbenchId, WorkbenchContextPanelDefinition>();

  constructor(registrations: WorkbenchContextPanelDefinition[]) {
    for (const registration of registrations) this.panels.set(registration.workbenchId, registration);
  }

  resolve(workbenchId: WorkbenchId | undefined): WorkbenchContextPanelDefinition {
    const fallback: WorkbenchContextPanelDefinition = { workbenchId: "conversation", component: UnsupportedContextPanel, tabs: [{ id: "overview", label: "Context", icon: LayoutDashboard }] };
    return workbenchId ? this.panels.get(workbenchId) ?? fallback : fallback;
  }
}

export const workbenchContextPanelRegistry = new WorkbenchContextPanelRegistry([
  {
    workbenchId: "code",
    component: CodingContextPanel,
    tabs: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "files", label: "Workspace files", icon: File },
      { id: "changes", label: "Changes", icon: Sparkles },
    ],
  },
  {
    workbenchId: "presentation",
    component: PresentationContextPanel,
    tabs: [
      { id: "preview", label: "Preview", icon: PanelTop },
      { id: "slides", label: "Slides", icon: Presentation },
      { id: "assets", label: "Assets", icon: File },
      { id: "issues", label: "Issues", icon: CircleAlert },
    ],
  },
]);
