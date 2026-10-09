import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { currentLocale, useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const [date, time = "00:00"] = value.split("T");
  const [year, month, day] = (date ?? "").split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hours === undefined ||
    minutes === undefined ||
    ![year, month, day, hours, minutes].every(Number.isFinite)
  )
    return null;
  return new Date(year, month - 1, day, hours, minutes);
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function DateTimePicker({
  name,
  defaultValue = "",
  onValueChange,
}: {
  name: string;
  defaultValue?: string;
  onValueChange?: () => void;
}) {
  const t = useT("developer");
  const locale = currentLocale();
  const initialDate = parseLocalDateTime(defaultValue) ?? new Date();
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(initialDate));
  const groupRef = useRef<HTMLDivElement>(null);
  const selected = parseLocalDateTime(value);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    visibleMonth,
  );
  const dayLabel = new Intl.DateTimeFormat(locale, { day: "numeric" });
  const weekdayLabel = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    weekdayLabel.format(new Date(2024, 0, index + 1)),
  );
  const firstDay = monthStart(visibleMonth);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - mondayOffset);
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });

  useEffect(() => {
    const form = groupRef.current?.closest("form");
    if (!form) return;
    const reset = () => {
      setValue(defaultValue);
      setVisibleMonth(monthStart(parseLocalDateTime(defaultValue) ?? new Date()));
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue]);

  const chooseDay = (day: Date) => {
    const next = new Date(day);
    const time = selected ?? new Date();
    next.setHours(time.getHours(), time.getMinutes(), 0, 0);
    setValue(localDateTime(next));
    setVisibleMonth(monthStart(day));
    onValueChange?.();
  };

  const updateTime = (time: string) => {
    if (!time) return;
    const [hours, minutes] = time.split(":").map(Number);
    if (hours === undefined || minutes === undefined) return;
    const next = selected ?? new Date();
    next.setHours(hours, minutes, 0, 0);
    setValue(localDateTime(next));
    onValueChange?.();
  };

  const formattedValue = selected
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        hourCycle: "h23",
      }).format(selected)
    : t("dateTime.placeholder");

  return (
    <div ref={groupRef}>
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-between rounded-xl px-3 font-normal"
          >
            <span className={selected ? "text-foreground" : "text-muted-foreground"}>
              {formattedValue}
            </span>
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("dateTime.previousMonth")}
              onClick={() =>
                setVisibleMonth(
                  new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <p className="text-sm font-semibold capitalize" aria-live="polite">
              {monthLabel}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("dateTime.nextMonth")}
              onClick={() =>
                setVisibleMonth(
                  new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekDays.map((day, index) => (
              <span
                key={`${day}-${index}`}
                className="py-1 text-xs font-medium text-muted-foreground"
              >
                {day}
              </span>
            ))}
            {days.map((day) => {
              const inMonth = day.getMonth() === visibleMonth.getMonth();
              const isSelected = !!selected && sameDay(selected, day);
              const isToday = sameDay(new Date(), day);
              return (
                <button
                  key={localDateTime(day).slice(0, 10)}
                  type="button"
                  aria-label={new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(day)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => chooseDay(day)}
                  className={`flex size-9 items-center justify-center rounded-xl text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? "bg-primary font-semibold text-primary-foreground" : isToday ? "border border-primary/40 text-foreground" : "text-foreground hover:bg-accent"} ${inMonth ? "" : "text-muted-foreground/60"}`}
                >
                  {dayLabel.format(day)}
                </button>
              );
            })}
          </div>
          <div className="mt-4 border-t pt-4">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{t("dateTime.time")}</span>
              <Input
                type="time"
                value={
                  selected
                    ? `${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`
                    : ""
                }
                onChange={(event) => updateTime(event.target.value)}
                disabled={!selected}
                className="h-10 w-32 bg-background"
              />
            </label>
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => chooseDay(new Date())}>
                {t("dateTime.today")}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setValue("");
                    onValueChange?.();
                  }}
                >
                  {t("dateTime.clear")}
                </Button>
                <Button type="button" size="sm" onClick={() => setOpen(false)}>
                  {t("dateTime.done")}
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
