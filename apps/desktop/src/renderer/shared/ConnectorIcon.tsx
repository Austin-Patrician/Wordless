import type { ConnectorSummary } from "@wordless/domain";
import { mcpMarketplaceIconAssets } from "./mcp-brand-icons";

type ConnectorIconProps = Pick<ConnectorSummary, "templateId" | "transport"> & {
  className?: string;
};

export function ConnectorIcon({ className = "h-5 w-5", templateId, transport }: ConnectorIconProps) {
  const icon =
    templateId === null
      ? transport === "stdio"
        ? mcpMarketplaceIconAssets["tool-management"]
        : mcpMarketplaceIconAssets["system-global-configuration"]
      : mcpMarketplaceIconAssets[templateId];
  return <img alt="" className={`${className} object-contain`} src={icon} />;
}
