import type { ConnectorSummary } from "@wordless/domain";
import { Cloud, Terminal } from "lucide-react";
import dingtalkIcon from "../../icons/mcp/钉钉.svg";
import feishuIcon from "../../icons/mcp/飞书.svg";
import postgresqlIcon from "../../icons/mcp/PostgreSQL.svg";
import webSearchIcon from "../../icons/mcp/websearch.svg";
import wecomIcon from "../../icons/mcp/企业微信.svg";
import firecrawlIcon from "../../icons/mcp/firecrawl-color.svg";
import githubIcon from "../../icons/mcp/github-fill.svg";
import aiHotIcon from "../../icons/mcp/AIHot.svg";

const templateIcons: Partial<Record<NonNullable<ConnectorSummary["templateId"]>, string>> = {
  feishu: feishuIcon,
  dingtalk: dingtalkIcon,
  wecom: wecomIcon,
  postgresql: postgresqlIcon,
  "web-search": webSearchIcon,
  firecrawl: firecrawlIcon,
  github: githubIcon,
  "ai-hot": aiHotIcon,
};

type ConnectorIconProps = Pick<ConnectorSummary, "templateId" | "transport"> & {
  className?: string;
};

export function ConnectorIcon({ className = "h-5 w-5", templateId, transport }: ConnectorIconProps) {
  const icon = templateId === null ? undefined : templateIcons[templateId];
  if (icon) return <img alt="" className={`${className} object-contain`} src={icon} />;
  return transport === "stdio" ? <Terminal aria-hidden className={className} /> : <Cloud aria-hidden className={className} />;
}
