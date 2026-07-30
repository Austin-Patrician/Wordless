import { cn } from "@wordless/ui-kit";
import codeDevelopmentIcon from "../../../icons/common-icons/代码开发.svg";
import spreadsheetIcon from "../../../icons/common-icons/电子表格.svg";
import everydayOfficeIcon from "../../../icons/common-icons/日常办公.svg";
import dataAnalysisIcon from "../../../icons/common-icons/数据分析.svg";
import websiteIcon from "../../../icons/common-icons/网站.svg";
import innovationIcon from "../../../icons/common-icons/innovation.svg";
import presentationIcon from "../../../icons/common-icons/presentation.svg";

const icons: Record<string, string> = {
  sparkles: everydayOfficeIcon,
  presentation: presentationIcon,
  table: spreadsheetIcon,
  chart: dataAnalysisIcon,
  code: codeDevelopmentIcon,
  palette: websiteIcon,
  image: innovationIcon,
};

export function AgentEntryIcon({ className, iconKey }: { className?: string; iconKey?: string }) {
  return <img alt="" className={cn("h-3.5 w-3.5 shrink-0 object-contain", className)} draggable={false} src={icons[iconKey ?? "sparkles"] ?? everydayOfficeIcon} />;
}
