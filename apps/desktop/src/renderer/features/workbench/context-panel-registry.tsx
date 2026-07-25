import type { ComponentType } from "react";
import type { WorkbenchId } from "@wordless/domain";
import { CodingContextPanel, type ContextPanelView } from "../artifacts/CodingContextPanel";
import type { WorkspaceAttachment } from "../thread/Composer";

export type WorkbenchContextPanelProps = {
  onAttachFile: (attachment: WorkspaceAttachment) => void;
  onViewChange: (view: ContextPanelView) => void;
  sessionId: string;
  view: ContextPanelView;
};

type Registration = {
  component: ComponentType<WorkbenchContextPanelProps>;
  workbenchId: WorkbenchId;
};

function UnsupportedContextPanel(_props: WorkbenchContextPanelProps) {
  return <div className="p-4 text-[12px] text-muted-foreground">No session context is available for this workbench.</div>;
}

class WorkbenchContextPanelRegistry {
  private readonly panels = new Map<WorkbenchId, ComponentType<WorkbenchContextPanelProps>>();

  constructor(registrations: Registration[]) {
    for (const registration of registrations) this.panels.set(registration.workbenchId, registration.component);
  }

  resolve(workbenchId: WorkbenchId | undefined): ComponentType<WorkbenchContextPanelProps> {
    return workbenchId ? this.panels.get(workbenchId) ?? UnsupportedContextPanel : UnsupportedContextPanel;
  }
}

export const workbenchContextPanelRegistry = new WorkbenchContextPanelRegistry([{ workbenchId: "code", component: CodingContextPanel }]);
