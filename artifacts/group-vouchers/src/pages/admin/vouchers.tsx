import { useState } from "react";
import {
  useIssueVoucher,
  useRedeemVoucher,
  lookupVoucher,
  getGetAdminOverviewQueryKey,
  type VoucherLookup,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/format";
import {
  TicketPlus,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
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

const REASON_LABEL: Record<string, string> = {
  not_found: "No voucher with that code",
  expired: "This voucher has expired",
  already_redeemed: "This voucher was already redeemed",
  not_active: "This voucher is not active",
};

function VoucherDetails({ v }: { v: NonNullable<VoucherLookup["voucher"]> }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
      <span className="text-muted-foreground">Value</span>
      <span className="font-serif text-primary">
        {formatMoney(fromMinor(v.value_minor), v.currency.toUpperCase())}
      </span>
      <span className="text-muted-foreground">Status</span>
      <span className="capitalize">{v.status}</span>
      <span className="text-muted-foreground">Expires</span>
      <span>{formatDate(v.expires_at)}</span>
      <span className="text-muted-foreground">Issued</span>
      <span>{formatDate(v.created_at)}</span>
      {v.redeemed_at ? (
        <>
          <span className="text-muted-foreground">Redeemed</span>
          <span>{formatDate(v.redeemed_at)}</span>
        </>
      ) : null}
      <span className="text-muted-foreground">Origin</span>
      <span>{v.order_id ? "Order purchase" : "Manually issued"}</span>
    </div>
  );
}

function IssueVoucherCard() {
  const { toast } = useToast();
  const issue = useIssueVoucher();
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("scr");
  const [expires, setExpires] = useState("");
  const [issued, setIssued] = useState<VoucherLookup["voucher"] | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const major = Number(value);
    if (!Number.isFinite(major) || major <= 0) {
      toast({ title: "Enter a valid value", variant: "destructive" });
      return;
    }
    if (!expires) {
      toast({ title: "Choose an expiry date", variant: "destructive" });
      return;
    }
    issue.mutate(
      {
        data: {
          value_minor: Math.round(major * 100),
          currency,
          expires_at: new Date(expires).toISOString(),
        },
      },
      {
        onSuccess: (v) => {
          setIssued(v);
          setValue("");
          setExpires("");
          toast({
            title: "Voucher issued",
            description: `Code ${v.code}`,
          });
        },
        onError: () =>
          toast({ title: "Could not issue voucher", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-primary">
          <TicketPlus className="h-5 w-5" />
          Issue a voucher
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="value">Value</Label>
              <Input
                id="value"
                inputMode="decimal"
                placeholder="1000"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scr">SCR</SelectItem>
                  <SelectItem value="eur">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expires">Expires</Label>
              <Input
                id="expires"
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit" disabled={issue.isPending}>
            {issue.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <TicketPlus className="mr-2 h-4 w-4" />
            )}
            Issue voucher
          </Button>
        </form>

        {issued ? (
          <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              New voucher code
            </p>
            <p className="mt-1 font-mono text-lg text-primary">{issued.code}</p>
            <div className="mt-3">
              <VoucherDetails v={issued} />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function VerdictBanner({ result }: { result: VoucherLookup }) {
  if (!result.found) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-destructive">
        <XCircle className="h-5 w-5" />
        <span className="text-sm font-medium">No voucher with that code.</span>
      </div>
    );
  }
  if (result.valid) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-primary">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-sm font-medium">
          Valid — this voucher can be redeemed.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-destructive">
      <XCircle className="h-5 w-5" />
      <span className="text-sm font-medium">
        {(result.reason && REASON_LABEL[result.reason]) ?? "Not valid for redemption."}
      </span>
    </div>
  );
}

function LookupRedeemCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const redeem = useRedeemVoucher();
  const [code, setCode] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<VoucherLookup | null>(null);

  const doLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setSearching(true);
    setResult(null);
    try {
      const res = await lookupVoucher(trimmed);
      setResult(res);
    } catch {
      toast({ title: "Lookup failed", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const doRedeem = () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    redeem.mutate(
      { code: trimmed },
      {
        onSuccess: (res) => {
          setResult(res);
          toast({
            title: "Voucher redeemed",
            description: "Marked as used.",
          });
          queryClient.invalidateQueries({
            queryKey: getGetAdminOverviewQueryKey(),
          });
        },
        onError: (err) => {
          // 409/404 carry a VoucherLookup body explaining why.
          const body = (err as { data?: VoucherLookup })?.data;
          if (body && typeof body.found === "boolean") {
            setResult(body);
          }
          toast({
            title: "Could not redeem",
            description:
              body?.reason && REASON_LABEL[body.reason]
                ? REASON_LABEL[body.reason]
                : "This voucher can't be redeemed.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-primary">
          <Search className="h-5 w-5" />
          Look up & redeem
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={doLookup} className="flex gap-2">
          <Input
            placeholder="SB50-XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setResult(null);
            }}
            className="font-mono"
          />
          <Button type="submit" variant="outline" disabled={searching}>
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>

        {result ? (
          <div className="space-y-4">
            <VerdictBanner result={result} />
            {result.voucher ? (
              <div className="rounded-lg border border-border/60 p-4">
                <p className="mb-3 font-mono text-sm text-primary">
                  {result.voucher.code}
                </p>
                <VoucherDetails v={result.voucher} />
              </div>
            ) : null}
            {result.valid ? (
              <Button onClick={doRedeem} disabled={redeem.isPending}>
                {redeem.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Redeem voucher
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AdminVouchers() {
  return (
    <AdminShell
      title="Vouchers"
      subtitle="Issue new vouchers, look up a code to check its validity, and redeem valid vouchers."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <IssueVoucherCard />
        <LookupRedeemCard />
      </div>
    </AdminShell>
  );
}
