import { useState } from "react";
import {
  useGetAdminOrdersDetailed,
  getGetAdminOrdersDetailedQueryKey,
  getGetAdminOverviewQueryKey,
  useRetryInstalment,
  useCancelOrder,
  type AdminOrder,
  type AdminInstalment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "./AdminShell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/format";
import { RotateCw, Ban, ChevronDown } from "lucide-react";

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
  if (s === "scheduled" || s === "pending" || s === "open" || s === "processing")
    return "bg-accent/10 text-accent-foreground border-accent/30";
  if (s === "failed" || s === "needs_action")
    return "bg-destructive/10 text-destructive border-destructive/20";
  if (s === "cancelled" || s === "expired")
    return "bg-muted text-muted-foreground border-border";
  return "bg-muted text-muted-foreground border-border";
}

type OrderRow = AdminOrder;
type Instalment = AdminInstalment;

function InstalmentRow({
  order,
  inst,
  onRetried,
}: {
  order: OrderRow;
  inst: Instalment;
  onRetried: () => void;
}) {
  const { toast } = useToast();
  const retry = useRetryInstalment();
  const retryable =
    (inst.status === "failed" || inst.status === "needs_action") &&
    order.status !== "cancelled";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="font-sans text-xs text-muted-foreground w-16">
          #{inst.number}
        </span>
        <span className="font-serif text-sm text-primary">
          {formatMoney(fromMinor(inst.amount_minor), inst.currency.toUpperCase())}
        </span>
        <span className="text-xs text-muted-foreground">
          due {formatDate(inst.due_at)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {inst.last_error ? (
          <span
            className="max-w-[180px] truncate text-xs text-destructive"
            title={inst.last_error}
          >
            {inst.last_error}
          </span>
        ) : null}
        <Badge variant="outline" className={statusTone(inst.status)}>
          {inst.status}
        </Badge>
        {retryable ? (
          <Button
            size="sm"
            variant="outline"
            disabled={retry.isPending}
            onClick={() => {
              retry.mutate(
                { orderId: order.id, instalmentId: inst.id },
                {
                  onSuccess: (res) => {
                    toast({
                      title:
                        res.status === "paid"
                          ? "Instalment charged"
                          : res.status === "needs_action"
                            ? "Customer action needed"
                            : res.status === "failed"
                              ? "Charge failed"
                              : "Charge submitted",
                      description: res.message ?? undefined,
                      variant:
                        res.status === "failed" ? "destructive" : "default",
                    });
                    onRetried();
                  },
                  onError: () => {
                    toast({
                      title: "Could not retry",
                      description: "Please try again.",
                      variant: "destructive",
                    });
                  },
                },
              );
            }}
          >
            <RotateCw className="mr-1 h-3.5 w-3.5" />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function OrderCard({ order, onChanged }: { order: OrderRow; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { toast } = useToast();
  const cancel = useCancelOrder();
  const cancellable = order.status !== "cancelled" && order.status !== "expired";

  return (
    <Card className="border-border/70">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-lg text-primary">
                {order.product_name}
              </h3>
              <Badge variant="outline" className={statusTone(order.status)}>
                {order.status}
              </Badge>
              {order.order_number ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {order.order_number}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {order.buyer_name} · {order.buyer_email}
            </p>
            <p className="text-xs text-muted-foreground">
              Placed {formatDate(order.created_at)}
              {order.voucher ? (
                <>
                  {" "}
                  · Voucher{" "}
                  <span className="font-mono text-primary">
                    {order.voucher.code}
                  </span>{" "}
                  ({order.voucher.status})
                </>
              ) : null}
            </p>
          </div>
          <div className="text-right space-y-1">
            <p className="font-serif text-xl text-primary">
              {formatMoney(
                fromMinor(order.total_minor),
                order.currency.toUpperCase(),
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {order.paid_instalments}/{order.installments} paid
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground"
          >
            <ChevronDown
              className={`mr-1 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
            {open ? "Hide" : "Show"} instalments ({order.instalments.length + 1})
          </Button>
          {cancellable ? (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={cancel.isPending}
              onClick={() => setConfirmCancel(true)}
            >
              <Ban className="mr-1 h-3.5 w-3.5" />
              Cancel order
            </Button>
          ) : null}
        </div>

        {open ? (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="font-sans text-xs text-muted-foreground w-16">
                  #1 (first)
                </span>
                <span className="font-serif text-sm text-primary">
                  {formatMoney(
                    fromMinor(order.first_payment.amount_minor),
                    order.first_payment.currency.toUpperCase(),
                  )}
                </span>
              </div>
              <Badge
                variant="outline"
                className={statusTone(order.first_payment.status)}
              >
                {order.first_payment.status}
              </Badge>
            </div>
            {order.instalments.map((inst) => (
              <InstalmentRow
                key={inst.id}
                order={order}
                inst={inst}
                onRetried={onChanged}
              />
            ))}
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops every remaining instalment so no further charges are
              attempted. Payments already collected are not refunded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                cancel.mutate(
                  { orderId: order.id },
                  {
                    onSuccess: (res) => {
                      toast({
                        title: "Order cancelled",
                        description: `${res.cancelled_instalments} instalment(s) stopped.`,
                      });
                      onChanged();
                    },
                    onError: () => {
                      toast({
                        title: "Could not cancel",
                        description: "Please try again.",
                        variant: "destructive",
                      });
                    },
                  },
                );
              }}
            >
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function AdminOrders() {
  const { data, isLoading } = useGetAdminOrdersDetailed();
  const queryClient = useQueryClient();

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getGetAdminOrdersDetailedQueryKey(),
    });
    queryClient.invalidateQueries({
      queryKey: getGetAdminOverviewQueryKey(),
    });
  };

  return (
    <AdminShell
      title="Orders & Payments"
      subtitle="Retry failed instalments or cancel an order to stop future charges. No refunds are issued here."
    >
      {isLoading || !data ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : data.orders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center text-muted-foreground">
            No orders yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.orders.map((order) => (
            <OrderCard key={order.id} order={order} onChanged={refresh} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
