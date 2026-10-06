import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminCalendar,
  useBlockDate,
  useUnblockDate,
  useAdminRescheduleBooking,
  useAdminCancelBooking,
  getGetAdminCalendarQueryKey,
  getListBlockedDatesQueryKey,
} from "@workspace/api-client-react";
import type {
  AdminCalendarDay,
  AdminBooking,
  DayAvailability,
} from "@workspace/api-client-react";
import { AdminShell } from "./AdminShell";
import { DayPassCalendar } from "@/components/day-pass-date-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { Ban, CalendarClock, Loader2, Lock, Unlock, Users } from "lucide-react";

function formatDay(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    return String((err as { error?: unknown }).error);
  }
  return "Please try again in a moment.";
}

function BookingRow({
  booking,
  onChanged,
}: {
  booking: AdminBooking;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const reschedule = useAdminRescheduleBooking();
  const cancel = useAdminCancelBooking();
  const [newDate, setNewDate] = useState("");

  const doReschedule = () => {
    if (!newDate) {
      toast({ title: "Pick a date to move this booking to", variant: "destructive" });
      return;
    }
    reschedule.mutate(
      { bookingId: booking.id, data: { visit_date: newDate } },
      {
        onSuccess: () => {
          toast({ title: "Booking moved", description: `${booking.email} → ${newDate}` });
          setNewDate("");
          onChanged();
        },
        onError: (err) =>
          toast({
            title: "Could not move booking",
            description: errorMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  const doCancel = () => {
    if (
      !window.confirm(
        `Cancel ${booking.email}'s booking? The full value converts to account credit (no staff penalty).`,
      )
    ) {
      return;
    }
    cancel.mutate(
      { bookingId: booking.id },
      {
        onSuccess: () => {
          toast({ title: "Booking cancelled", description: "Value converted to account credit." });
          onChanged();
        },
        onError: (err) =>
          toast({
            title: "Could not cancel booking",
            description: errorMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {booking.email}
          </div>
          <div className="text-xs text-muted-foreground">
            {booking.product_name} · {booking.pax} pax · {booking.reschedule_count} reschedule
            {booking.reschedule_count === 1 ? "" : "s"}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {booking.status}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="h-8 w-auto"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={doReschedule}
          disabled={reschedule.isPending}
        >
          {reschedule.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
          )}
          Move
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={doCancel}
          disabled={cancel.isPending}
        >
          {cancel.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Ban className="mr-1.5 h-3.5 w-3.5" />
          )}
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DayCard({ day, onChanged }: { day: AdminCalendarDay; onChanged: () => void }) {
  const { toast } = useToast();
  const block = useBlockDate();
  const unblock = useUnblockDate();
  const [reason, setReason] = useState("");

  const toggleBlock = () => {
    if (day.blocked) {
      unblock.mutate(
        { date: day.date },
        {
          onSuccess: () => {
            toast({ title: "Date reopened", description: formatDay(day.date) });
            onChanged();
          },
          onError: (err) =>
            toast({
              title: "Could not reopen date",
              description: errorMessage(err),
              variant: "destructive",
            }),
        },
      );
    } else {
      block.mutate(
        { data: { date: day.date, reason: reason.trim() || null } },
        {
          onSuccess: () => {
            toast({ title: "Date blocked", description: formatDay(day.date) });
            setReason("");
            onChanged();
          },
          onError: (err) =>
            toast({
              title: "Could not block date",
              description: errorMessage(err),
              variant: "destructive",
            }),
        },
      );
    }
  };

  const closedTuesday = day.closed && !day.blocked;

  return (
    <Card className="border-border/70">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-serif text-lg text-primary">{formatDay(day.date)}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {day.used}/{day.capacity} booked · {day.remaining} left
            </div>
          </div>
          {day.blocked ? (
            <Badge variant="outline" className="border-destructive/30 text-destructive">
              Blocked
            </Badge>
          ) : closedTuesday ? (
            <Badge variant="outline" className="text-muted-foreground">
              Closed
            </Badge>
          ) : day.remaining === 0 ? (
            <Badge variant="outline" className="border-accent/30 text-accent-foreground">
              Full
            </Badge>
          ) : (
            <Badge variant="outline" className="border-primary/20 text-primary">
              Open
            </Badge>
          )}
        </div>

        {day.blocked && day.blocked_reason ? (
          <p className="text-xs text-muted-foreground">Reason: {day.blocked_reason}</p>
        ) : null}

        {day.bookings.length > 0 ? (
          <div className="space-y-2">
            {day.bookings.map((b) => (
              <BookingRow key={b.id} booking={b} onChanged={onChanged} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No bookings.</p>
        )}

        {!closedTuesday && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {!day.blocked && (
              <Input
                placeholder="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-8 w-auto flex-1 min-w-[8rem]"
              />
            )}
            <Button
              size="sm"
              variant={day.blocked ? "outline" : "ghost"}
              onClick={toggleBlock}
              disabled={block.isPending || unblock.isPending}
            >
              {block.isPending || unblock.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : day.blocked ? (
                <Unlock className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Lock className="mr-1.5 h-3.5 w-3.5" />
              )}
              {day.blocked ? "Reopen" : "Block day"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const MONTHS_AHEAD = 6;

export default function AdminCalendar() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");

  const { from, to } = useMemo(() => {
    const today = new Date();
    // Window spans whole calendar months so staff page month-by-month via the
    // calendar's own prev/next. Both bounds are formatted from local date
    // components to avoid a UTC off-by-one on non-UTC clients: `from` is today,
    // `to` is the last day of the month MONTHS_AHEAD out.
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const end = new Date(today.getFullYear(), today.getMonth() + MONTHS_AHEAD + 1, 0);
    return { from: fmt(today), to: fmt(end) };
  }, []);

  const { data, isLoading, isError } = useGetAdminCalendar({ from, to });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminCalendarQueryKey({ from, to }) });
    queryClient.invalidateQueries({ queryKey: getListBlockedDatesQueryKey() });
  };

  const visibleDays = useMemo(
    // Hide pure past days from the operational view; getAvailability marks them closed.
    () => (data?.days ?? []).filter((d) => d.date >= from),
    [data, from],
  );

  // Index for the detail panel, plus a DayAvailability map for the month-grid.
  const { dayByDate, availByDate } = useMemo(() => {
    const dayByDate = new Map<string, AdminCalendarDay>();
    const availByDate = new Map<string, DayAvailability>();
    for (const d of visibleDays) {
      dayByDate.set(d.date, d);
      availByDate.set(d.date, {
        date: d.date,
        capacity: d.capacity,
        used: d.used,
        remaining: d.remaining,
        closed: d.closed,
        blocked: d.blocked,
        blocked_reason: d.blocked_reason,
        bookable: !d.closed && !d.blocked && d.remaining > 0,
      });
    }
    return { dayByDate, availByDate };
  }, [visibleDays]);

  // Default the selection to the first open day, falling back to the first day,
  // and keep it valid as the visible range changes.
  useEffect(() => {
    if (visibleDays.length === 0) {
      if (selected) setSelected("");
      return;
    }
    if (selected && dayByDate.has(selected)) return;
    const firstOpen = visibleDays.find(
      (d) => !d.closed && !d.blocked && d.remaining > 0,
    );
    setSelected((firstOpen ?? visibleDays[0]).date);
  }, [visibleDays, dayByDate, selected]);

  const selectedDay = selected ? dayByDate.get(selected) : undefined;

  return (
    <AdminShell
      title="Day-Pass Calendar"
      subtitle="Live day-pass availability (max 10 guests/day, closed Tuesdays). Block dates, and reschedule or cancel any booking on a guest's behalf. Admin actions follow the same policy as guests: reschedules need 48h notice and max 2 per booking; cancellations within 24h or after 2 reschedules keep a 25% penalty and convert the remaining 75% to account credit (otherwise the full value becomes credit)."
    >
      {isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner className="h-8 w-8 text-primary" />
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Could not load the calendar.</p>
      ) : visibleDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">No days in this range.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
          <DayPassCalendar
            availability={availByDate}
            selected={selected}
            onSelect={setSelected}
            from={from}
            to={to}
            isLoading={isLoading}
            adminMode
          />
          {selectedDay ? (
            <DayCard day={selectedDay} onChanged={invalidate} />
          ) : (
            <Card className="border-border/70">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Select a day to view its bookings and availability.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </AdminShell>
  );
}
