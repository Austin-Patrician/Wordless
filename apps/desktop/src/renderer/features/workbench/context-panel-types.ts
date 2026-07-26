import type { ComponentType } from "react";
import type { WorkbenchId } from "@wordless/domain";
import type { ArtifactSelection } from "@wordless/protocol";
import type { WorkspaceAttachment } from "../thread/Composer";

export type ContextPanelView = "overview" | "files" | "changes" | "preview" | "slides" | "assets" | "issues";

export type ContextPanelTab = {
  id: ContextPanelView;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export type WorkbenchContextPanelProps = {
  onArtifactSelection?: (selection: ArtifactSelection) => void;
  onAttachFile: (attachment: WorkspaceAttachment) => void;
  onViewChange: (view: ContextPanelView) => void;
  sessionId: string;
  view: ContextPanelView;
};

export type WorkbenchContextPanelDefinition = {
  component: ComponentType<WorkbenchContextPanelProps>;
  tabs: ContextPanelTab[];
  workbenchId: WorkbenchId;
};
