import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import {
  quoteCorporateLunch,
  useCreateCorporateLunchRequest,
  type CorporateLunchQuote,
  type CorporateLunchRequestCreated,
} from "@workspace/api-client-react";
import {
  CORPORATE_LUNCH,
  CORPORATE_LUNCH_COURSES,
  CORPORATE_LUNCH_DEFAULT_SELECTION,
  corporateLunchExtraPrice,
  RESORT,
  type CorporateLunchCourseId,
} from "@workspace/voucher-content";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Selection = Record<CorporateLunchCourseId, string[]>;

const scr = (n: number) => `SCR ${Math.round(n).toLocaleString("en-US")}`;

function tomorrowInMahe(): string {
  const now = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Mahe" }).format(now);
}

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === "string" ? data.error : fallback;
}

export default function CorporateLunch() {
  const [selection, setSelection] = useState<Selection>(() => ({
    starters: [...CORPORATE_LUNCH_DEFAULT_SELECTION.starters],
    mains: [...CORPORATE_LUNCH_DEFAULT_SELECTION.mains],
    rice: [...CORPORATE_LUNCH_DEFAULT_SELECTION.rice],
    desserts: [...CORPORATE_LUNCH_DEFAULT_SELECTION.desserts],
  }));
  const [guests, setGuests] = useState(15);
  const [form, setForm] = useState({
    company: "",
    contact_name: "",
    email: "",
    phone: "",
    event_date: "",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<CorporateLunchRequestCreated | null>(null);

  const quoteQuery = useQuery({
    queryKey: ["corporate-lunch-quote", guests, selection],
    queryFn: () => quoteCorporateLunch({ guests, selection }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const quote: CorporateLunchQuote | undefined = quoteQuery.data;
  const extraIds = useMemo(
    () => new Map((quote?.extras ?? []).map((e) => [e.dish_id, e.price_per_person])),
    [quote],
  );

  const createRequest = useCreateCorporateLunchRequest();

  useEffect(() => {
    if (sent) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [sent]);

  const toggle = (course: CorporateLunchCourseId, id: string) =>
    setSelection((s) => ({
      ...s,
      [course]: s[course].includes(id) ? s[course].filter((x) => x !== id) : [...s[course], id],
    }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!quote?.complete) {
      setFormError(quote?.issues.join(" ") || "Complete your menu first.");
      return;
    }
    createRequest.mutate(
      {
        data: {
          guests,
          selection,
          company: form.company,
          contact_name: form.contact_name,
          email: form.email,
          phone: form.phone,
          event_date: form.event_date,
          notes: form.notes || null,
        },
      },
      {
        onSuccess: (data) => setSent(data),
        onError: (err) =>
          setFormError(errorMessage(err, "We couldn't send your request. Please try again or contact us by phone.")),
      },
    );
  };

  if (sent) {
    return (
      <Layout>
        <section className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="font-sans text-[12.5px] font-bold uppercase tracking-[0.4em] text-accent">
            Request received
          </div>
          <h1 className="font-serif font-semibold text-primary text-3xl md:text-[42px] leading-tight mt-2">
            Thank you, {form.contact_name.split(" ")[0] || "we've got it"}
          </h1>
          <p className="mt-4 text-muted-foreground">
            Your reference is <strong className="text-primary">{sent.reference}</strong>. We've emailed a copy to{" "}
            {form.email} and will confirm availability shortly.
          </p>
          <div className="mt-8 border border-border bg-card px-6 py-5 text-left">
            <div className="flex justify-between gap-4 py-1">
              <span className="text-muted-foreground">Guests</span>
              <span>{sent.quote.guests}</span>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <span className="text-muted-foreground">Price per person</span>
              <span>{scr(sent.quote.price_per_person)}</span>
            </div>
            <div className="flex justify-between gap-4 py-1 border-t border-border mt-2 pt-3 font-semibold text-primary">
              <span>Total</span>
              <span>{scr(sent.quote.total)}</span>
            </div>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Questions? Call or WhatsApp {RESORT.reservationsPhone}.
          </p>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 pt-10 pb-28 lg:pb-16">
        <header className="pb-6 border-b-2 border-accent">
          <div className="font-sans text-[12.5px] font-bold uppercase tracking-[0.4em] text-accent">
            For companies
          </div>
          <h1 className="font-serif font-semibold text-primary text-3xl md:text-[46px] leading-[1.08] mt-2">
            {CORPORATE_LUNCH.title}
          </h1>
          <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
            {[
              `From ${CORPORATE_LUNCH.currency} ${CORPORATE_LUNCH.startingPrice} per person`,
              CORPORATE_LUNCH.service,
              `${CORPORATE_LUNCH.minGuests}–${CORPORATE_LUNCH.maxGuests} guests`,
              ...CORPORATE_LUNCH.inclusions,
            ].map(
              (t) => (
                <span key={t} className="rounded-full border border-accent/50 px-3 py-1 text-muted-foreground">
                  {t}
                </span>
              ),
            )}
          </div>
          <p className="mt-4 max-w-2xl text-muted-foreground">{CORPORATE_LUNCH.intro}</p>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="min-w-0 space-y-10">
            {CORPORATE_LUNCH_COURSES.map((course) => {
              const picked = selection[course.id];
              const short = picked.length < course.min;
              return (
                <section key={course.id} aria-labelledby={`course-${course.id}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                    <h2 id={`course-${course.id}`} className="font-serif text-2xl text-primary">
                      {course.name}
                    </h2>
                    <span className="text-[13px] text-muted-foreground">
                      {course.included} included · extra dishes from +{scr(Math.min(...course.dishes.map((d) => corporateLunchExtraPrice(course, d))))} pp ·{" "}
                      <span className={short ? "text-destructive font-semibold" : "text-primary font-semibold"}>
                        {picked.length} selected
                      </span>
                    </span>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {course.dishes.map((dish) => {
                      const on = picked.includes(dish.id);
                      const extraPrice = extraIds.get(dish.id);
                      const wouldBeExtra = !on && picked.length >= course.included;
                      const addPrice = corporateLunchExtraPrice(course, dish);
                      return (
                        <button
                          key={dish.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(course.id, dish.id)}
                          data-testid={`dish-${dish.id}`}
                          className={`flex w-full items-start gap-3 border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                            on ? "border-primary bg-accent/15" : "border-border bg-card hover:border-accent"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border ${
                              on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                            }`}
                          >
                            {on && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0">
                            <span className="font-medium text-foreground">
                              {dish.name}
                            </span>
                            <span className="block text-[13px] text-muted-foreground">{dish.description}</span>
                            {on && extraPrice !== undefined && (
                              <span className="mt-1 block text-[12px] font-semibold text-primary">
                                Extra · +{scr(extraPrice)} pp
                              </span>
                            )}
                            {wouldBeExtra && (
                              <span className="mt-1 block text-[12px] text-muted-foreground">Add for +{scr(addPrice)} pp</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            <section id="request" aria-labelledby="request-title" className="border border-border bg-card p-5 sm:p-7 scroll-mt-6">
              <h2 id="request-title" className="font-serif text-2xl text-primary">
                Send your request
              </h2>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Nothing is charged now. We'll confirm availability and the final details with you.
              </p>
              <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["company", "Company", "organization", "text"],
                    ["contact_name", "Contact name", "name", "text"],
                    ["email", "Email", "email", "email"],
                    ["phone", "Phone / WhatsApp", "tel", "tel"],
                  ] as const
                ).map(([key, label, auto, type]) => (
                  <div key={key} className="grid gap-1.5">
                    <Label htmlFor={`cl-${key}`}>{label}</Label>
                    <Input
                      id={`cl-${key}`}
                      type={type}
                      autoComplete={auto}
                      required
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="grid gap-1.5">
                  <Label htmlFor="cl-event_date">Date of lunch</Label>
                  <Input
                    id="cl-event_date"
                    type="date"
                    required
                    min={tomorrowInMahe()}
                    value={form.event_date}
                    onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="cl-notes">Notes (allergies, dietary needs, set-up)</Label>
                  <Textarea
                    id="cl-notes"
                    rows={3}
                    placeholder="e.g. 2 vegetarians, no pork for 3 guests"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                {formError && (
                  <p role="alert" className="sm:col-span-2 text-[14px] text-destructive">
                    {formError}
                  </p>
                )}
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={createRequest.isPending}
                    data-testid="button-send-corporate-lunch"
                    className="inline-flex items-center gap-2 bg-primary px-6 py-3 font-sans text-[12.5px] font-semibold uppercase tracking-[0.16em] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {createRequest.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {createRequest.isPending ? "Sending…" : "Send request"}
                  </button>
                </div>
              </form>
            </section>
          </div>

          <aside aria-label="Your price" className="order-first lg:order-none lg:sticky lg:top-6 border border-border bg-card p-5 sm:p-6">
            <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Guests
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="inline-flex items-center border border-border">
                <button
                  type="button"
                  aria-label="Fewer guests"
                  disabled={guests <= CORPORATE_LUNCH.minGuests}
                  onClick={() => setGuests((g) => Math.max(CORPORATE_LUNCH.minGuests, g - 1))}
                  className="flex h-10 w-10 items-center justify-center text-primary disabled:opacity-30"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <output aria-live="polite" className="w-12 text-center text-lg font-semibold tabular-nums">
                  {guests}
                </output>
                <button
                  type="button"
                  aria-label="More guests"
                  disabled={guests >= CORPORATE_LUNCH.maxGuests}
                  onClick={() => setGuests((g) => Math.min(CORPORATE_LUNCH.maxGuests, g + 1))}
                  className="flex h-10 w-10 items-center justify-center text-primary disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <span className="text-[12.5px] text-muted-foreground">
                min {CORPORATE_LUNCH.minGuests} · max {CORPORATE_LUNCH.maxGuests}
              </span>
            </div>

            <div className="mt-6 font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Price per person
            </div>
            <div className="mt-1 font-serif text-[42px] leading-none text-primary tabular-nums" data-testid="text-price-pp">
              {quote?.complete ? scr(quote.price_per_person) : "—"}
            </div>

            <dl className="mt-5 space-y-1.5 border-t border-border pt-4 text-[14px] tabular-nums">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Set menu</dt>
                <dd>{quote?.complete ? `${scr(quote.set_menu_per_person)} pp` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  Extra dishes{quote?.extras.length ? ` (${quote.extras.length})` : ""}
                </dt>
                <dd>{quote?.complete ? (quote.extras_per_person ? `+${scr(quote.extras_per_person)} pp` : "none") : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2 mt-2 font-semibold text-primary">
                <dt>Total for {guests} guests</dt>
                <dd data-testid="text-total">{quote?.complete ? scr(quote.total) : "—"}</dd>
              </div>
            </dl>

            {quote && !quote.complete && (
              <p className="mt-4 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{quote.issues.join(" ")}</p>
            )}
            {quoteQuery.isError && (
              <p className="mt-4 text-[13px] text-destructive">We couldn't load the price. Please refresh the page.</p>
            )}

            <ul className="mt-5 space-y-1 text-[13px] text-muted-foreground">
              {CORPORATE_LUNCH_COURSES.map((c) => (
                <li key={c.id}>
                  <span className="font-semibold text-foreground">{c.name}:</span>{" "}
                  {selection[c.id]
                    .map((id) => c.dishes.find((d) => d.id === id)?.name)
                    .filter(Boolean)
                    .join(", ") || "—"}
                </li>
              ))}
            </ul>

            <a
              href="#request"
              className="mt-6 hidden lg:flex w-full items-center justify-center bg-primary px-5 py-3 font-sans text-[12.5px] font-semibold uppercase tracking-[0.16em] text-primary-foreground transition-opacity hover:opacity-90"
            >
              Send request
            </a>
          </aside>
        </div>
      </div>

      {/* Phone: price stays in view while choosing dishes */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
        <div>
          <div className="font-serif text-xl text-primary tabular-nums">
            {quote?.complete ? scr(quote.price_per_person) : "—"}
          </div>
          <div className="text-[12px] text-muted-foreground">
            {quote?.complete ? `per person · ${scr(quote.total)} for ${guests}` : "complete your menu"}
          </div>
        </div>
        <a
          href="#request"
          className="bg-primary px-4 py-2.5 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-primary-foreground"
        >
          Send request
        </a>
      </div>
    </Layout>
  );
}
