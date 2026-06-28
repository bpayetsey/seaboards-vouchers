import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import type { DayAvailability } from "@workspace/api-client-react";
import { DAY_PASS_POLICY_POINTS } from "@workspace/voucher-content";
import { cn } from "@/lib/utils";

function isoToDate(iso: string) {
  return new Date(iso + "T00:00:00");
}

function dateToISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Build the grid of dates for a month, Monday-first, padded with the trailing
 * days of the previous month and leading days of the next month so every row
 * has seven cells.
 */
function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  // getDay(): 0 = Sun … 6 = Sat. Convert to Monday-first offset.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  // Trim trailing all-other-month week if unused (keeps grid compact).
  return cells.slice(0, cells[35] && cells[35].getMonth() === month.getMonth() ? 42 : 35);
}

export interface DayPassCalendarProps {
  /** Availability keyed by ISO date (YYYY-MM-DD). */
  availability: Map<string, DayAvailability>;
  /** Currently selected ISO date, or "" when none. */
  selected: string;
  /** Called with the ISO date when a selectable day is clicked. */
  onSelect: (iso: string) => void;
  /** Earliest selectable ISO date (inclusive). */
  from: string;
  /** Latest selectable ISO date (inclusive). */
  to: string;
  /** When true, the whole calendar is non-interactive (e.g. gift-later). */
  disabled?: boolean;
  /** Shows a subtle loading state while availability is fetching. */
  isLoading?: boolean;
}

/**
 * A modern visual month-grid date picker for day-pass visits. Tuesdays,
 * admin-blocked dates and full (capacity-reached) dates are visibly disabled;
 * the selected date is highlighted; selectable days show the remaining places.
 *
 * Presentation only — it consumes the existing availability data and never
 * relaxes the server-side rules.
 */
export function DayPassCalendar({
  availability,
  selected,
  onSelect,
  from,
  to,
  disabled = false,
  isLoading = false,
}: DayPassCalendarProps) {
  const fromDate = isoToDate(from);
  const toDate = isoToDate(to);

  const [view, setView] = useState(() =>
    startOfMonth(selected ? isoToDate(selected) : fromDate),
  );

  const cells = useMemo(() => monthGrid(view), [view]);

  const canPrev = !sameMonth(view, fromDate) && view > startOfMonth(fromDate);
  const canNext = !sameMonth(view, toDate) && view < startOfMonth(toDate);

  const goPrev = () =>
    setView((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const goNext = () =>
    setView((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-xl border border-border bg-background p-3 sm:p-4",
        disabled && "pointer-events-none opacity-50",
      )}
      aria-disabled={disabled}
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={goPrev}
          disabled={!canPrev}
          aria-label="Previous month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-semibold text-foreground">
          {view.toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
          })}
        </div>
        <button
          type="button"
          onClick={goNext}
          disabled={!canNext}
          aria-label="Next month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1" aria-busy={isLoading}>
        {cells.map((date) => {
          const iso = dateToISO(date);
          const inMonth = date.getMonth() === view.getMonth();
          const inRange = iso >= from && iso <= to;
          const day = availability.get(iso);
          const bookable = Boolean(day?.bookable) && inRange;
          const isSelected = selected === iso;

          if (!inMonth) {
            return <div key={iso} className="aspect-square" aria-hidden />;
          }

          if (!bookable) {
            return (
              <div
                key={iso}
                className="flex aspect-square flex-col items-center justify-center rounded-lg text-muted-foreground/40"
                title={
                  day?.blocked
                    ? day.blocked_reason || "Unavailable"
                    : day?.closed
                      ? "Closed"
                      : day
                        ? "Fully booked"
                        : "Unavailable"
                }
              >
                <span className="text-sm line-through decoration-muted-foreground/40">
                  {date.getDate()}
                </span>
              </div>
            );
          }

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              aria-pressed={isSelected}
              aria-label={`${date.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })} — ${day!.remaining} place${day!.remaining === 1 ? "" : "s"} left`}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-transparent text-foreground hover:border-primary/40 hover:bg-primary/5",
              )}
            >
              <span className="font-medium leading-none">{date.getDate()}</span>
              <span
                className={cn(
                  "mt-0.5 text-[0.6rem] leading-none",
                  isSelected
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground",
                )}
              >
                {day!.remaining} left
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[0.7rem] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          Selected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-border" />
          Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground/50 line-through">00</span>
          Closed / full
        </span>
      </div>
    </div>
  );
}

/**
 * Concise booking & cancellation policy shown beside the visit-date calendar.
 * Content is sourced from {@link DAY_PASS_POLICY_POINTS} in the shared
 * voucher-content module so the storefront and dashboard never drift.
 */
export function DayPassPolicy({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/30 p-4",
        className,
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <div className="text-sm font-medium text-foreground">
          Booking &amp; cancellation policy
        </div>
      </div>
      <ul className="space-y-2.5">
        {DAY_PASS_POLICY_POINTS.map((point) => (
          <li key={point.title} className="text-xs leading-relaxed">
            <span className="font-semibold text-foreground">
              {point.title}.
            </span>{" "}
            <span className="text-muted-foreground">{point.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
