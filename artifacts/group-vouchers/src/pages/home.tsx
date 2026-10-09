import { useEffect, useMemo, useState } from "react";
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
  useGetRates,
  useCreateGroupOrder,
  useGetStorefrontGallery,
  useGetDayPassAvailability,
  useGetDashboard,
  getGetDayPassAvailabilityQueryKey,
  getGetDashboardQueryKey,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import type {
  StorefrontConfig,
  StorefrontCatalogItem,
  StorefrontDayPass,
  GroupOrderCreated,
  SplitConfigApartmentType,
  DayAvailability,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DayPassCalendar,
  DayPassPolicy,
} from "@/components/day-pass-date-picker";
import { useToast } from "@/hooks/use-toast";
import {
  downloadVoucherPdf,
  publicVoucherPdfUrl,
  voucherPdfFilename,
} from "@/lib/voucherPdf";
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
  Copy,
  Trash2,
  Link as LinkIcon,
  Sparkles,
  Wifi,
  UtensilsCrossed,
  Waves,
  Car,
  Download,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Selection =
  | { kind: "package"; item: StorefrontCatalogItem }
  | { kind: "gift"; amount: number }
  | { kind: "day_pass"; option: StorefrontDayPass };

function money(symbol: string, value: number) {
  return `${symbol}${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenISO(fromIso: string, toIso: string) {
  const from = new Date(fromIso + "T00:00:00").getTime();
  const to = new Date(toIso + "T00:00:00").getTime();
  return Math.round((to - from) / 86_400_000);
}

function formatVisitDay(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Fallback property photos, used until staff upload their own from the admin
// dashboard (Gallery). Stored in `public/gallery/`.
const galleryBase = import.meta.env.BASE_URL.replace(/\/$/, "");
const FALLBACK_GALLERY: { src: string; alt: string }[] = [
  { src: `${galleryBase}/gallery/01-exterior.jpg`, alt: "The Seaboards apartments exterior with palm trees and ocean view" },
  { src: `${galleryBase}/gallery/02-beach.jpg`, alt: "Pristine white-sand beach and turquoise water at Anse La Mouche" },
  { src: `${galleryBase}/gallery/03-bedroom.jpg`, alt: "Bright apartment bedroom with ocean view" },
  { src: `${galleryBase}/gallery/04-pool.jpg`, alt: "Resort swimming pool overlooking the ocean" },
  { src: `${galleryBase}/gallery/05-dining.jpg`, alt: "Half-board dining with a sunset terrace view" },
  { src: `${galleryBase}/gallery/06-aerial.jpg`, alt: "Aerial view of Anse La Mouche bay in Mahe, Seychelles" },
];

function PhotoGallery() {
  const { data } = useGetStorefrontGallery();
  const photos =
    data && data.length > 0
      ? data.map((img) => ({ src: img.url, alt: img.alt }))
      : FALLBACK_GALLERY;

  return (
    <section className="mt-12" aria-labelledby="gallery-heading">
      <h2
        id="gallery-heading"
        className="font-serif text-primary text-2xl mb-1"
      >
        A glimpse of The Seaboards
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        Anse La Mouche, Mahe
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        {photos.map((photo) => (
          <div
            key={photo.src}
            className="overflow-hidden rounded-xl border border-border bg-muted"
          >
            <img
              src={photo.src}
              alt={photo.alt}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition-transform duration-500 hover:scale-105"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section className="mt-10" aria-labelledby="about-heading">
      <h2
        id="about-heading"
        className="font-serif text-primary text-2xl mb-1"
      >
        About The Seaboards
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        A boutique apartment haven in the southern region of Mahe.
      </p>
      <p className="text-[15px] leading-relaxed text-foreground/80">
        Tucked into the verdant tropical vegetation of southern Mahe, The
        Seaboards is a tranquil boutique retreat with great mountain views.
        Unwind by the swimming pool, stretch out on the day beds, and dine at
        the in-house restaurant &amp; bar.
      </p>
    </section>
  );
}

const AMENITIES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Sparkles,
    title: "Housekeeping",
    desc: "Daily service keeps your apartment fresh.",
  },
  {
    icon: Wifi,
    title: "Wifi & internet",
    desc: "Stay connected throughout the property.",
  },
  {
    icon: UtensilsCrossed,
    title: "In-house dining",
    desc: "Restaurant & bar serving Western, Creole & Japanese (sushi) cuisine with fresh, local, organic ingredients.",
  },
  {
    icon: Waves,
    title: "Swimming pool",
    desc: "A pool and day beds for slow island afternoons.",
  },
  {
    icon: Car,
    title: "Car rental",
    desc: "Explore Mahe at your own pace.",
  },
];

function AmenitiesSection() {
  return (
    <section className="mt-12" aria-labelledby="amenities-heading">
      <h2
        id="amenities-heading"
        className="font-serif text-primary text-2xl mb-1"
      >
        Amenities &amp; Services
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        Everything you need for an effortless island stay.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {AMENITIES.map((a) => {
          const Icon = a.icon;
          return (
            <div
              key={a.title}
              className="rounded-xl border border-border p-4 flex items-start gap-3"
            >
              <span className="shrink-0 rounded-lg bg-accent/10 p-2 text-accent">
                <Icon className="w-5 h-5" />
              </span>
              <div>
                <div className="font-semibold text-primary text-[15px]">
                  {a.title}
                </div>
                <p className="text-[13px] text-muted-foreground mt-0.5">
                  {a.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
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
  const [dayAdults, setDayAdults] = useState(1);
  const [dayChildren, setDayChildren] = useState(0);
  const [dayExtension, setDayExtension] = useState(false);
  const [visitDate, setVisitDate] = useState("");
  const [giftLater, setGiftLater] = useState(false);
  const [applyCredit, setApplyCredit] = useState(false);
  const [giftAmount, setGiftAmount] = useState<string>("");
  const [plan, setPlan] = useState<"full" | "instalments" | "split">("full");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [checkout, setCheckout] = useState<{
    orderId: string;
    clientSecret: string;
  } | null>(null);

  const createOrder = useCreateStoreOrder();
  const { isSignedIn } = useUser();

  const datablePass =
    selection?.kind === "day_pass" &&
    selection.option.pricing === "per_person"
      ? selection.option
      : null;
  const dayPax = dayAdults + dayChildren;

  const availFrom = todayISODate();
  const availTo = addDaysISO(availFrom, 60);
  const availParams = { from: availFrom, to: availTo, pax: dayPax };
  const availability = useGetDayPassAvailability(availParams, {
    query: {
      enabled: Boolean(datablePass),
      queryKey: getGetDayPassAvailabilityQueryKey(availParams),
    },
  });
  const availByDate = useMemo(() => {
    const map = new Map<string, DayAvailability>();
    for (const d of availability.data?.days ?? []) map.set(d.date, d);
    return map;
  }, [availability.data]);
  useEffect(() => {
    if (!visitDate || giftLater) return;
    if (!availability.isSuccess) return;
    const day = availByDate.get(visitDate);
    if (!day || !day.bookable) setVisitDate("");
  }, [availByDate, availability.isSuccess, visitDate, giftLater]);

  const dashboard = useGetDashboard({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getGetDashboardQueryKey(),
    },
  });
  const creditBalanceMinor =
    dashboard.data?.credit.find(
      (c) => c.currency.toLowerCase() === config.currency.toLowerCase(),
    )?.balance_minor ?? 0;

  const total = selection
    ? selection.kind === "package"
      ? selection.item.rate * nights
      : selection.kind === "gift"
        ? selection.amount
        : (selection.option.pricing === "per_person"
            ? selection.option.rate * dayAdults
            : selection.option.rate) +
          dayChildren * selection.option.childRate +
          (dayExtension && selection.option.extension
            ? selection.option.extension.price
            : 0)
    : 0;

  const creditAvailableMajor = creditBalanceMinor / 100;
  const creditAppliedMajor =
    applyCredit && isSignedIn
      ? Math.min(creditAvailableMajor, total)
      : 0;
  const cashDue = Math.max(0, Math.round((total - creditAppliedMajor) * 100) / 100);
  const perInstalment =
    Math.round((cashDue / config.instalments) * 100) / 100;

  // Dated day passes (Breakfast & Lunch / Pool & Lunch) already capture a
  // visit date above. When paying in instalments for one of these, the
  // schedule compresses to fit before the visit if it's sooner than the
  // standard instalment window — warn the buyer up front when that applies.
  const standardWindowDays = config.interval_days * (config.instalments - 1);
  const daysUntilVisit =
    datablePass && !giftLater && visitDate
      ? daysBetweenISO(todayISODate(), visitDate)
      : null;
  const visitSoonerThanPlan =
    plan === "instalments" &&
    daysUntilVisit !== null &&
    daysUntilVisit < standardWindowDays;

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
    if (!PHONE_RE.test(phone.trim())) {
      toast({
        title: "Enter your mobile number",
        description:
          "Include your country code, e.g. +248 2 510 000. We'll send your voucher confirmation on WhatsApp too.",
        variant: "destructive",
      });
      return;
    }
    if (datablePass && !giftLater && !visitDate) {
      toast({
        title: "Choose a visit date",
        description:
          "Pick the day you'd like to visit, or tick \u201cI'll choose the date later\u201d to buy it undated.",
        variant: "destructive",
      });
      return;
    }
    if (datablePass && !giftLater && visitDate) {
      const day = availByDate.get(visitDate);
      if (!day || !day.bookable) {
        setVisitDate("");
        toast({
          title: "That day isn't available",
          description:
            "The day you picked is no longer bookable for your group. Please choose another available date.",
          variant: "destructive",
        });
        return;
      }
    }
    createOrder.mutate(
      {
        data: {
          type: selection.kind,
          product_id:
            selection.kind === "package"
              ? selection.item.id
              : selection.kind === "day_pass"
                ? selection.option.id
                : undefined,
          amount: selection.kind === "gift" ? selection.amount : undefined,
          nights: selection.kind === "package" ? nights : undefined,
          adults:
            selection.kind === "day_pass" &&
            selection.option.pricing === "per_person"
              ? dayAdults
              : undefined,
          children: selection.kind === "day_pass" ? dayChildren : undefined,
          extension:
            selection.kind === "day_pass" ? dayExtension : undefined,
          visit_date:
            datablePass && !giftLater && visitDate ? visitDate : undefined,
          credit_minor:
            creditAppliedMajor > 0
              ? Math.round(creditAppliedMajor * 100)
              : undefined,
          plan: plan === "instalments" ? String(config.instalments) : undefined,
          name,
          email,
          phone: phone.trim(),
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
            plan={plan === "instalments" ? "instalments" : "full"}
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
          The Seaboards Apartments &middot; Anse La Mouche &middot; Mahe
        </div>
        <h1 className="font-serif text-primary text-4xl md:text-5xl mt-4 mb-1">
          Resident Rate &amp; Day Pass Booking
        </h1>
        <p className="font-serif italic text-muted-foreground m-0">
          Reserve your island stay &middot; pay in full or spread it over{" "}
          {config.instalments} months
        </p>
      </header>

      {config.promo_banner?.trim() && (
        <div className="max-w-3xl mx-auto px-6 pt-5 text-center text-sm text-muted-foreground">
          {config.promo_banner}{" "}
          <Link href="/terms" className="text-primary underline underline-offset-2 font-medium whitespace-nowrap">
            Full Terms &amp; Conditions
          </Link>
        </div>
      )}

      <div className="container max-w-5xl mx-auto px-6 pt-10 pb-24">
        {!config.payments_enabled && (
          <div className="mb-8 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm text-muted-foreground">
            <strong className="text-primary">Preview mode.</strong> Online
            payments aren&rsquo;t connected yet, so checkout is disabled. Connect
            Stripe to start taking orders.
          </div>
        )}

        <AboutSection />

        <h2 className="font-serif text-primary text-2xl mt-12 mb-5">Choose your voucher</h2>
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
                  {item.was > item.rate && (
                    <span className="text-muted-foreground line-through text-sm">
                      {money(symbol, item.was)}
                    </span>
                  )}
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

        <h2 className="font-serif text-primary text-2xl mt-12 mb-1">
          Day Passes
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Spend the day at The Seaboards — pool, dining and more. To keep it
          intimate, a maximum of 10 guests at a time. Children 2–10 yrs pay the
          per-pass child rate shown below (incl. a kids-menu meal); ages 11+ pay
          the adult rate.{" "}
          <Link
            href="/menu/day-pass"
            className="text-primary underline underline-offset-2 font-medium whitespace-nowrap"
          >
            See the Day Pass menu
          </Link>
          .
        </p>
        <div className="grid sm:grid-cols-3 gap-5">
          {config.day_passes.map((opt) => {
            const active =
              selection?.kind === "day_pass" && selection.option.id === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSelection({ kind: "day_pass", option: opt });
                  setDayAdults(opt.includedAdults ?? 1);
                  setDayChildren(0);
                  setDayExtension(false);
                }}
                className={`text-left rounded-xl border-2 p-5 transition-all flex flex-col ${
                  active
                    ? "border-primary bg-primary/5 shadow-md"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <CalendarClock className="w-3.5 h-3.5" />
                    {opt.hours}
                  </span>
                  {active && <Check className="w-5 h-5 text-primary" />}
                </div>
                <div className="font-serif text-lg text-primary leading-snug">
                  {opt.name}
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-2xl font-extrabold text-primary">
                    {money(symbol, opt.rate)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    / {opt.unit}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">{opt.desc}</p>
                <ul className="mt-3 space-y-1.5">
                  {opt.feat.map((f) => (
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

        {selection?.kind === "day_pass" && (
          <div className="mt-5 rounded-xl border-2 border-primary/30 bg-primary/5 p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="font-serif text-lg text-primary">
                    Who's coming?
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {selection.option.pricing === "per_person"
                      ? `${money(symbol, selection.option.rate)} per ${selection.option.unit} · max ${selection.option.maxGuests} guests`
                      : `Flat rate for ${selection.option.includedAdults ?? 2} adults · add up to ${selection.option.maxChildren ?? 0} children`}
                  </p>
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

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Adults
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selection.option.pricing === "per_person"
                        ? `${money(symbol, selection.option.rate)} each (ages 11+)`
                        : `${selection.option.includedAdults ?? 2} included`}
                    </div>
                  </div>
                  {selection.option.pricing === "per_person" ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 rounded-full"
                        aria-label="Fewer adults"
                        disabled={dayAdults <= 1}
                        onClick={() => setDayAdults((a) => Math.max(1, a - 1))}
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                      <span
                        className="w-8 text-center text-xl font-extrabold text-primary tabular-nums"
                        aria-live="polite"
                      >
                        {dayAdults}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 rounded-full"
                        aria-label="More adults"
                        disabled={
                          dayAdults + dayChildren >= selection.option.maxGuests
                        }
                        onClick={() => setDayAdults((a) => a + 1)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xl font-extrabold text-primary tabular-nums">
                      {selection.option.includedAdults ?? 2}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Children
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {money(symbol, selection.option.childRate)} each (
                      {selection.option.childAges})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-full"
                      aria-label="Fewer children"
                      disabled={dayChildren <= 0}
                      onClick={() => setDayChildren((c) => Math.max(0, c - 1))}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span
                      className="w-8 text-center text-xl font-extrabold text-primary tabular-nums"
                      aria-live="polite"
                    >
                      {dayChildren}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-full"
                      aria-label="More children"
                      disabled={
                        (selection.option.maxChildren != null &&
                          dayChildren >= selection.option.maxChildren) ||
                        (selection.option.pricing === "per_person"
                          ? dayAdults
                          : (selection.option.includedAdults ?? 2)) +
                          dayChildren >=
                          selection.option.maxGuests
                      }
                      onClick={() => setDayChildren((c) => c + 1)}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {selection.option.extension && (
              <label className="flex items-center gap-3 rounded-lg border border-border bg-background/60 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={dayExtension}
                  onChange={(e) => setDayExtension(e.target.checked)}
                />
                <span className="text-sm text-foreground/80">
                  {selection.option.extension.label}
                  <span className="text-muted-foreground">
                    {" "}
                    (+{money(symbol, selection.option.extension.price)})
                  </span>
                </span>
              </label>
            )}

            {datablePass && (
              <div className="rounded-lg border border-border bg-background/60 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-primary" />
                  <div className="text-sm font-medium text-foreground">
                    Choose your visit date
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                  <div className="space-y-3">
                    <DayPassCalendar
                      availability={availByDate}
                      selected={giftLater ? "" : visitDate}
                      onSelect={setVisitDate}
                      from={availFrom}
                      to={availTo}
                      disabled={giftLater}
                      isLoading={availability.isLoading}
                    />
                    {visitDate && !giftLater ? (
                      <p className="text-xs font-medium text-primary">
                        {formatVisitDay(visitDate)}
                        {(() => {
                          const day = availByDate.get(visitDate);
                          return day && day.bookable
                            ? ` · ${day.remaining} place${
                                day.remaining === 1 ? "" : "s"
                              } left`
                            : "";
                        })()}
                      </p>
                    ) : null}
                    {visitSoonerThanPlan && (
                      <p className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm text-muted-foreground">
                        <strong className="text-primary">Heads up.</strong>{" "}
                        Your visit date is less than{" "}
                        {Math.round(standardWindowDays / 30)} months away, so
                        the standard {config.instalments}-payment schedule
                        wouldn't finish in time. We'll space your{" "}
                        {config.instalments} payments evenly so the last one
                        clears before your visit.
                      </p>
                    )}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={giftLater}
                        onChange={(e) => {
                          setGiftLater(e.target.checked);
                          if (e.target.checked) setVisitDate("");
                        }}
                      />
                      <span className="text-sm text-foreground/80">
                        It&rsquo;s a gift / I&rsquo;ll choose the date later
                        <span className="text-muted-foreground">
                          {" "}
                          — book your day anytime from your account.
                        </span>
                      </span>
                    </label>
                  </div>
                  <DayPassPolicy />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 rounded-xl border-2 border-border p-5">
          <div className="flex items-center gap-2 mb-1">
            <Gift className="w-5 h-5 text-accent" />
            <h3 className="font-serif text-lg text-primary">
              {config.gift.name}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            An open-value voucher — choose an amount or enter your own (min{" "}
            {money(symbol, config.gift.min)}).
          </p>
          <ul className="mb-4">
            <li className="relative pl-[20px] text-[13px] text-foreground/80">
              <Check
                className="absolute left-0 top-[3px] w-3 h-3 text-accent"
                strokeWidth={3}
              />
              Valid for 1 year
            </li>
          </ul>
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
        <div className="grid sm:grid-cols-3 gap-4">
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
          <button
            type="button"
            onClick={() => setPlan("split")}
            className={`text-left rounded-xl border-2 p-5 transition-all ${
              plan === "split"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-primary">
              <Users className="w-5 h-5" /> Split with a group
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {total > 0
                ? `Share ${money(symbol, total)} across friends — one voucher, paid together.`
                : "Share one voucher across a group, paid together."}
            </p>
          </button>
        </div>

        {plan === "split" ? (
          !selection ? (
            <div className="mt-8 rounded-xl border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Choose an apartment package or gift amount above to split it with a
              group.
            </div>
          ) : selection.kind === "day_pass" ? (
            <div className="mt-8 rounded-xl border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Day passes are sold as a single fixed-price voucher — choose{" "}
              <span className="font-medium text-foreground">Pay in full</span> or{" "}
              <span className="font-medium text-foreground">
                Pay in {config.instalments}
              </span>
              . To share the cost across a group, use the open-value gift voucher
              above.
            </div>
          ) : (
            <VoucherSplitSetup
              selection={selection}
              nights={nights}
              total={total}
              symbol={symbol}
            />
          )
        ) : (
          <>
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
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="buyer_phone">Mobile number (WhatsApp)</Label>
                <Input
                  id="buyer_phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+248 2 510 000"
                />
                <p className="text-xs text-muted-foreground">
                  Include your country code — we'll also send your voucher
                  confirmation on WhatsApp.
                </p>
              </div>
            </div>

            {isSignedIn && creditBalanceMinor > 0 && total > 0 && (
              <label className="mt-4 flex max-w-2xl items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 cursor-pointer">
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={applyCredit}
                    onChange={(e) => setApplyCredit(e.target.checked)}
                  />
                  <span className="text-sm text-foreground/80">
                    Apply my account credit
                    <span className="text-muted-foreground">
                      {" "}
                      ({money(symbol, creditAvailableMajor)} available)
                    </span>
                  </span>
                </span>
                {creditAppliedMajor > 0 ? (
                  <span className="text-sm font-semibold text-primary">
                    −{money(symbol, creditAppliedMajor)}
                  </span>
                ) : null}
              </label>
            )}

            {creditAppliedMajor > 0 && (
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                {money(symbol, creditAppliedMajor)} credit applied
                {cashDue > 0
                  ? ` — ${money(symbol, cashDue)} left to pay.`
                  : " — nothing left to pay."}
              </p>
            )}

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
                    {plan === "instalments" && cashDue > 0
                      ? `Pay ${money(symbol, perInstalment)} now`
                      : cashDue > 0
                        ? `Pay ${money(symbol, cashDue)}`
                        : "Continue to payment"}
                  </>
                )}
              </Button>
              {plan === "instalments" && cashDue > 0 && (
                <p className="text-sm text-muted-foreground">
                  Then {config.instalments - 1} more payments of{" "}
                  {money(symbol, perInstalment)}. Your card is saved securely for
                  the remaining instalments.
                </p>
              )}
            </div>
          </>
        )}

        <GroupLinksSection />

        <AmenitiesSection />

        <PhotoGallery />

        {config.promo_banner?.trim() && (
          <p className="text-[12.5px] text-muted-foreground mt-10">
            {config.promo_banner} Full{" "}
            <Link
              href="/terms"
              className="text-primary underline underline-offset-2"
            >
              Terms &amp; Conditions
            </Link>
            .
          </p>
        )}
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
    orderNumber: string | null | undefined;
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
          setResult({
            status: data.status,
            voucher: data.voucher,
            orderNumber: data.order_number,
          });
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
        <p className="text-muted-foreground mb-6">
          {plan === "instalments"
            ? "Your first payment is in. We'll charge the remaining instalments automatically."
            : "Your payment is complete."}
        </p>
        {result.orderNumber && (
          <div className="mb-8 inline-flex flex-col items-center">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Order number
            </span>
            <span className="mt-1 font-mono text-lg font-bold tracking-wider text-primary">
              {result.orderNumber}
            </span>
          </div>
        )}
        {result.voucher ? (
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground mb-3">
              Your voucher code
            </p>
            <div className="text-2xl font-mono tracking-widest font-bold bg-muted/50 py-3 rounded-lg">
              {result.voucher.code}
            </div>
            <DownloadVoucherButton code={result.voucher.code} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your voucher activates once your plan is fully paid — we&rsquo;ll
            email it to you.
          </p>
        )}
        <div className="mt-8 pt-6 border-t border-border/60">
          <p className="text-sm text-muted-foreground mb-3">
            We&rsquo;ve emailed your confirmation. Create an account or sign in
            to keep track of your vouchers, payments and receipts.
          </p>
          <Button asChild variant="outline">
            <Link href="/dashboard">Access your dashboard</Link>
          </Button>
        </div>
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
              Payments are processed securely. Your card details are
              never stored on our servers.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DownloadVoucherButton({ code }: { code: string }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadVoucherPdf(
        publicVoucherPdfUrl(code),
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
      className="w-full mt-4"
      disabled={downloading}
      onClick={handleDownload}
    >
      <Download className="w-4 h-4 mr-2" />
      {downloading ? "Preparing…" : "Download voucher (PDF)"}
    </Button>
  );
}

function absoluteUrl(relative: string) {
  return (
    window.location.origin +
    import.meta.env.BASE_URL.replace(/\/$/, "") +
    relative
  );
}

/**
 * Shared presentation for a freshly created group order: the organiser
 * dashboard link plus a copyable payment link per participant. Reused by the
 * simple "same amount per person" box and the voucher-split flow.
 */
function GroupLinksResult({
  result,
  currency,
  minorPerMajor,
  onReset,
  resetLabel,
  intro,
}: {
  result: GroupOrderCreated;
  currency: string;
  minorPerMajor: number;
  onReset: () => void;
  resetLabel: string;
  intro: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? null : c)), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const dashboardUrl = absoluteUrl(result.organiser_url);

  return (
    <div className="mt-8 rounded-xl border border-primary/20 bg-primary/5 p-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-2 mb-1">
        <Check className="w-5 h-5 text-primary" />
        <p className="font-medium text-primary">Payment links are ready</p>
      </div>
      <p className="text-sm text-muted-foreground mb-5">{intro}</p>

      <div className="mb-6">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-2">
          <LinkIcon className="w-3.5 h-3.5" /> Organiser dashboard
        </Label>
        <div className="flex items-center gap-2 bg-background rounded-md border border-border p-1.5">
          <Input
            readOnly
            value={dashboardUrl}
            className="border-none font-mono text-xs focus-visible:ring-0 h-8"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => copy(dashboardUrl)}
          >
            {copied === dashboardUrl ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-2 block">
        Participant payment links
      </Label>
      <div className="space-y-2">
        {result.lines.map((line) => {
          const payUrl = absoluteUrl(line.pay_link);
          return (
            <div
              key={line.id}
              className="flex items-center gap-2 bg-background rounded-md border border-border p-2"
            >
              <span className="text-sm text-foreground truncate min-w-0 flex-1 pl-1">
                {line.payer_email}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {currency}{" "}
                {(line.amount_minor / minorPerMajor).toLocaleString("en-US")}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => copy(payUrl)}
              >
                {copied === payUrl ? (
                  <Check className="w-3.5 h-3.5 mr-1.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                )}
                {copied === payUrl ? "Copied" : "Copy link"}
              </Button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onReset}
        className="text-sm text-primary underline underline-offset-2 mt-5"
      >
        {resetLabel}
      </button>
    </div>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Light client-side sanity check only; the server normalises to E.164 and is
// the source of truth for phone validity.
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{5,}$/;

/**
 * Inline "split this voucher with a group" setup, seeded from the storefront
 * selection. Builds a group-order in the existing "split" mode: apartment
 * packages are priced server-side from the catalog (apartment_type + nights);
 * gift vouchers are split as an open-value total (amount_minor).
 */
function VoucherSplitSetup({
  selection,
  nights,
  total,
  symbol,
}: {
  selection: Selection;
  nights: number;
  total: number;
  symbol: string;
}) {
  const { toast } = useToast();
  const { data: rates } = useGetRates();
  const createGroupOrder = useCreateGroupOrder();

  const [organiserEmail, setOrganiserEmail] = useState("");
  const [organiserPhone, setOrganiserPhone] = useState("");
  const [participants, setParticipants] = useState<
    { email: string; share: string }[]
  >([
    { email: "", share: "" },
    { email: "", share: "" },
  ]);
  const [result, setResult] = useState<GroupOrderCreated | null>(null);

  const minorPerMajor = rates?.minor_per_major ?? 100;
  const currency = rates?.currency?.toUpperCase() ?? "SCR";
  const totalMinor = Math.round(total * minorPerMajor);

  const setParticipant = (
    index: number,
    field: "email" | "share",
    value: string,
  ) =>
    setParticipants((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  const addParticipant = () =>
    setParticipants((prev) => [...prev, { email: "", share: "" }]);
  const removeParticipant = (index: number) =>
    setParticipants((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );

  const reset = () => {
    setResult(null);
    setOrganiserEmail("");
    setOrganiserPhone("");
    setParticipants([
      { email: "", share: "" },
      { email: "", share: "" },
    ]);
  };

  const submit = () => {
    if (!rates) return;
    if (!EMAIL_RE.test(organiserEmail.trim())) {
      toast({
        title: "Organiser email required",
        description: "Please enter a valid organiser email.",
        variant: "destructive",
      });
      return;
    }
    if (!PHONE_RE.test(organiserPhone.trim())) {
      toast({
        title: "Organiser mobile number required",
        description:
          "Include the country code, e.g. +248 2 510 000. We'll send voucher confirmations on WhatsApp too.",
        variant: "destructive",
      });
      return;
    }

    const filled = participants
      .map((p) => ({ email: p.email.trim(), share: p.share.trim() }))
      .filter((p) => p.email.length > 0);
    if (filled.length === 0 || !filled.every((p) => EMAIL_RE.test(p.email))) {
      toast({
        title: "Check participant emails",
        description: "Add at least one valid participant email address.",
        variant: "destructive",
      });
      return;
    }

    // Build the per-participant lines. If anyone enters a custom share we send
    // explicit shares for everyone (the remainder is divided equally among the
    // people without a custom share); otherwise we let the server split equally.
    const anyCustom = filled.some((p) => p.share.length > 0);
    let lines: { payer_email: string; share_minor?: number }[];

    if (anyCustom) {
      const withShare = filled.filter((p) => p.share.length > 0);
      for (const p of withShare) {
        const v = Number(p.share);
        if (!Number.isFinite(v) || v <= 0) {
          toast({
            title: "Check the shares",
            description: "Each custom share must be a positive amount.",
            variant: "destructive",
          });
          return;
        }
      }
      const allocatedMinor = withShare.reduce(
        (s, p) => s + Math.round(Number(p.share) * minorPerMajor),
        0,
      );
      const withoutShare = filled.filter((p) => p.share.length === 0);
      const remainingMinor = totalMinor - allocatedMinor;
      if (remainingMinor < 0) {
        toast({
          title: "Shares exceed the total",
          description: `The shares add up to more than ${money(symbol, total)}.`,
          variant: "destructive",
        });
        return;
      }
      if (withoutShare.length === 0 && remainingMinor > 0) {
        toast({
          title: "Shares don't cover the total",
          description: `The shares must add up to ${money(symbol, total)}.`,
          variant: "destructive",
        });
        return;
      }
      const baseMinor =
        withoutShare.length > 0
          ? Math.floor(remainingMinor / withoutShare.length)
          : 0;
      let remainder =
        withoutShare.length > 0 ? remainingMinor % withoutShare.length : 0;
      lines = filled.map((p) => {
        if (p.share.length > 0) {
          return {
            payer_email: p.email,
            share_minor: Math.round(Number(p.share) * minorPerMajor),
          };
        }
        let share = baseMinor;
        if (remainder > 0) {
          share += 1;
          remainder -= 1;
        }
        return { payer_email: p.email, share_minor: share };
      });
    } else {
      lines = filled.map((p) => ({ payer_email: p.email }));
    }

    const split =
      selection.kind === "package"
        ? {
            apartment_type: selection.item.id.replace(
              /-/g,
              "_",
            ) as SplitConfigApartmentType,
            nights,
          }
        : { amount_minor: totalMinor };

    createGroupOrder.mutate(
      {
        data: {
          mode: "split",
          organiser_email: organiserEmail.trim(),
          organiser_phone: organiserPhone.trim(),
          split,
          lines,
        },
      },
      {
        onSuccess: (data) => setResult(data),
        onError: (err: unknown) => {
          const message =
            err && typeof err === "object" && "error" in err
              ? String((err as { error: unknown }).error)
              : "Please try again.";
          toast({
            title: "Couldn't create payment links",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  if (result) {
    return (
      <GroupLinksResult
        result={result}
        currency={currency}
        minorPerMajor={minorPerMajor}
        onReset={reset}
        resetLabel="Split another voucher"
        intro="Share each link below — the single voucher is issued once everyone has paid."
      />
    );
  }

  const voucherLabel =
    selection.kind === "package"
      ? `${selection.item.name} · ${nights} night${nights === 1 ? "" : "s"}`
      : selection.kind === "day_pass"
        ? selection.option.name
        : "Gift voucher";

  return (
    <div className="mt-8 rounded-xl border-2 border-primary/30 bg-primary/5 p-5 animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="flex items-start gap-3">
        <Users className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-primary">Split this voucher</p>
          <p className="text-sm text-muted-foreground">
            {voucherLabel} · everyone contributes toward one{" "}
            {money(symbol, total)} voucher, issued once all shares are paid.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="max-w-md">
          <Label htmlFor="split-organiser">Your email (organiser)</Label>
          <Input
            id="split-organiser"
            type="email"
            value={organiserEmail}
            onChange={(e) => setOrganiserEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5"
          />
        </div>

        <div className="max-w-md">
          <Label htmlFor="split-organiser-phone">
            Your mobile number (WhatsApp)
          </Label>
          <Input
            id="split-organiser-phone"
            type="tel"
            value={organiserPhone}
            onChange={(e) => setOrganiserPhone(e.target.value)}
            placeholder="+248 2 510 000"
            className="mt-1.5"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Include the country code — voucher confirmations are also sent on
            WhatsApp.
          </p>
        </div>

        <div>
          <Label>
            Participants{" "}
            <span className="font-normal text-muted-foreground">
              (leave a share blank to split the rest equally)
            </span>
          </Label>
          <div className="space-y-2 mt-1.5">
            {participants.map((p, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  type="email"
                  value={p.email}
                  onChange={(e) => setParticipant(index, "email", e.target.value)}
                  placeholder="name@example.com"
                  className="min-w-0 flex-1"
                />
                <Input
                  type="number"
                  min="1"
                  step="0.01"
                  inputMode="decimal"
                  value={p.share}
                  onChange={(e) => setParticipant(index, "share", e.target.value)}
                  placeholder={`Share (${currency})`}
                  className="w-32 shrink-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground"
                  disabled={participants.length <= 1}
                  onClick={() => removeParticipant(index)}
                  aria-label="Remove participant"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={addParticipant}
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add participant
          </Button>
        </div>

        <Button
          type="button"
          onClick={submit}
          disabled={createGroupOrder.isPending}
        >
          {createGroupOrder.isPending
            ? "Generating links…"
            : "Generate payment links"}
        </Button>
      </div>
    </div>
  );
}

function GroupLinksSection() {
  const { toast } = useToast();
  const { data: rates } = useGetRates();
  const createGroupOrder = useCreateGroupOrder();

  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState("");
  const [organiserEmail, setOrganiserEmail] = useState("");
  const [organiserPhone, setOrganiserPhone] = useState("");
  const [participants, setParticipants] = useState<string[]>(["", ""]);
  const [result, setResult] = useState<GroupOrderCreated | null>(null);

  const currency = rates?.currency?.toUpperCase() ?? "SCR";

  const setParticipant = (index: number, value: string) =>
    setParticipants((prev) => prev.map((p, i) => (i === index ? value : p)));
  const addParticipant = () => setParticipants((prev) => [...prev, ""]);
  const removeParticipant = (index: number) =>
    setParticipants((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );

  const reset = () => {
    setResult(null);
    setAmount("");
    setOrganiserEmail("");
    setOrganiserPhone("");
    setParticipants(["", ""]);
  };

  const submit = () => {
    if (!rates) return;
    const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const amountMajor = parseFloat(amount);
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
      toast({
        title: "Enter an amount per person",
        description: `Please enter a positive ${currency} amount.`,
        variant: "destructive",
      });
      return;
    }
    if (!emailRe.test(organiserEmail.trim())) {
      toast({
        title: "Organiser email required",
        description: "Please enter a valid organiser email.",
        variant: "destructive",
      });
      return;
    }
    if (!PHONE_RE.test(organiserPhone.trim())) {
      toast({
        title: "Organiser mobile number required",
        description:
          "Include the country code, e.g. +248 2 510 000. We'll send voucher confirmations on WhatsApp too.",
        variant: "destructive",
      });
      return;
    }
    const emails = participants.map((p) => p.trim()).filter(Boolean);
    if (emails.length === 0 || !emails.every((e) => emailRe.test(e))) {
      toast({
        title: "Check participant emails",
        description: "Add at least one valid participant email address.",
        variant: "destructive",
      });
      return;
    }

    createGroupOrder.mutate(
      {
        data: {
          mode: "flat",
          organiser_email: organiserEmail.trim(),
          organiser_phone: organiserPhone.trim(),
          per_person_minor: Math.round(amountMajor * rates.minor_per_major),
          lines: emails.map((email) => ({ payer_email: email })),
        },
      },
      {
        onSuccess: (data) => setResult(data),
        onError: (err: unknown) => {
          const message =
            err && typeof err === "object" && "error" in err
              ? String((err as { error: unknown }).error)
              : "Please try again.";
          toast({
            title: "Couldn't create payment links",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  if (result) {
    return (
      <GroupLinksResult
        result={result}
        currency={currency}
        minorPerMajor={rates?.minor_per_major ?? 100}
        onReset={reset}
        resetLabel="Create another set of links"
        intro="Share each link below — everyone gets their own voucher once they pay."
      />
    );
  }

  return (
    <div className="mt-12 rounded-xl border border-border bg-muted/30 p-5">
      <div className="flex items-start gap-3">
        <Users className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium text-primary">Buying for a group?</p>
          <p className="text-sm text-muted-foreground">
            Send everyone their own payment link for the same amount each.
            {!expanded && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="text-primary underline underline-offset-2"
                >
                  Set up group payment links
                </button>
                .
              </>
            )}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="mt-5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-300">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="group-amount">Amount per person ({currency})</Label>
              <Input
                id="group-amount"
                type="number"
                min="1"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 2300"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="group-organiser">Your email (organiser)</Label>
              <Input
                id="group-organiser"
                type="email"
                value={organiserEmail}
                onChange={(e) => setOrganiserEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1.5"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="group-organiser-phone">
                Your mobile number (WhatsApp)
              </Label>
              <Input
                id="group-organiser-phone"
                type="tel"
                value={organiserPhone}
                onChange={(e) => setOrganiserPhone(e.target.value)}
                placeholder="+248 2 510 000"
                className="mt-1.5"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Include the country code — voucher confirmations are also sent
                on WhatsApp.
              </p>
            </div>
          </div>

          <div>
            <Label>Participant emails</Label>
            <div className="space-y-2 mt-1.5">
              {participants.map((email, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setParticipant(index, e.target.value)}
                    placeholder="name@example.com"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground"
                    disabled={participants.length <= 1}
                    onClick={() => removeParticipant(index)}
                    aria-label="Remove participant"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={addParticipant}
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add participant
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
            <Button
              type="button"
              onClick={submit}
              disabled={createGroupOrder.isPending}
            >
              {createGroupOrder.isPending
                ? "Generating links…"
                : "Generate payment links"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
