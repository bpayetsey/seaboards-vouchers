import { useGetAdminOverview } from "@workspace/api-client-react";
import { AdminShell } from "./AdminShell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { Banknote, Ticket, Clock, AlertTriangle } from "lucide-react";

function fromMinor(amountMinor: number) {
  return amountMinor / 100;
}

function MoneyList({
  rows,
}: {
  rows: { currency: string; amount_minor: number; count?: number }[];
}) {
  if (rows.length === 0) {
    return <p className="text-2xl font-serif text-primary">—</p>;
  }
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <p key={r.currency} className="text-2xl font-serif text-primary">
          {formatMoney(fromMinor(r.amount_minor), r.currency.toUpperCase())}
          {typeof r.count === "number" ? (
            <span className="ml-2 text-sm font-sans text-muted-foreground">
              ({r.count})
            </span>
          ) : null}
        </p>
      ))}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  children,
  tone = "primary",
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  tone?: "primary" | "accent" | "destructive";
}) {
  const ring =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : tone === "accent"
        ? "bg-accent/15 text-accent-foreground"
        : "bg-primary/10 text-primary";
  return (
    <Card className="border-border/70">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${ring}`}>
            <Icon className="h-4 w-4" />
          </span>
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {label}
          </p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export default function AdminOverview() {
  const { data, isLoading } = useGetAdminOverview();

  return (
    <AdminShell
      title="Overview"
      subtitle="Collected revenue, voucher status and the health of instalment plans."
    >
      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Banknote} label="Revenue collected">
              <MoneyList rows={data.revenue} />
            </StatCard>
            <StatCard icon={Ticket} label="Vouchers" tone="accent">
              <p className="text-2xl font-serif text-primary">
                {data.vouchers_active}
                <span className="ml-2 text-sm font-sans text-muted-foreground">
                  active
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {data.vouchers_redeemed} redeemed · {data.vouchers_issued} issued
              </p>
            </StatCard>
            <StatCard icon={Clock} label="Outstanding instalments" tone="accent">
              <MoneyList
                rows={data.outstanding.map((o) => ({
                  currency: o.currency,
                  amount_minor: o.amount_minor,
                  count: o.count,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                {data.outstanding_count} scheduled
              </p>
            </StatCard>
            <StatCard
              icon={AlertTriangle}
              label="Failed / needs action"
              tone="destructive"
            >
              <MoneyList
                rows={data.failed.map((o) => ({
                  currency: o.currency,
                  amount_minor: o.amount_minor,
                  count: o.count,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                {data.failed_count} require attention
              </p>
            </StatCard>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
