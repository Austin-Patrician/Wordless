import { CircleHelp } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import type { ProviderAvatarId } from "@wordless/domain";
import amazonBedrockIcon from "../../../icons/provider-icons/amazon-bedrock.png";
import antLingIcon from "../../../icons/provider-icons/ant-ling.svg";
import anthropicIcon from "../../../icons/provider-icons/anthropic.svg";
import azureIcon from "../../../icons/provider-icons/azure-color.svg";
import baaiIcon from "../../../icons/provider-icons/baai.svg";
import bailianIcon from "../../../icons/provider-icons/bailian-color.svg";
import bytedanceIcon from "../../../icons/provider-icons/bytedance-color.svg";
import cerebrasIcon from "../../../icons/provider-icons/cerebras-color.svg";
import cloudflareIcon from "../../../icons/provider-icons/cloudflare-color.svg";
import copilotIcon from "../../../icons/provider-icons/copilot-color.svg";
import deepseekIcon from "../../../icons/provider-icons/deepseek-color.svg";
import fireworksIcon from "../../../icons/provider-icons/fireworks-color.svg";
import geminiIcon from "../../../icons/provider-icons/gemini-color.svg";
import groqIcon from "../../../icons/provider-icons/groq.svg";
import huggingfaceIcon from "../../../icons/provider-icons/huggingface-color.svg";
import hunyuanIcon from "../../../icons/provider-icons/hunyuan-color.svg";
import jimengIcon from "../../../icons/provider-icons/jimeng-color.svg";
import kimiIcon from "../../../icons/provider-icons/kimi-color.svg";
import klingIcon from "../../../icons/provider-icons/kling-color.svg";
import longcatIcon from "../../../icons/provider-icons/longcat-color.svg";
import minimaxIcon from "../../../icons/provider-icons/minimax-color.svg";
import mistralIcon from "../../../icons/provider-icons/mistral-color.svg";
import moonshotIcon from "../../../icons/provider-icons/moonshot.svg";
import nvidiaIcon from "../../../icons/provider-icons/nvidia-color.svg";
import ollamaIcon from "../../../icons/provider-icons/ollama.svg";
import openaiIcon from "../../../icons/provider-icons/openai.svg";
import opencodeIcon from "../../../icons/provider-icons/opencode.svg";
import openrouterIcon from "../../../icons/provider-icons/openrouter.svg";
import qwenIcon from "../../../icons/provider-icons/qwen-color.svg";
import stepfunIcon from "../../../icons/provider-icons/stepfun.svg";
import togetherIcon from "../../../icons/provider-icons/together-color.svg";
import vercelIcon from "../../../icons/provider-icons/vercel.svg";
import volcengineIcon from "../../../icons/provider-icons/volcengine-color.svg";
import workersAiIcon from "../../../icons/provider-icons/workersai-color.svg";
import xiaomiIcon from "../../../icons/provider-icons/xiaomimimo.svg";
import xaiIcon from "../../../icons/provider-icons/grok.svg";
import zaiIcon from "../../../icons/provider-icons/zai.svg";
import zhipuIcon from "../../../icons/provider-icons/zhipu-color.svg";

const AVATAR_ICONS: Record<ProviderAvatarId, string> = {
  "amazon-bedrock": amazonBedrockIcon,
  "ant-ling": antLingIcon,
  anthropic: anthropicIcon,
  azure: azureIcon,
  baai: baaiIcon,
  bailian: bailianIcon,
  bytedance: bytedanceIcon,
  cerebras: cerebrasIcon,
  cloudflare: cloudflareIcon,
  copilot: copilotIcon,
  deepseek: deepseekIcon,
  fireworks: fireworksIcon,
  gemini: geminiIcon,
  groq: groqIcon,
  huggingface: huggingfaceIcon,
  hunyuan: hunyuanIcon,
  jimeng: jimengIcon,
  kimi: kimiIcon,
  kling: klingIcon,
  longcat: longcatIcon,
  minimax: minimaxIcon,
  mistral: mistralIcon,
  moonshot: moonshotIcon,
  nvidia: nvidiaIcon,
  ollama: ollamaIcon,
  openai: openaiIcon,
  opencode: opencodeIcon,
  openrouter: openrouterIcon,
  qwen: qwenIcon,
  stepfun: stepfunIcon,
  together: togetherIcon,
  vercel: vercelIcon,
  volcengine: volcengineIcon,
  workersai: workersAiIcon,
  xiaomi: xiaomiIcon,
  xai: xaiIcon,
  zai: zaiIcon,
  zhipu: zhipuIcon,
};

const PROVIDER_AVATAR_BY_ID: Record<string, ProviderAvatarId> = {
  "amazon-bedrock": "amazon-bedrock",
  "ant-ling": "ant-ling",
  anthropic: "anthropic",
  "azure-openai-responses": "azure",
  baai: "baai",
  bailian: "bailian",
  bytedance: "bytedance",
  byteplus: "bytedance",
  cerebras: "cerebras",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "workersai",
  deepseek: "deepseek",
  fireworks: "fireworks",
  "github-copilot": "copilot",
  google: "gemini",
  "google-vertex": "gemini",
  groq: "groq",
  huggingface: "huggingface",
  hunyuan: "hunyuan",
  jimeng: "jimeng",
  kimi: "moonshot",
  "kimi-coding": "moonshot",
  kling: "kling",
  longcat: "longcat",
  minimax: "minimax",
  "minimax-cn": "minimax",
  mistral: "mistral",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  nvidia: "nvidia",
  ollama: "ollama",
  openai: "openai",
  "openai-codex": "openai",
  opencode: "opencode",
  "opencode-go": "opencode",
  openrouter: "openrouter",
  "openrouter-images": "openrouter",
  qwen: "qwen",
  stepfun: "stepfun",
  together: "together",
  "vercel-ai-gateway": "vercel",
  volcengine: "volcengine",
  xai: "xai",
  xiaomi: "xiaomi",
  "xiaomi-token-plan-ams": "xiaomi",
  "xiaomi-token-plan-cn": "xiaomi",
  "xiaomi-token-plan-sgp": "xiaomi",
  zai: "zai",
  "zai-coding-cn": "zai",
  zhipu: "zhipu",
};

type ProviderIconProps = Omit<ComponentPropsWithoutRef<"img">, "alt" | "src"> & {
  avatarId?: ProviderAvatarId | null;
  providerId?: string;
};

export function ProviderIcon({ avatarId, className, providerId, ...props }: ProviderIconProps) {
  const resolvedAvatarId = avatarId ?? (providerId ? PROVIDER_AVATAR_BY_ID[providerId] : undefined);
  const icon = resolvedAvatarId ? AVATAR_ICONS[resolvedAvatarId] : undefined;
  if (icon) return <img alt="" className={className} draggable={false} src={icon} {...props} />;
  return <span aria-hidden="true" className={`grid place-items-center text-muted-foreground ${className ?? ""}`}><CircleHelp className="h-full w-full" strokeWidth={1.6} /></span>;
}
