import { useState } from "react";
import { Link } from "wouter";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import {
  useGetStorefrontConfig,
  useCreateStoreOrder,
  useConfirmStoreOrder,
} from "@workspace/api-client-react";
import type {
  StorefrontConfig,
  StorefrontCatalogItem,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
  CreditCard,
  CalendarClock,
  Lock,
  ArrowLeft,
  Users,
  Gift,
  Minus,
  Plus,
} from "lucide-react";

type Selection =
  | { kind: "package"; item: StorefrontCatalogItem }
  | { kind: "gift"; amount: number };

function money(symbol: string, value: number) {
  return `${symbol}${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

const stripePromiseCache = new Map<string, Promise<Stripe | null>>();
function getStripe(publishableKey: string): Promise<Stripe | null> {
  let p = stripePromiseCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromiseCache.set(publishableKey, p);
  }
  return p;
}

export default function Home() {
  const { data: config, isLoading } = useGetStorefrontConfig();

  if (isLoading || !config) {
    return (
      <Layout>
        <div className="container max-w-5xl mx-auto px-6 py-16 space-y-8">
          <Skeleton className="h-10 w-2/3 mx-auto" />
          <div className="grid sm:grid-cols-2 gap-5">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      </Layout>
    );
  }

  return <Storefront config={config} />;
}

function Storefront({ config }: { config: StorefrontConfig }) {
  const { toast } = useToast();
  const symbol = config.symbol || config.currency.toUpperCase() + " ";

  const [selection, setSelection] = useState<Selection | null>(null);
  const [nights, setNights] = useState(1);
  const [giftAmount, setGiftAmount] = useState<string>("");
  const [plan, setPlan] = useState<"full" | "instalments">("full");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [checkout, setCheckout] = useState<{
    orderId: string;
    clientSecret: string;
  } | null>(null);

  const createOrder = useCreateStoreOrder();

  const total = selection
    ? selection.kind === "package"
      ? selection.item.rate * nights
      : selection.amount
    : 0;
  const perInstalment =
    Math.round((total / config.instalments) * 100) / 100;

  const startCheckout = () => {
    if (!selection) {
      toast({ title: "Choose a voucher first", variant: "destructive" });
      return;
    }
    if (!name.trim() || !email.includes("@")) {
      toast({
        title: "Enter your name and a valid email",
        variant: "destructive",
      });
      return;
    }
    createOrder.mutate(
      {
        data: {
          type: selection.kind,
          product_id:
            selection.kind === "package" ? selection.item.id : undefined,
          amount: selection.kind === "gift" ? selection.amount : undefined,
          nights: selection.kind === "package" ? nights : undefined,
          plan: plan === "instalments" ? String(config.instalments) : undefined,
          name,
          email,
        },
      },
      {
        onSuccess: (data) =>
          setCheckout({
            orderId: data.order_id,
            clientSecret: data.client_secret,
          }),
        onError: (err) =>
          toast({
            title: "Could not start checkout",
            description:
              (err as { error?: string })?.error ??
              "Please try again in a moment.",
            variant: "destructive",
          }),
      },
    );
  };

  if (checkout && config.publishable_key) {
    return (
      <Layout>
        <Elements
          stripe={getStripe(config.publishable_key)}
          options={{ clientSecret: checkout.clientSecret }}
        >
          <CheckoutView
            orderId={checkout.orderId}
            total={total}
            symbol={symbol}
            plan={plan}
            perInstalment={perInstalment}
            instalments={config.instalments}
            onBack={() => setCheckout(null)}
          />
        </Elements>
      </Layout>
    );
  }

  return (
    <Layout>
      <header className="text-center px-6 pt-12 pb-8 border-b-2 border-accent max-w-3xl mx-auto">
        <div className="font-sans text-xs font-bold uppercase tracking-[0.32em] text-primary">
          The Seaboards Apartments &middot; Anse La Mouche &middot; Mah&eacute;
        </div>
        <div className="mt-4 font-sans text-xs font-bold uppercase tracking-[0.4em] text-accent">
          50 Years of Freedom
        </div>
        <h1 className="font-serif text-primary text-4xl md:text-5xl mt-2 mb-1">
          Jubilee Voucher Collection
        </h1>
        <p className="font-serif italic text-muted-foreground m-0">
          Reserve your island stay &middot; pay in full or spread it over{" "}
          {config.instalments} months
        </p>
      </header>

      <div className="container max-w-5xl mx-auto px-6 pt-10 pb-24">
        {!config.payments_enabled && (
          <div className="mb-8 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm text-muted-foreground">
            <strong className="text-primary">Preview mode.</strong> Online
            payments aren&rsquo;t connected yet, so checkout is disabled. Connect
            Stripe to start taking orders.
          </div>
        )}

        <h2 className="font-serif text-primary text-2xl mb-5">Choose a stay</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          {config.catalog.map((item) => {
            const active =
              selection?.kind === "package" && selection.item.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelection({ kind: "package", item });
                  setNights((n) => Math.max(n, item.minNights));
                }}
                className={`text-left rounded-xl border-2 p-5 transition-all flex flex-col ${
                  active
                    ? "border-primary bg-primary/5 shadow-md"
                    : "border-border hover:border-primary/40"
                } ${item.featured ? "ring-1 ring-accent/40" : ""}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-block rounded-full bg-secondary text-secondary-foreground font-bold text-[11px] px-2.5 py-0.5 uppercase tracking-wide">
                    {item.ribbon}
                  </span>
                  {active && <Check className="w-5 h-5 text-primary" />}
                </div>
                <div className="font-serif text-lg text-primary leading-snug">
                  {item.name}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-muted-foreground line-through text-sm">
                    {money(symbol, item.was)}
                  </span>
                  <span className="text-2xl font-extrabold text-primary">
                    {money(symbol, item.rate)}
                  </span>
                  <span className="text-sm text-muted-foreground">/ night</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">{item.desc}</p>
                <ul className="mt-3 space-y-1.5">
                  {item.feat.map((f) => (
                    <li
                      key={f}
                      className="relative pl-[20px] text-[13px] text-foreground/80"
                    >
                      <Check
                        className="absolute left-0 top-[3px] w-3 h-3 text-accent"
                        strokeWidth={3}
                      />
                      {f}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {selection?.kind === "package" && (
          <div className="mt-5 rounded-xl border-2 border-primary/30 bg-primary/5 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="font-serif text-lg text-primary">
                How many nights?
              </div>
              <p className="text-sm text-muted-foreground">
                {money(symbol, selection.item.rate)} / night &middot;{" "}
                {selection.item.name}
              </p>
            </div>
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  aria-label="Fewer nights"
                  disabled={nights <= selection.item.minNights}
                  onClick={() =>
                    setNights((n) =>
                      Math.max(selection.item.minNights, n - 1),
                    )
                  }
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span
                  className="w-10 text-center text-2xl font-extrabold text-primary tabular-nums"
                  aria-live="polite"
                >
                  {nights}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  aria-label="More nights"
                  onClick={() => setNights((n) => n + 1)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Total
                </div>
                <div className="text-2xl font-extrabold text-primary tabular-nums">
                  {money(symbol, total)}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 rounded-xl border-2 border-border p-5">
          <div className="flex items-center gap-2 mb-1">
            <Gift className="w-5 h-5 text-accent" />
            <h3 className="font-serif text-lg text-primary">
              {config.gift.name}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            An open-value voucher — choose an amount or enter your own (min{" "}
            {money(symbol, config.gift.min)}).
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            {config.gift.amounts.map((amt) => {
              const active =
                selection?.kind === "gift" && selection.amount === amt;
              return (
                <button
                  key={amt}
                  type="button"
                  onClick={() => {
                    setGiftAmount("");
                    setSelection({ kind: "gift", amount: amt });
                  }}
                  className={`rounded-lg border-2 px-4 py-2 font-semibold transition-all ${
                    active
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  {money(symbol, amt)}
                </button>
              );
            })}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">or</span>
              <Input
                type="number"
                min={config.gift.min}
                placeholder="Custom"
                value={giftAmount}
                onChange={(e) => {
                  setGiftAmount(e.target.value);
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= config.gift.min) {
                    setSelection({ kind: "gift", amount: v });
                  }
                }}
                className="w-28"
              />
            </div>
          </div>
        </div>

        <h2 className="font-serif text-primary text-2xl mt-10 mb-4">
          How would you like to pay?
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setPlan("full")}
            className={`text-left rounded-xl border-2 p-5 transition-all ${
              plan === "full"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-primary">
              <CreditCard className="w-5 h-5" /> Pay in full
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Settle the whole amount today
              {total > 0 ? ` — ${money(symbol, total)}.` : "."}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setPlan("instalments")}
            className={`text-left rounded-xl border-2 p-5 transition-all ${
              plan === "instalments"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-primary">
              <CalendarClock className="w-5 h-5" /> Pay in {config.instalments}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {total > 0
                ? `${money(symbol, perInstalment)} today, then the rest every ${config.interval_days} days.`
                : `Split across ${config.instalments} monthly payments.`}
            </p>
          </button>
        </div>

        <div className="mt-8 grid sm:grid-cols-2 gap-4 max-w-2xl">
          <div className="space-y-2">
            <Label htmlFor="buyer_name">Your name</Label>
            <Input
              id="buyer_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="buyer_email">Email address</Label>
            <Input
              id="buyer_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4">
          <Button
            size="lg"
            className="h-14 text-lg"
            disabled={
              !config.payments_enabled ||
              !selection ||
              createOrder.isPending
            }
            onClick={startCheckout}
          >
            {createOrder.isPending ? (
              "Preparing checkout…"
            ) : (
              <>
                <Lock className="w-5 h-5 mr-2" />
                {plan === "instalments" && total > 0
                  ? `Pay ${money(symbol, perInstalment)} now`
                  : total > 0
                    ? `Pay ${money(symbol, total)}`
                    : "Continue to payment"}
              </>
            )}
          </Button>
          {plan === "instalments" && total > 0 && (
            <p className="text-sm text-muted-foreground">
              Then {config.instalments - 1} more payments of{" "}
              {money(symbol, perInstalment)}. Your card is saved securely for the
              remaining instalments.
            </p>
          )}
        </div>

        <div className="mt-12 rounded-xl border border-border bg-muted/30 p-5 flex items-start gap-3">
          <Users className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-primary">Buying for a group?</p>
            <p className="text-sm text-muted-foreground">
              Set up a group order and send everyone their own payment link.{" "}
              <Link
                href="/group-order"
                className="text-primary underline underline-offset-2"
              >
                Create a group order
              </Link>
              .
            </p>
          </div>
        </div>

        <p className="text-[12.5px] text-muted-foreground mt-6">
          Offer open 29 June &ndash; 30 September 2026, while allocation lasts.
          Blackout dates apply. Full{" "}
          <Link
            href="/terms"
            className="text-primary underline underline-offset-2"
          >
            Terms &amp; Conditions
          </Link>
          .
        </p>
      </div>
    </Layout>
  );
}

function CheckoutView({
  orderId,
  total,
  symbol,
  plan,
  perInstalment,
  instalments,
  onBack,
}: {
  orderId: string;
  total: number;
  symbol: string;
  plan: "full" | "instalments";
  perInstalment: number;
  instalments: number;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const confirmOrder = useConfirmStoreOrder();

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    status: string;
    voucher: { code: string; status: string } | null | undefined;
  } | null>(null);

  const dueNow = plan === "instalments" ? perInstalment : total;

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (error) {
      toast({
        title: "Payment could not be completed",
        description: error.message ?? "Please check your card details.",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }
    confirmOrder.mutate(
      { orderId },
      {
        onSuccess: (data) => {
          setResult({ status: data.status, voucher: data.voucher });
          setSubmitting(false);
        },
        onError: () => {
          toast({
            title: "Payment received, finalising…",
            description: "Your voucher will arrive by email shortly.",
          });
          setSubmitting(false);
        },
      },
    );
  };

  if (result) {
    return (
      <div className="container max-w-md mx-auto px-6 py-20 text-center animate-in zoom-in-95 duration-500">
        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Check className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-serif text-foreground mb-3">Thank you!</h1>
        <p className="text-muted-foreground mb-8">
          {plan === "instalments"
            ? "Your first payment is in. We'll charge the remaining instalments automatically."
            : "Your payment is complete."}
        </p>
        {result.voucher ? (
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground mb-3">
              Your voucher code
            </p>
            <div className="text-2xl font-mono tracking-widest font-bold bg-muted/50 py-3 rounded-lg">
              {result.voucher.code}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your voucher activates once your plan is fully paid — we&rsquo;ll
            email it to you.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="container max-w-md mx-auto px-6 py-12">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-6"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>
      <Card className="shadow-xl border-border/50 overflow-hidden">
        <div className="bg-primary/5 p-6 border-b border-border/50 text-center">
          <p className="text-sm text-muted-foreground mb-2">Due today</p>
          <div className="text-4xl font-mono font-bold tracking-tight text-foreground">
            {money(symbol, dueNow)}
          </div>
          {plan === "instalments" && (
            <p className="text-xs text-muted-foreground mt-2">
              then {instalments - 1} × {money(symbol, perInstalment)}
            </p>
          )}
        </div>
        <CardContent className="p-6 space-y-6">
          <PaymentElement />
          <Button
            size="lg"
            className="w-full h-14 text-lg"
            disabled={!stripe || submitting}
            onClick={handlePay}
          >
            {submitting ? (
              "Processing…"
            ) : (
              <>
                <Lock className="w-5 h-5 mr-2" /> Pay {money(symbol, dueNow)}
              </>
            )}
          </Button>
          <div className="bg-muted/50 rounded-lg p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              Payments are processed securely by Stripe. Your card details are
              never stored on our servers.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
