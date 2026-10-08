import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { LanguageSkillIcon } from "@hugeicons/core-free-icons";
import { LANGUAGES, useI18n, useT, type LanguageCode } from "@/shared/i18n";
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/platform";
import { Icon } from "@/shared/ui/page";

/**
 * The language switch, inside the account menu next to the theme switch.
 *
 * Its options expand within the account menu so they stay reachable on narrow screens.
 */
export function LanguageMenu() {
  const t = useT("shell");
  const { language, setLanguage } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const optionsId = useId();

  return (
    <>
      <DropdownMenuItem
        aria-controls={optionsId}
        aria-expanded={isOpen}
        className="justify-between gap-2"
        onSelect={(event) => {
          event.preventDefault();
          setIsOpen((open) => !open);
        }}
      >
        <span className="flex items-center gap-2">
          <Icon icon={LanguageSkillIcon} />
          {t("menu.language")}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {LANGUAGES.find((option) => option.code === language)?.label}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 transition-transform duration-200", isOpen && "rotate-180")}
          />
        </span>
      </DropdownMenuItem>
      <div
        id={optionsId}
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={cn(
          "grid overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        style={{ maxHeight: isOpen ? `${LANGUAGES.length * 32 + 4}px` : "0px" }}
      >
        <div className="min-h-0 overflow-hidden">
          <DropdownMenuRadioGroup
            value={language}
            onValueChange={(code) => setLanguage(code as LanguageCode)}
            className="ps-7 pt-1"
          >
            {LANGUAGES.map((option, index) => (
              <DropdownMenuRadioItem
                key={option.code}
                value={option.code}
                onSelect={(event) => {
                  event.preventDefault();
                  setIsOpen(false);
                }}
                className={cn(
                  "gap-2.5 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                  isOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                )}
                style={{ transitionDelay: isOpen ? `${index * 75}ms` : "0ms" }}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>
      </div>
    </>
  );
}
