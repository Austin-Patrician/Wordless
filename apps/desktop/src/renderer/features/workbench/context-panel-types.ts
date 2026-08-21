import type { ComponentType } from "react";
import type { WorkbenchId } from "@wordless/domain";
import type { ResearchDelegationDetails } from "@wordless/domain";
import type { ArtifactSelection } from "@wordless/protocol";
import type { InlineWorkspaceReferenceToken } from "../thread/InlineSkillComposer";

export type ContextPanelView = "overview" | "files" | "changes" | "preview" | "slides" | "sheets" | "assets" | "artifacts" | "issues" | "report" | "research" | "data" | "charts";

export type ContextPanelTab = {
  id: ContextPanelView;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export type ResearchTaskSelection = {
  analysisId: string;
  callId: string;
  taskId: string;
  dimensionId: string;
  details?: ResearchDelegationDetails;
};

export type FileChangeSelection = {
  path: string | null;
  name: string;
};

export type WorkbenchContextPanelProps = {
  fileChangeSelection?: FileChangeSelection | null;
  onArtifactSelection?: (selection: ArtifactSelection) => void;
  onAttachFile: (reference: InlineWorkspaceReferenceToken) => void;
  onFileChangeSelectionConsumed?: () => void;
  onViewChange: (view: ContextPanelView) => void;
  onClearResearchSelection?: () => void;
  researchSelection?: ResearchTaskSelection | null;
  sessionId: string;
  view: ContextPanelView;
};

export type WorkbenchContextPanelDefinition = {
  component: ComponentType<WorkbenchContextPanelProps>;
  tabs: ContextPanelTab[];
  workbenchId: WorkbenchId;
};
