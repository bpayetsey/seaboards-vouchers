import { useGetDashboard } from "@workspace/api-client-react";
import type {
  DashboardVoucher,
  DashboardPayment,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import {
  Ticket,
  Wallet,
  ReceiptText,
  Download,
  Gift,
  CreditCard,
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
  if (s === "active" || s === "paid" || s === "complete")
    return "bg-primary/10 text-primary border-primary/20";
  if (s === "pending" || s === "open" || s === "scheduled")
    return "bg-accent/10 text-accent-foreground border-accent/30";
  if (s === "failed")
    return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-muted text-muted-foreground border-border";
}

export default function Dashboard() {
  const { user } = useUser();
  const { data, isLoading, isError } = useGetDashboard();

  return (
    <Layout>
      <div className="container max-w-5xl mx-auto px-6 py-12 space-y-10">
        <header className="space-y-2">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.28em] text-accent-foreground">
            Your Account
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl text-primary">
            {user?.firstName ? `Welcome, ${user.firstName}` : "Welcome back"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Vouchers, payments and receipts for{" "}
            <span className="font-medium text-foreground">
              {data?.email ?? user?.primaryEmailAddress?.emailAddress ?? "your account"}
            </span>
            .
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              We couldn&rsquo;t load your account right now. Please refresh and
              try again.
            </CardContent>
          </Card>
        ) : (
          <>
            <VouchersSection vouchers={data?.vouchers ?? []} />
            <PaymentsSection payments={data?.payments ?? []} />
            <ReceiptsSection payments={data?.payments ?? []} />
          </>
        )}
      </div>
    </Layout>
  );
}

function SectionHeading({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <h2 className="font-serif text-2xl text-primary">{title}</h2>
      <span className="ml-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

function VouchersSection({ vouchers }: { vouchers: DashboardVoucher[] }) {
  return (
    <section>
      <SectionHeading
        icon={<Ticket className="h-4 w-4" />}
        title="Vouchers & Credit"
        count={vouchers.length}
      />
      {vouchers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No vouchers or credit codes yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {vouchers.map((v, i) =>
            v.pending ? (
              <Card
                key={`${v.source}-pending-${i}`}
                className="overflow-hidden border-dashed border-accent/50 bg-accent/5"
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Voucher
                    </span>
                    <Badge
                      variant="outline"
                      className={`capitalize ${statusTone("pending")}`}
                    >
                      Pending
                    </Badge>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    Voucher pending
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Your share is paid. The combined voucher is released once
                    everyone in the group has paid.
                  </p>
                  <div className="flex items-center justify-between text-sm text-muted-foreground pt-1">
                    <span>
                      {v.value_minor != null
                        ? `${formatMoney(fromMinor(v.value_minor), v.currency)} paid`
                        : "—"}
                    </span>
                    <span>Group order</span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card
                key={`${v.source}-${v.kind}-${v.code}-${i}`}
                className="overflow-hidden"
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {v.kind === "credit" ? (
                        <Gift className="h-3.5 w-3.5" />
                      ) : (
                        <Ticket className="h-3.5 w-3.5" />
                      )}
                      {v.kind === "credit" ? "Credit" : "Voucher"}
                    </span>
                    <Badge
                      variant="outline"
                      className={`capitalize ${statusTone(v.status)}`}
                    >
                      {v.status}
                    </Badge>
                  </div>
                  <div className="font-mono text-lg font-semibold tracking-wider text-foreground break-all">
                    {v.code}
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {v.value_minor != null
                        ? formatMoney(fromMinor(v.value_minor), v.currency)
                        : "—"}
                    </span>
                    <span>
                      {v.expires_at
                        ? `Expires ${formatDate(v.expires_at)}`
                        : v.source === "group"
                          ? "Group order"
                          : "Storefront"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function PaymentsSection({ payments }: { payments: DashboardPayment[] }) {
  return (
    <section>
      <SectionHeading
        icon={<Wallet className="h-4 w-4" />}
        title="Payments"
        count={payments.length}
      />
      {payments.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No payments recorded yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-4 p-5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                  <CreditCard className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">
                    {p.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.paid_at ? formatDate(p.paid_at) : "Not yet paid"} ·{" "}
                    {p.source === "group" ? "Group order" : "Storefront"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">
                    {formatMoney(fromMinor(p.amount_minor), p.currency)}
                  </p>
                  <Badge
                    variant="outline"
                    className={`mt-1 capitalize ${statusTone(p.status)}`}
                  >
                    {p.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function ReceiptsSection({ payments }: { payments: DashboardPayment[] }) {
  const receipts = payments.filter((p) => !!p.receipt_url);
  return (
    <section>
      <SectionHeading
        icon={<ReceiptText className="h-4 w-4" />}
        title="Receipts"
        count={receipts.length}
      />
      {receipts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No receipts available yet. Receipts appear here once a payment is
            completed.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {receipts.map((p) => (
              <div
                key={`receipt-${p.id}`}
                className="flex flex-wrap items-center gap-4 p-5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                  <ReceiptText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">
                    {p.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(p.paid_at)} ·{" "}
                    {formatMoney(fromMinor(p.amount_minor), p.currency)}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <a
                    href={p.receipt_url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Receipt
                  </a>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
