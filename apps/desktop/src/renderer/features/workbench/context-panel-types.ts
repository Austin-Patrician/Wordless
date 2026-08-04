import type { ComponentType } from "react";
import type { WorkbenchId } from "@wordless/domain";
import type { ArtifactSelection } from "@wordless/protocol";
import type { InlineWorkspaceReferenceToken } from "../thread/InlineSkillComposer";

export type ContextPanelView = "overview" | "files" | "changes" | "preview" | "slides" | "sheets" | "assets" | "issues" | "report" | "research" | "data" | "charts";

export type ContextPanelTab = {
  id: ContextPanelView;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export type WorkbenchContextPanelProps = {
  onArtifactSelection?: (selection: ArtifactSelection) => void;
  onAttachFile: (reference: InlineWorkspaceReferenceToken) => void;
  onViewChange: (view: ContextPanelView) => void;
  sessionId: string;
  view: ContextPanelView;
};

export type WorkbenchContextPanelDefinition = {
  component: ComponentType<WorkbenchContextPanelProps>;
  tabs: ContextPanelTab[];
  workbenchId: WorkbenchId;
};
