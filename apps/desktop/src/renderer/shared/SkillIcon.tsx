import { skillIconText } from "./skill-icon";

type SkillIconProps = {
  name: string;
  className?: string;
  textClassName?: string;
};

export function SkillIcon({
  name,
  className = "h-5 w-5 rounded-[5px] bg-[#edf1e8] text-[#536349] dark:bg-[#35402d] dark:text-[#d7e4cb]",
  textClassName = "text-[10px] font-semibold leading-none",
}: SkillIconProps) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center ${className}`}>
      <span className={textClassName}>{skillIconText(name)}</span>
    </span>
  );
}
