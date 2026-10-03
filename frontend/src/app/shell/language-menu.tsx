import { LanguageSkillIcon } from "@hugeicons/core-free-icons";
import { LANGUAGES, useI18n, useT, type LanguageCode } from "@/shared/i18n";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/shared/ui/dropdown-menu";
import { Icon } from "@/shared/ui/page";

/**
 * The language switch, inside the account menu next to the theme switch.
 *
 * It renders `LANGUAGES`, so a language this build ships is offered here the moment it is declared —
 * there is no second list to keep in step. The choice is a radio group rather than a row of buttons:
 * exactly one language is current, and the menu says so without any colour carrying the meaning.
 */
export function LanguageMenu() {
  const t = useT("shell");
  const { language, setLanguage } = useI18n();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <Icon icon={LanguageSkillIcon} />
        {t("menu.language")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        sideOffset={8}
        alignOffset={-4}
        avoidCollisions
        collisionPadding={12}
        className="min-w-44 max-w-[calc(100vw-3rem)] rounded-[16px] p-1.5"
      >
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(code) => setLanguage(code as LanguageCode)}
        >
          {LANGUAGES.map((option) => (
            <DropdownMenuRadioItem key={option.code} value={option.code} className="gap-2.5">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
