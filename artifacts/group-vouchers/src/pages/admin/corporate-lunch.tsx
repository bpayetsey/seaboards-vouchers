import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminCorporateLunchRequests,
  useUpdateCorporateLunchRequestStatus,
  getGetAdminCorporateLunchRequestsQueryKey,
  type AdminCorporateLunchRequest,
  type UpdateCorporateLunchStatusInputStatus,
} from "@workspace/api-client-react";
import { AdminShell } from "./AdminShell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, UtensilsCrossed } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const scr = (n: number) => `SCR ${Math.round(n).toLocaleString("en-US")}`;

function formatDate(d: string) {
  return new Date(`${d}T12:00:00+04:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function statusTone(status: string): string {
  if (status === "confirmed") return "bg-primary/10 text-primary border-primary/20";
  if (status === "new") return "bg-accent/10 text-accent-foreground border-accent/30";
  if (status === "declined" || status === "cancelled") return "bg-muted text-muted-foreground border-border";
  return "bg-muted text-muted-foreground border-border";
}

const ACTIONS: { status: UpdateCorporateLunchStatusInputStatus; label: string; from: string[] }[] = [
  { status: "confirmed", label: "Confirm", from: ["new", "declined"] },
  { status: "declined", label: "Decline", from: ["new"] },
  { status: "cancelled", label: "Cancel", from: ["confirmed"] },
  { status: "new", label: "Reopen", from: ["declined", "cancelled"] },
];

function RequestCard({ r }: { r: AdminCorporateLunchRequest }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateCorporateLunchRequestStatus();
  const [pending, setPending] = useState<string | null>(null);

  const setStatus = (status: UpdateCorporateLunchStatusInputStatus) => {
    setPending(status);
    update.mutate(
      { requestId: r.id, data: { status } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetAdminCorporateLunchRequestsQueryKey() });
          toast({ title: `${r.reference} marked ${status}` });
        },
        onError: () => toast({ title: "Could not update the request", variant: "destructive" }),
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif text-xl text-primary">{r.company}</p>
            <p className="text-sm text-muted-foreground">
              {formatDate(r.event_date)} · {r.guests} guests · <span className="font-mono">{r.reference}</span>
            </p>
            <p className="text-sm text-muted-foreground break-words">
              {r.contact_name} · <a className="underline" href={`tel:${r.phone}`}>{r.phone}</a> ·{" "}
              <a className="underline" href={`mailto:${r.email}`}>{r.email}</a>
            </p>
          </div>
          <Badge variant="outline" className={`capitalize ${statusTone(r.status)}`}>
            {r.status}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <ul className="space-y-1 text-sm">
            {r.dishes.map((c) => (
              <li key={c.course}>
                <span className="font-semibold">{c.course}:</span> {c.names.join(", ") || "—"}
              </li>
            ))}
            {r.extras.length > 0 && (
              <li className="text-muted-foreground">
                Extras: {r.extras.map((e) => `${e.name} (+${scr(e.price_per_person)})`).join(", ")}
              </li>
            )}
            {r.notes && <li className="pt-2 text-muted-foreground">Notes: {r.notes}</li>}
          </ul>
          <dl className="text-sm tabular-nums space-y-1 rounded-md border border-border/60 bg-background p-3">
            <div className="flex justify-between"><dt className="text-muted-foreground">Price pp</dt><dd>{scr(r.price_per_person)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{scr(r.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Cost pp (est.)</dt><dd>{scr(r.cost_per_person)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Labour</dt><dd>{scr(r.labour)}</dd></div>
            <div className="flex justify-between border-t border-border/60 pt-1 font-semibold text-primary">
              <dt>Profit</dt>
              <dd>{scr(r.profit)} · {Math.round(r.margin * 100)}%</dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-wrap gap-2">
          {ACTIONS.filter((a) => a.from.includes(r.status)).map((a) => (
            <Button
              key={a.status}
              size="sm"
              variant={a.status === "confirmed" ? "default" : "outline"}
              disabled={pending !== null}
              onClick={() => setStatus(a.status)}
            >
              {pending === a.status ? "Saving…" : a.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminCorporateLunch() {
  const { data, isLoading, isError } = useGetAdminCorporateLunchRequests();
  const requests = data?.requests ?? [];
  const open = requests.filter((r) => r.status === "new").length;

  return (
    <AdminShell
      title="Corporate Lunch"
      subtitle={`Buffet requests from the public menu builder${open ? ` · ${open} awaiting reply` : ""}. Costs are estimates from the recipe costing.`}
    >
      <div className="mb-4">
        <a
          href={`${basePath}/corporate-lunch`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary underline"
        >
          Open the public menu builder <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load requests. Refresh to try again.</p>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
            <UtensilsCrossed className="h-6 w-6" />
            <p>No corporate lunch requests yet. They appear here when a company sends one from the menu builder.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <RequestCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
