import { useState } from "react";
import {
  useGetAdminGroupOrders,
  type AdminGroupOrder,
  type AdminGroupParticipant,
} from "@workspace/api-client-react";
import { AdminShell } from "./AdminShell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import {
  ChevronDown,
  Download,
  Users,
  CheckCircle2,
  Clock,
} from "lucide-react";

function fromMinor(amountMinor: number) {
  return amountMinor / 100;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s === "paid" || s === "complete" || s === "active")
    return "bg-primary/10 text-primary border-primary/20";
  if (s === "scheduled" || s === "pending" || s === "open")
    return "bg-accent/10 text-accent-foreground border-accent/30";
  if (s === "failed" || s === "needs_action")
    return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-muted text-muted-foreground border-border";
}

const MODE_LABEL: Record<string, string> = {
  independent: "Independent",
  flat: "Flat split",
  split: "Split voucher",
};

function ParticipantRow({
  p,
  currency,
}: {
  p: AdminGroupParticipant;
  currency: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {p.payer_name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {p.payer_email}
        </p>
        {p.voucher_code ? (
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">Voucher </span>
            <span className="font-mono text-primary">{p.voucher_code}</span>
          </p>
        ) : null}
        {p.credit_code ? (
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">Credit </span>
            <span className="font-mono text-accent-foreground">
              {p.credit_code}
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-serif text-sm text-primary">
          {formatMoney(fromMinor(p.amount_minor), currency.toUpperCase())}
        </span>
        <Badge variant="outline" className={statusTone(p.status)}>
          {p.status}
        </Badge>
        {p.receipt_url ? (
          <Button asChild size="sm" variant="outline" className="gap-1">
            <a href={p.receipt_url} target="_blank" rel="noopener noreferrer">
              <Download className="h-3.5 w-3.5" />
              Receipt
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function GroupOrderCard({ order }: { order: AdminGroupOrder }) {
  const [open, setOpen] = useState(false);
  const isSplit = order.mode === "split";
  const progressPercent =
    order.total_count > 0
      ? Math.round((order.paid_count / order.total_count) * 100)
      : 0;

  return (
    <Card className="border-border/70">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-lg text-primary">
                {MODE_LABEL[order.mode] ?? order.mode}
              </h3>
              <Badge variant="outline" className={statusTone(order.status)}>
                {order.status}
              </Badge>
              {isSplit ? (
                order.voucher_released ? (
                  <Badge
                    variant="outline"
                    className="border-primary/20 bg-primary/10 text-primary"
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Voucher released
                  </Badge>
                ) : order.status !== "expired" ? (
                  <Badge
                    variant="outline"
                    className="border-accent/30 bg-accent/10 text-accent-foreground"
                  >
                    <Clock className="mr-1 h-3 w-3" />
                    Voucher held
                  </Badge>
                ) : null
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {order.organiser_name} · {order.organiser_email}
            </p>
            <p className="text-xs text-muted-foreground">
              Placed {formatDate(order.created_at)}
              {order.due_by ? <> · Due {formatDate(order.due_by)}</> : null}
              {isSplit && order.split_apartment_type ? (
                <>
                  {" "}
                  ·{" "}
                  {order.split_apartment_type === "one_bedroom"
                    ? "1 Bed"
                    : "2 Bed"}
                  {order.split_nights ? ` × ${order.split_nights} nights` : ""}
                </>
              ) : null}
            </p>
            {isSplit && order.voucher_released && order.split_voucher_code ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Master voucher </span>
                <span className="font-mono text-primary">
                  {order.split_voucher_code}
                </span>
              </p>
            ) : isSplit ? (
              <p className="text-xs text-muted-foreground">
                Combined voucher not released — held until every share is paid.
              </p>
            ) : null}
          </div>
          <div className="space-y-1 text-right">
            <p className="font-serif text-xl text-primary">
              {formatMoney(
                fromMinor(order.paid_minor),
                order.currency.toUpperCase(),
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              of{" "}
              {formatMoney(
                fromMinor(order.total_minor),
                order.currency.toUpperCase(),
              )}{" "}
              paid
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {order.paid_count} / {order.total_count} shares paid
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground"
        >
          <ChevronDown
            className={`mr-1 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
          {open ? "Hide" : "Show"} participants ({order.participants.length})
        </Button>

        {open ? (
          <div className="space-y-2 pt-1">
            {order.participants.map((p) => (
              <ParticipantRow key={p.id} p={p} currency={order.currency} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AdminGroupOrders() {
  const { data, isLoading } = useGetAdminGroupOrders();

  return (
    <AdminShell
      title="Group Orders"
      subtitle="Split, flat and independent group orders. For split orders the combined voucher is released only once every share is paid. View-only."
    >
      {isLoading || !data ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : data.orders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center text-muted-foreground">
            No group orders yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.orders.map((order) => (
            <GroupOrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
