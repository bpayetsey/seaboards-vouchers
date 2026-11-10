import { useMemo, useState } from "react";
import {
  useCreateCashBooking,
  useGetStorefrontConfig,
  useGetDayPassAvailability,
  getGetDayPassAvailabilityQueryKey,
  getGetAdminOrdersDetailedQueryKey,
  getGetAdminOverviewQueryKey,
  type CashBookingResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/format";
import { Banknote, Loader2, Download, CheckCircle2 } from "lucide-react";

function errorMessage(err: unknown): string {
  const e = err as { data?: { error?: string }; message?: string };
  return e?.data?.error ?? e?.message ?? "Could not record the booking.";
}

export default function AdminCashBooking() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const config = useGetStorefrontConfig();
  const create = useCreateCashBooking();

  const [productId, setProductId] = useState("");
  const [adults, setAdults] = useState("1");
  const [children, setChildren] = useState("0");
  const [visitDate, setVisitDate] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [customTotal, setCustomTotal] = useState("");
  const [done, setDone] = useState<CashBookingResult | null>(null);

  const passes = config.data?.day_passes ?? [];
  const pass = passes.find((p) => p.id === productId);
  const currency = (config.data?.currency ?? "scr").toUpperCase();
  const datable = productId === "day-pass-bnl" || productId === "day-pass-pool";

  const adultCount = pass?.pricing === "flat" ? (pass.includedAdults ?? 1) : Number(adults) || 0;
  const childCount = Number(children) || 0;
  const pax = adultCount + childCount;

  const catalogTotal = useMemo(() => {
    if (!pass) return 0;
    const base = pass.pricing === "flat" ? pass.rate : pass.rate * adultCount;
    return base + childCount * pass.childRate;
  }, [pass, adultCount, childCount]);
  const customMajor = customTotal.trim() === "" ? null : Number(customTotal);
  const total = customMajor != null && Number.isFinite(customMajor) && customMajor > 0 ? customMajor : catalogTotal;

  const availParams = { from: visitDate || "2000-01-01", to: visitDate || "2000-01-01", pax: Math.max(pax, 1) };
  const availability = useGetDayPassAvailability(availParams, {
    query: {
      enabled: datable && !!visitDate,
      queryKey: getGetDayPassAvailabilityQueryKey(availParams),
    },
  });
  const day = availability.data?.days?.[0];

  const reset = () => {
    setProductId(""); setAdults("1"); setChildren("0"); setVisitDate("");
    setName(""); setEmail(""); setPhone(""); setCustomTotal(""); setDone(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass) { toast({ title: "Choose a pass", variant: "destructive" }); return; }
    if (!name.trim()) { toast({ title: "Enter the guest's name", variant: "destructive" }); return; }
    if (datable && !visitDate) { toast({ title: "Choose the visit date", variant: "destructive" }); return; }
    if (customTotal.trim() !== "" && !(customMajor && customMajor > 0)) {
      toast({ title: "Enter a valid custom total", variant: "destructive" });
      return;
    }
    create.mutate(
      {
        data: {
          product_id: pass.id,
          adults: pass.pricing === "flat" ? undefined : Number(adults),
          children: childCount,
          visit_date: datable ? visitDate : undefined,
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          total_minor: customMajor && customMajor > 0 ? Math.round(customMajor * 100) : undefined,
        },
      },
      {
        onSuccess: (res) => {
          setDone(res);
          queryClient.invalidateQueries({ queryKey: getGetAdminOrdersDetailedQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["/api/storefront/day-pass/availability"] });
          toast({ title: "Cash booking recorded", description: res.voucher_code });
        },
        onError: (err) =>
          toast({ title: "Could not record booking", description: errorMessage(err), variant: "destructive" }),
      },
    );
  };

  return (
    <AdminShell
      title="Record Cash Booking"
      subtitle="For day passes paid in cash at the desk. Holds the calendar places, marks the order as cash and issues the voucher."
    >
      {done ? (
        <Card className="border-primary/30">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="h-5 w-5" />
              <h3 className="font-serif text-xl">Booking recorded</h3>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:max-w-md">
              <span className="text-muted-foreground">Voucher code</span>
              <span className="font-mono text-primary">{done.voucher_code}</span>
              <span className="text-muted-foreground">Order</span>
              <span className="font-mono">{done.order_number ?? "—"}</span>
              <span className="text-muted-foreground">Pass</span>
              <span>{done.product_name}</span>
              <span className="text-muted-foreground">Visit date</span>
              <span>{done.visit_date ?? "Undated"}</span>
              <span className="text-muted-foreground">Guests</span>
              <span>{done.pax}</span>
              <span className="text-muted-foreground">Cash received</span>
              <span className="font-serif text-primary">
                {formatMoney(done.total_minor / 100, done.currency.toUpperCase())}
              </span>
              <span className="text-muted-foreground">Emailed</span>
              <span>{done.emailed ? "Yes, PDF sent to guest" : "No email sent"}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href={`/api/vouchers/${encodeURIComponent(done.voucher_code)}/pdf`} target="_blank" rel="noreferrer">
                  <Download className="mr-2 h-4 w-4" />
                  Download voucher PDF
                </a>
              </Button>
              <Button variant="outline" onClick={reset}>Record another</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-serif text-primary">
              <Banknote className="h-5 w-5" />
              New cash booking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pass">Day pass</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger id="pass"><SelectValue placeholder="Choose a pass" /></SelectTrigger>
                    <SelectContent>
                      {passes.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} — {formatMoney(p.rate, currency)} / {p.unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {pass && pass.pricing !== "flat" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="adults">Adults</Label>
                    <Input id="adults" type="number" min={1} max={pass.maxGuests} value={adults} onChange={(e) => setAdults(e.target.value)} />
                  </div>
                ) : null}
                {pass ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="children">Children ({pass.childAges}) @ {formatMoney(pass.childRate, currency)}</Label>
                    <Input id="children" type="number" min={0} max={pass.maxChildren ?? pass.maxGuests} value={children} onChange={(e) => setChildren(e.target.value)} />
                  </div>
                ) : null}
                {datable ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="date">Visit date</Label>
                    <Input id="date" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
                    {visitDate && day ? (
                      <p className={`text-xs ${day.bookable ? "text-muted-foreground" : "text-destructive"}`}>
                        {day.closed
                          ? "Closed (Tuesday or past date)"
                          : day.blocked
                            ? `Blocked${day.blocked_reason ? `: ${day.blocked_reason}` : ""}`
                            : `${day.remaining} of ${day.capacity} places left${day.bookable ? "" : ` — not enough for ${pax} guests`}`}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Guest name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email (optional)</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Sends the voucher PDF" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="custom">Custom total ({currency}, optional)</Label>
                  <Input id="custom" inputMode="decimal" value={customTotal} onChange={(e) => setCustomTotal(e.target.value)} placeholder={pass ? String(catalogTotal) : ""} />
                  <p className="text-xs text-muted-foreground">Leave blank to use the standard price.</p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Cash to collect</Label>
                  <p className="font-serif text-3xl text-primary">{pass ? formatMoney(total, currency) : "—"}</p>
                  {pass ? <p className="text-xs text-muted-foreground">{adultCount} adult{adultCount === 1 ? "" : "s"} + {childCount} child{childCount === 1 ? "" : "ren"} = {pax} guest{pax === 1 ? "" : "s"}</p> : null}
                </div>
              </div>

              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
                Record cash booking
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </AdminShell>
  );
}
