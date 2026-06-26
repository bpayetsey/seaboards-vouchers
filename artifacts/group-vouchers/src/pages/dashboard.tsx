import {
  useGetDashboard,
  useResendOrganisedLine,
  getGetDashboardQueryKey,
} from "@workspace/api-client-react";
import type {
  DashboardVoucher,
  DashboardPayment,
  DashboardOrganisedOrder,
  DashboardOrganisedLine,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  downloadVoucherPdf,
  dashboardVoucherPdfUrl,
  voucherPdfFilename,
} from "@/lib/voucherPdf";
import {
  Ticket,
  Wallet,
  ReceiptText,
  Download,
  Gift,
  CreditCard,
  Clock,
  Users,
  Mail,
  Copy,
  Check,
  CheckCircle2,
} from "lucide-react";

function fromMinor(amountMinor: number) {
  return amountMinor / 100;
}

function DownloadVoucherButton({ code }: { code: string }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadVoucherPdf(
        dashboardVoucherPdfUrl(code),
        voucherPdfFilename(code),
      );
    } catch {
      toast({
        title: "Download failed",
        description: "We couldn't generate your voucher PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      disabled={downloading}
      onClick={handleDownload}
    >
      <Download className="h-3.5 w-3.5 mr-2" />
      {downloading ? "Preparing…" : "Download voucher (PDF)"}
    </Button>
  );
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
            <OrganisedOrdersSection orders={data?.organised_orders ?? []} />
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

function payUrlFor(payLink: string) {
  return (
    window.location.origin +
    import.meta.env.BASE_URL.replace(/\/$/, "") +
    payLink
  );
}

function lineStatusLabel(status: string) {
  const s = status.toLowerCase();
  if (s === "paid") return "Paid";
  if (s === "expired") return "Expired";
  return "Pending";
}

function OrganisedLineRow({
  order,
  line,
}: {
  order: DashboardOrganisedOrder;
  line: DashboardOrganisedLine;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resend = useResendOrganisedLine();
  const [copied, setCopied] = useState(false);

  const payUrl = payUrlFor(line.pay_link);
  const isPaid = line.status === "paid";
  const isExpired = line.status === "expired";
  const actionable = !isPaid && !isExpired;

  const copyLink = () => {
    navigator.clipboard.writeText(payUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Payment link copied" });
  };

  const sendReminder = () => {
    resend.mutate(
      { orderId: order.id, lineId: line.id },
      {
        onSuccess: () => {
          toast({ title: `Reminder sent to ${line.payer_email}` });
          queryClient.invalidateQueries({
            queryKey: getGetDashboardQueryKey(),
          });
        },
        onError: (err: unknown) => {
          const message =
            err && typeof err === "object" && "error" in err
              ? String((err as { error?: unknown }).error)
              : "Please try again.";
          toast({
            title: "Couldn't send reminder",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground truncate">
            {line.payer_name}
          </p>
          <Badge
            variant="outline"
            className={`capitalize ${statusTone(line.status)}`}
          >
            {lineStatusLabel(line.status)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {line.payer_email}
        </p>
        {(line.voucher_code || line.credit_code) && (
          <div className="mt-2 space-y-1 text-xs">
            {line.voucher_code && (
              <p>
                <span className="text-muted-foreground">Voucher: </span>
                <span className="font-mono tracking-wider text-primary">
                  {line.voucher_code}
                </span>
              </p>
            )}
            {line.credit_code && (
              <p>
                <span className="text-muted-foreground">Credit: </span>
                <span className="font-mono tracking-wider text-accent-foreground">
                  {line.credit_code}
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="font-semibold text-foreground sm:text-right">
        {formatMoney(fromMinor(line.amount_minor), order.currency)}
      </div>

      {actionable && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <Button asChild size="sm" className="gap-1.5">
            <a href={payUrl}>
              <CreditCard className="h-3.5 w-3.5" />
              Pay
            </a>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={sendReminder}
            disabled={resend.isPending}
          >
            <Mail className="h-3.5 w-3.5" />
            Remind
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={copyLink}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Link"}
          </Button>
        </div>
      )}
    </div>
  );
}

function OrganisedOrderCard({ order }: { order: DashboardOrganisedOrder }) {
  const isComplete = order.status === "complete";
  const progress =
    order.total_minor > 0
      ? Math.round((order.paid_minor / order.total_minor) * 100)
      : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-border bg-muted/30 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`capitalize ${statusTone(order.status)}`}
              >
                {isComplete
                  ? "Complete"
                  : order.status === "expired"
                    ? "Expired"
                    : "In progress"}
              </Badge>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {order.mode} order
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {order.due_by ? `Due ${formatDate(order.due_by)}` : "No due date"}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {order.paid_count} of {order.total_count} paid
              </span>
              <span className="font-medium text-foreground">
                {formatMoney(fromMinor(order.paid_minor), order.currency)} /{" "}
                {formatMoney(fromMinor(order.total_minor), order.currency)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {isComplete && order.master_voucher_code && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">Master voucher:</span>
              <span className="font-mono font-semibold tracking-wider text-primary break-all">
                {order.master_voucher_code}
              </span>
            </div>
          )}
        </div>

        <div className="divide-y divide-border">
          {order.lines.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              No participants on this order.
            </p>
          ) : (
            order.lines.map((line) => (
              <OrganisedLineRow key={line.id} order={order} line={line} />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OrganisedOrdersSection({
  orders,
}: {
  orders: DashboardOrganisedOrder[];
}) {
  return (
    <section>
      <SectionHeading
        icon={<Users className="h-4 w-4" />}
        title="Group orders you organised"
        count={orders.length}
      />
      {orders.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            You haven&rsquo;t organised any group orders yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => (
            <OrganisedOrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </section>
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
                  {v.kind === "voucher" && v.code && (
                    <DownloadVoucherButton code={v.code} />
                  )}
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
