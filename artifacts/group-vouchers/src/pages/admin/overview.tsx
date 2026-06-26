import {
  useGetAdminOverview,
  useGetAdminVisitors,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { AdminShell } from "./AdminShell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import {
  Banknote,
  Ticket,
  Clock,
  AlertTriangle,
  Eye,
  Users,
  CalendarDays,
} from "lucide-react";

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

function VisitorStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card className="border-border/70">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {label}
          </p>
        </div>
        <p className="text-2xl font-serif text-primary">
          {value.toLocaleString("en-US")}
        </p>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function shortDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function VisitorsSection() {
  const { data, isLoading } = useGetAdminVisitors();

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const chartData = data.daily.map((d) => ({
    label: shortDay(d.date),
    views: d.views,
    uniques: d.uniques,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <VisitorStat
          icon={Eye}
          label="Total page views"
          value={data.total_views}
        />
        <VisitorStat
          icon={CalendarDays}
          label="Views today"
          value={data.today_views}
        />
        <VisitorStat
          icon={Users}
          label="Unique visitors today"
          value={data.unique_today}
        />
        <VisitorStat
          icon={Users}
          label="Unique visitors (all-time)"
          value={data.unique_all_time}
          hint="Approximate, privacy-friendly"
        />
      </div>

      <Card className="border-border/70">
        <CardContent className="p-6 space-y-4">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Daily views · last 30 days
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              >
                <defs>
                  <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(215 51% 25%)"
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(215 51% 25%)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(38 23% 87%)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(220 9% 46%)" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "hsl(220 9% 46%)" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "0.5rem",
                    border: "1px solid hsl(38 23% 87%)",
                    fontSize: "12px",
                  }}
                  formatter={(value: number, name: string) => [
                    value.toLocaleString("en-US"),
                    name === "views" ? "Views" : "Unique",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="views"
                  stroke="hsl(215 51% 25%)"
                  strokeWidth={2}
                  fill="url(#viewsFill)"
                />
                <Area
                  type="monotone"
                  dataKey="uniques"
                  stroke="hsl(38 54% 45%)"
                  strokeWidth={2}
                  fillOpacity={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {data.top_paths.length > 0 ? (
        <Card className="border-border/70">
          <CardContent className="p-6 space-y-3">
            <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Top pages
            </p>
            <div className="divide-y divide-border/60">
              {data.top_paths.map((p) => (
                <div
                  key={p.path}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="font-mono text-foreground">{p.path}</span>
                  <span className="text-muted-foreground">
                    {p.views.toLocaleString("en-US")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
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

          <section className="space-y-4 pt-2">
            <h2 className="font-serif text-2xl text-primary">Site visitors</h2>
            <VisitorsSection />
          </section>
        </div>
      )}
    </AdminShell>
  );
}
