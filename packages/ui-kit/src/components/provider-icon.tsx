/**
 * 供应商图标 —— **桌面端与网页端共用同一份**(`@wordless/ui-kit`)。
 *
 * 以前它只长在桌面端(`renderer/features/settings/provider-icons.tsx`)。网页端要显示"这个模型是哪家"的
 * 时候,复制一份会立刻带来第二个真相:新加一个供应商要改两处,漏一处就是"手机上有问号、电脑上有图标"。
 * 所以整份搬到 ui-kit,桌面端那侧只留一行 re-export。
 *
 * 图标的选取有两条路:`avatarId`(用户在设置里自己挑的,优先)与 `providerId`(按供应商默认)。
 * 两条都认不出来时给一个问号 —— **不猜**:猜错比没有更糟。
 */
import { CircleHelp } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import type { ProviderAvatarId } from "@wordless/domain";
import amazonBedrockIcon from "../assets/provider-icons/amazon-bedrock.png?no-inline";
import antLingIcon from "../assets/provider-icons/ant-ling.svg?no-inline";
import anthropicIcon from "../assets/provider-icons/anthropic.svg?no-inline";
import azureIcon from "../assets/provider-icons/azure-color.svg?no-inline";
import baaiIcon from "../assets/provider-icons/baai.svg?no-inline";
import bailianIcon from "../assets/provider-icons/bailian-color.svg?no-inline";
import bytedanceIcon from "../assets/provider-icons/bytedance-color.svg?no-inline";
import cerebrasIcon from "../assets/provider-icons/cerebras-color.svg?no-inline";
import cloudflareIcon from "../assets/provider-icons/cloudflare-color.svg?no-inline";
import copilotIcon from "../assets/provider-icons/copilot-color.svg?no-inline";
import deepseekIcon from "../assets/provider-icons/deepseek-color.svg?no-inline";
import fireworksIcon from "../assets/provider-icons/fireworks-color.svg?no-inline";
import geminiIcon from "../assets/provider-icons/gemini-color.svg?no-inline";
import groqIcon from "../assets/provider-icons/groq.svg?no-inline";
import huggingfaceIcon from "../assets/provider-icons/huggingface-color.svg?no-inline";
import hunyuanIcon from "../assets/provider-icons/hunyuan-color.svg?no-inline";
import jimengIcon from "../assets/provider-icons/jimeng-color.svg?no-inline";
import kimiIcon from "../assets/provider-icons/kimi-color.svg?no-inline";
import klingIcon from "../assets/provider-icons/kling-color.svg?no-inline";
import longcatIcon from "../assets/provider-icons/longcat-color.svg?no-inline";
import minimaxIcon from "../assets/provider-icons/minimax-color.svg?no-inline";
import mistralIcon from "../assets/provider-icons/mistral-color.svg?no-inline";
import moonshotIcon from "../assets/provider-icons/moonshot.svg?no-inline";
import nvidiaIcon from "../assets/provider-icons/nvidia-color.svg?no-inline";
import ollamaIcon from "../assets/provider-icons/ollama.svg?no-inline";
import openaiIcon from "../assets/provider-icons/openai.svg?no-inline";
import opencodeIcon from "../assets/provider-icons/opencode.svg?no-inline";
import openrouterIcon from "../assets/provider-icons/openrouter.svg?no-inline";
import qwenIcon from "../assets/provider-icons/qwen-color.svg?no-inline";
import stepfunIcon from "../assets/provider-icons/stepfun.svg?no-inline";
import togetherIcon from "../assets/provider-icons/together-color.svg?no-inline";
import vercelIcon from "../assets/provider-icons/vercel.svg?no-inline";
import volcengineIcon from "../assets/provider-icons/volcengine-color.svg?no-inline";
import workersAiIcon from "../assets/provider-icons/workersai-color.svg?no-inline";
import xiaomiIcon from "../assets/provider-icons/xiaomimimo.svg?no-inline";
import xaiIcon from "../assets/provider-icons/grok.svg?no-inline";
import zaiIcon from "../assets/provider-icons/zai.svg?no-inline";
import zhipuIcon from "../assets/provider-icons/zhipu-color.svg?no-inline";

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

const KNOWN_AVATAR_IDS = new Set<string>(Object.keys(AVATAR_ICONS));

/**
 * `avatarId` 来自**远端**(网页端是协议载荷),所以按值域收一道。
 *
 * 收一道而不是强转:对方可能比我们新(多了一个头像),强转就会拿一个不存在的 id 去查表,
 * 结果是"手机上一个问号、电脑上正常的图标",而且没人知道为什么。
 */
function isKnownAvatarId(value: string | null | undefined): value is ProviderAvatarId {
  return typeof value === "string" && KNOWN_AVATAR_IDS.has(value);
}

type ProviderIconProps = Omit<ComponentPropsWithoutRef<"img">, "alt" | "src"> & {
  /** 用户可以自己挑的图标。允许传字符串:见 `isKnownAvatarId` 的注释。 */
  avatarId?: string | null;
  providerId?: string;
};

export function ProviderIcon({ avatarId, className, providerId, ...props }: ProviderIconProps) {
  const resolvedAvatarId = isKnownAvatarId(avatarId)
    ? avatarId
    : providerId
      ? PROVIDER_AVATAR_BY_ID[providerId]
      : undefined;
  const icon = resolvedAvatarId ? AVATAR_ICONS[resolvedAvatarId] : undefined;
  if (icon) return <img alt="" className={className} draggable={false} src={icon} {...props} />;
  return <span aria-hidden="true" className={`grid place-items-center text-muted-foreground ${className ?? ""}`}><CircleHelp className="h-full w-full" strokeWidth={1.6} /></span>;
}
