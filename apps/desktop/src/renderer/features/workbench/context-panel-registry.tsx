import type { WorkbenchId } from "@wordless/domain";
import { BookOpenCheck, Frame, LayoutDashboard, PackageOpen, PanelTop, Presentation } from "lucide-react";
import { CodingContextPanel } from "../artifacts/CodingContextPanel";
import { PresentationContextPanel } from "../artifacts/PresentationContextPanel";
import { SpreadsheetContextPanel } from "../artifacts/SpreadsheetContextPanel";
import { AnalysisContextPanel } from "../artifacts/AnalysisContextPanel";
import { GeneralWorkArtifactsPanel } from "../artifacts/GeneralWorkArtifactsPanel";
import type { WorkbenchContextPanelDefinition, WorkbenchContextPanelProps } from "./context-panel-types";
import changesIcon from "../../../icons/workspaces/changes.svg";
import chartsIcon from "../../../icons/workspaces/charts.svg";
import dataIcon from "../../../icons/workspaces/data.svg";
import filesIcon from "../../../icons/workspaces/files.svg";
import reportIcon from "../../../icons/workspaces/REPORT.svg";

function workspaceIcon(source: string) {
  return function WorkspaceIcon({ className }: { className?: string }) {
    return <img alt="" className={`${className ?? ""} object-contain dark:invert`} draggable={false} src={source} />;
  };
}

const ChangesIcon = workspaceIcon(changesIcon);
const ChartsIcon = workspaceIcon(chartsIcon);
const DataIcon = workspaceIcon(dataIcon);
const FilesIcon = workspaceIcon(filesIcon);
const ReportIcon = workspaceIcon(reportIcon);

function UnsupportedContextPanel(_props: WorkbenchContextPanelProps) {
  return <div className="p-4 text-[12px] text-muted-foreground">No session context is available for this workbench.</div>;
}

class WorkbenchContextPanelRegistry {
  private readonly panels = new Map<WorkbenchId, WorkbenchContextPanelDefinition>();

  constructor(registrations: WorkbenchContextPanelDefinition[]) {
    for (const registration of registrations) this.panels.set(registration.workbenchId, registration);
  }

  resolve(workbenchId: WorkbenchId | undefined): WorkbenchContextPanelDefinition {
    const fallback: WorkbenchContextPanelDefinition = { workbenchId: "conversation", component: UnsupportedContextPanel, tabs: [{ id: "overview", labelKey: "context", icon: LayoutDashboard }] };
    return workbenchId ? this.panels.get(workbenchId) ?? fallback : fallback;
  }
}

export const workbenchContextPanelRegistry = new WorkbenchContextPanelRegistry([
  {
    /**
     * UI 设计会话。
     *
     * **画布是这块面板唯一的页签,而且是它自己注册的**,不是由 `WorkbenchShell` 事后追加的。
     * 这样"默认打开哪一个"也一并解决了 —— 切换到铺满型工作台时默认落在它自己的第一个页签上。
     *
     * 它要的是宽度:设计是无限画布,并排放两三个页签意味着画布只能用一半,而用户来看的就是
     * 画布。参考实现的画布也是以最大宽度打开的。
     */
    workbenchId: "ui-preview",
    component: UnsupportedContextPanel,
    tabs: [{ id: "design", labelKey: "designPanelTitle", icon: Frame }],
  },
  {
    workbenchId: "conversation",
    component: GeneralWorkArtifactsPanel,
    tabs: [{ id: "artifacts", labelKey: "artifacts", icon: PackageOpen }],
  },
  {
    workbenchId: "code",
    component: CodingContextPanel,
    tabs: [
      { id: "overview", labelKey: "contextOverview", icon: LayoutDashboard },
      { id: "files", labelKey: "workspaceFiles", icon: FilesIcon },
      { id: "changes", labelKey: "changes", icon: ChangesIcon },
    ],
  },
  {
    workbenchId: "presentation",
    component: PresentationContextPanel,
    tabs: [
      { id: "preview", labelKey: "contextPreview", icon: PanelTop },
      { id: "slides", labelKey: "contextSlides", icon: Presentation },
    ],
  },
  {
    workbenchId: "workbook",
    component: SpreadsheetContextPanel,
    tabs: [
      { id: "preview", labelKey: "contextPreview", icon: PanelTop },
    ],
  },
  {
    workbenchId: "analysis",
    component: AnalysisContextPanel,
    tabs: [
      { id: "report", labelKey: "contextReport", icon: ReportIcon },
      { id: "research", labelKey: "contextResearch", icon: BookOpenCheck },
      { id: "data", labelKey: "contextData", icon: DataIcon },
      { id: "charts", labelKey: "contextCharts", icon: ChartsIcon },
      { id: "files", labelKey: "contextFiles", icon: FilesIcon },
    ],
  },
]);
