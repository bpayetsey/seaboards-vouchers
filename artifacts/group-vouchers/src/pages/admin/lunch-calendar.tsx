import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminCorporateLunchCalendar,
  useBlockCorporateLunchDate,
  useUnblockCorporateLunchDate,
  getGetAdminCorporateLunchCalendarQueryKey,
} from "@workspace/api-client-react";
import type {
  AdminCorporateLunchCalendarDay,
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
import { Loader2, Lock, Unlock, Users } from "lucide-react";

function formatDay(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    return String((err as { error?: unknown }).error);
  }
  return "Please try again in a moment.";
}

const scr = (n: number) => `SCR ${Math.round(n).toLocaleString("en-US")}`;

function DayCard({
  day,
  onChanged,
}: {
  day: AdminCorporateLunchCalendarDay;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const block = useBlockCorporateLunchDate();
  const unblock = useUnblockCorporateLunchDate();
  const [reason, setReason] = useState("");

  const toggle = () => {
    if (day.blocked) {
      unblock.mutate(
        { date: day.date },
        {
          onSuccess: () => {
            toast({ title: "Date reopened", description: formatDay(day.date) });
            onChanged();
          },
          onError: (err) =>
            toast({ title: "Could not reopen date", description: errorMessage(err), variant: "destructive" }),
        },
      );
      return;
    }
    if (
      day.requests.length > 0 &&
      !window.confirm(
        `${day.requests.length} request${day.requests.length === 1 ? " is" : "s are"} already on this day. Closing it won't cancel them — you'll need to contact those clients. Close the date anyway?`,
      )
    ) {
      return;
    }
    block.mutate(
      { data: { date: day.date, reason: reason.trim() || null } },
      {
        onSuccess: () => {
          toast({ title: "Date closed", description: formatDay(day.date) });
          setReason("");
          onChanged();
        },
        onError: (err) =>
          toast({ title: "Could not close date", description: errorMessage(err), variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/70">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-serif text-lg text-primary">{formatDay(day.date)}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {day.requests.length} request{day.requests.length === 1 ? "" : "s"}
            </div>
          </div>
          {day.blocked ? (
            <Badge variant="outline" className="border-destructive/30 text-destructive">
              Closed
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

        {day.requests.length > 0 ? (
          <div className="space-y-2">
            {day.requests.map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-background/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {r.company} · {r.contact_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.reference} · {r.guests} guests · {scr(r.total)}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 capitalize">
                    {r.status}
                  </Badge>
                </div>
              </div>
            ))}
            <Link href="/admin/corporate-lunch" className="text-xs text-primary underline">
              Open requests to confirm or decline
            </Link>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No requests.</p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {!day.blocked && (
            <Input
              placeholder="Reason (optional, private)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-8 w-auto flex-1 min-w-[8rem]"
            />
          )}
          <Button
            size="sm"
            variant={day.blocked ? "outline" : "ghost"}
            onClick={toggle}
            disabled={block.isPending || unblock.isPending}
          >
            {block.isPending || unblock.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : day.blocked ? (
              <Unlock className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Lock className="mr-1.5 h-3.5 w-3.5" />
            )}
            {day.blocked ? "Reopen" : "Close day"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const MONTHS_AHEAD = 11;

export default function AdminLunchCalendar() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");

  const { from, to } = useMemo(() => {
    const today = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const end = new Date(today.getFullYear(), today.getMonth() + MONTHS_AHEAD + 1, 0);
    return { from: fmt(today), to: fmt(end) };
  }, []);

  const { data, isLoading, isError } = useGetAdminCorporateLunchCalendar({ from, to });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getGetAdminCorporateLunchCalendarQueryKey({ from, to }),
    });

  const { dayByDate, availByDate } = useMemo(() => {
    const dayByDate = new Map<string, AdminCorporateLunchCalendarDay>();
    const availByDate = new Map<string, DayAvailability>();
    for (const d of data?.days ?? []) {
      dayByDate.set(d.date, d);
      availByDate.set(d.date, {
        date: d.date,
        capacity: 1,
        used: d.requests.length,
        remaining: 1,
        closed: false,
        blocked: d.blocked,
        blocked_reason: d.blocked_reason,
        bookable: !d.blocked,
      });
    }
    return { dayByDate, availByDate };
  }, [data]);

  useEffect(() => {
    if (!data || selected) return;
    setSelected(from);
  }, [data, selected, from]);

  const selectedDay = selected ? dayByDate.get(selected) : undefined;

  return (
    <AdminShell
      title="Corporate Lunch Calendar"
      subtitle="Close dates for corporate lunch (resort closed, private event, kitchen committed). Closed dates are greyed out on the public request form and rejected if someone tries them. Days with requests show how many are booked."
    >
      {isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner className="h-8 w-8 text-primary" />
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Could not load the calendar.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
          <DayPassCalendar
            availability={availByDate}
            selected={selected}
            onSelect={setSelected}
            from={from}
            to={to}
            adminMode
            openLabel={(day) => (day.used > 0 ? `${day.used} req` : "Open")}
          />
          {selectedDay ? (
            <DayCard day={selectedDay} onChanged={invalidate} />
          ) : (
            <Card className="border-border/70">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Select a day to view requests or close it.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </AdminShell>
  );
}
