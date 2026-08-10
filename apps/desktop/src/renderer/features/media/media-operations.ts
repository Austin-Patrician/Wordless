import type { ConfiguredModelSummary, MediaOperationKind } from "@wordless/domain";
import { Crop, Eraser, Images, Layers, RefreshCw, Rotate3D, Scan, Sparkles, WandSparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type MediaOperationDefinition = {
  id: Exclude<MediaOperationKind, "upload">;
  icon: LucideIcon;
  requiresReference: boolean;
  capability: "mask" | "transparent" | null;
  label: { "zh-CN": string; "en-US": string };
  defaultPrompt: { "zh-CN": string; "en-US": string };
};

export const mediaOperationDefinitions: MediaOperationDefinition[] = [
  { id: "generate", icon: Sparkles, requiresReference: false, capability: null, label: { "zh-CN": "生成图片", "en-US": "Generate image" }, defaultPrompt: { "zh-CN": "", "en-US": "" } },
  { id: "regenerate", icon: RefreshCw, requiresReference: true, capability: null, label: { "zh-CN": "重新生成", "en-US": "Regenerate" }, defaultPrompt: { "zh-CN": "保持主体和构图，重新生成这张图片。", "en-US": "Regenerate this image while preserving the subject and composition." } },
  { id: "variation", icon: Images, requiresReference: true, capability: null, label: { "zh-CN": "生成变体", "en-US": "Create variation" }, defaultPrompt: { "zh-CN": "生成具有相同主体和视觉语言的新变体。", "en-US": "Create a new variation with the same subject and visual language." } },
  { id: "crop", icon: Crop, requiresReference: true, capability: null, label: { "zh-CN": "裁剪", "en-US": "Crop" }, defaultPrompt: { "zh-CN": "", "en-US": "" } },
  { id: "local-edit", icon: Scan, requiresReference: true, capability: "mask", label: { "zh-CN": "局部编辑", "en-US": "Local edit" }, defaultPrompt: { "zh-CN": "描述选中区域需要如何修改。", "en-US": "Describe how the selected area should change." } },
  { id: "remove-background", icon: Layers, requiresReference: true, capability: "transparent", label: { "zh-CN": "去除背景", "en-US": "Remove background" }, defaultPrompt: { "zh-CN": "准确保留主体边缘和细节。", "en-US": "Preserve the subject edges and fine details accurately." } },
  { id: "remove-object", icon: Eraser, requiresReference: true, capability: "mask", label: { "zh-CN": "移除物体", "en-US": "Remove object" }, defaultPrompt: { "zh-CN": "移除选中物体并自然重建周围区域。", "en-US": "Remove the selected object and reconstruct the surrounding area naturally." } },
  { id: "multi-view", icon: Rotate3D, requiresReference: true, capability: null, label: { "zh-CN": "多视角", "en-US": "Multi-view" }, defaultPrompt: { "zh-CN": "保持主体身份、材质和比例一致。", "en-US": "Keep the subject identity, materials, and proportions consistent." } },
];

export function mediaOperationDefinition(kind: Exclude<MediaOperationKind, "upload">): MediaOperationDefinition {
  return mediaOperationDefinitions.find((definition) => definition.id === kind) ?? { id: kind, icon: WandSparkles, requiresReference: false, capability: null, label: { "zh-CN": kind, "en-US": kind }, defaultPrompt: { "zh-CN": "", "en-US": "" } };
}

export function mediaOperationUnavailableReason(definition: MediaOperationDefinition, model: ConfiguredModelSummary | undefined, locale: "zh-CN" | "en-US"): string | null {
  if (!model) return locale === "zh-CN" ? "请先配置图片模型" : "Configure an image model first";
  if (definition.requiresReference && !(model.imageCapabilities?.supportsReferenceImageEditing ?? model.supportsVision)) return locale === "zh-CN" ? "此模型不支持参考图片" : "This model does not support reference images";
  if (definition.capability === "mask" && !model.imageCapabilities?.supportsMaskEditing) return locale === "zh-CN" ? "此模型不支持蒙版编辑" : "This model does not support mask editing";
  if (definition.capability === "transparent" && !model.imageCapabilities?.supportsTransparentBackground) return locale === "zh-CN" ? "此模型不支持透明背景" : "This model does not support transparent backgrounds";
  return null;
}
