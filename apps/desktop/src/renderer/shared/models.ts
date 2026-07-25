import type { LucideIcon } from "lucide-react";
import type { MessageKey } from "./i18n";

export type Locale = "zh-CN" | "en-US";
export type ThemeMode = "light" | "dark" | "system";
export type WorkbenchView = "welcome" | "thread";
export type ProfileKind = "general" | "coding" | "ppt" | "excel" | "data" | "ui";

export type NavigationItem = {
  id: string;
  labelKey: MessageKey;
  icon: LucideIcon;
};

export type ProfileOption = {
  id: ProfileKind;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: LucideIcon;
};

export type ThreadSummary = {
  id: string;
  title: string;
  updatedAtLabel: string;
};

export type ArtifactSummary = {
  id: string;
  name: string;
  kind: string;
  updatedAtLabel: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};
