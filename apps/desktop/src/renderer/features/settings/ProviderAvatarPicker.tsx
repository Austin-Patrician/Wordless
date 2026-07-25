import type { ProviderAvatarId } from "@wordless/domain";
import { PROVIDER_AVATARS } from "@wordless/domain";
import { Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { ProviderIcon } from "./provider-icons";

type ProviderAvatarPickerProps = {
  disabled?: boolean;
  onChange: (avatarId: ProviderAvatarId) => void;
  value: ProviderAvatarId | null;
};

export function ProviderAvatarPicker({ disabled = false, onChange, value }: ProviderAvatarPickerProps) {
  return (
    <div aria-label="Provider avatar" className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5" role="radiogroup">
      {PROVIDER_AVATARS.map((avatar) => {
        const selected = value === avatar.id;
        return (
          <Tooltip key={avatar.id}>
            <TooltipTrigger asChild>
              <button
                aria-checked={selected}
                aria-label={avatar.label}
                className={`relative grid h-9 w-9 place-items-center rounded-[7px] border transition-colors ${selected ? "border-[#7b963e] bg-[#f1f7db] shadow-[0_0_0_1px_rgba(123,150,62,0.14)] dark:border-[#bbdf58] dark:bg-[#2d381d]" : "border-[#e0e0db] bg-white hover:border-[#babbb3] hover:bg-[#f8f8f5] dark:border-border dark:bg-card dark:hover:bg-muted"}`}
                disabled={disabled}
                onClick={() => onChange(avatar.id)}
                role="radio"
                type="button"
              >
                <ProviderIcon avatarId={avatar.id} className="h-5 w-5 object-contain" />
                {selected ? <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#617d28] text-white dark:bg-[#c4eb58] dark:text-[#26300f]"><Check className="h-2.5 w-2.5 stroke-[3]" /></span> : null}
              </button>
            </TooltipTrigger>
            <TooltipContent>{avatar.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
