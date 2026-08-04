import type { WorkbenchId } from "@wordless/domain";
import { BookOpenCheck, LayoutDashboard, PanelTop, Presentation } from "lucide-react";
import { CodingContextPanel } from "../artifacts/CodingContextPanel";
import { PresentationContextPanel } from "../artifacts/PresentationContextPanel";
import { SpreadsheetContextPanel } from "../artifacts/SpreadsheetContextPanel";
import { AnalysisContextPanel } from "../artifacts/AnalysisContextPanel";
import type { WorkbenchContextPanelDefinition, WorkbenchContextPanelProps } from "./context-panel-types";
import changesIcon from "../../../icons/workspaces/changes.svg";
import chartsIcon from "../../../icons/workspaces/charts.svg";
import dataIcon from "../../../icons/workspaces/data.svg";
import filesIcon from "../../../icons/workspaces/files.svg";
import issuesIcon from "../../../icons/workspaces/issues.svg";
import reportIcon from "../../../icons/workspaces/REPORT.svg";
import sheetsIcon from "../../../icons/workspaces/sheets.svg";

function workspaceIcon(source: string) {
  return function WorkspaceIcon({ className }: { className?: string }) {
    return <img alt="" className={`${className ?? ""} object-contain dark:invert`} draggable={false} src={source} />;
  };
}

const ChangesIcon = workspaceIcon(changesIcon);
const ChartsIcon = workspaceIcon(chartsIcon);
const DataIcon = workspaceIcon(dataIcon);
const FilesIcon = workspaceIcon(filesIcon);
const IssuesIcon = workspaceIcon(issuesIcon);
const ReportIcon = workspaceIcon(reportIcon);
const SheetsIcon = workspaceIcon(sheetsIcon);

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
      { id: "files", label: "Workspace files", icon: FilesIcon },
      { id: "changes", label: "Changes", icon: ChangesIcon },
    ],
  },
  {
    workbenchId: "presentation",
    component: PresentationContextPanel,
    tabs: [
      { id: "preview", label: "Preview", icon: PanelTop },
      { id: "slides", label: "Slides", icon: Presentation },
      { id: "assets", label: "Assets", icon: FilesIcon },
      { id: "issues", label: "Issues", icon: IssuesIcon },
    ],
  },
  {
    workbenchId: "workbook",
    component: SpreadsheetContextPanel,
    tabs: [
      { id: "preview", label: "Preview", icon: PanelTop },
      { id: "sheets", label: "Sheets", icon: SheetsIcon },
      { id: "changes", label: "Changes", icon: ChangesIcon },
      { id: "issues", label: "Issues", icon: IssuesIcon },
    ],
  },
  {
    workbenchId: "analysis",
    component: AnalysisContextPanel,
    tabs: [
      { id: "report", label: "Report", icon: ReportIcon },
      { id: "research", label: "Research / Sources", icon: BookOpenCheck },
      { id: "data", label: "Data", icon: DataIcon },
      { id: "charts", label: "Charts", icon: ChartsIcon },
      { id: "files", label: "Files", icon: FilesIcon },
    ],
  },
]);
