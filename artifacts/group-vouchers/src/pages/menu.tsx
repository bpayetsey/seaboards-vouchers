import { useState } from "react";
import { Link } from "wouter";
import { Download, Loader2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { downloadVoucherPdf } from "@/lib/voucherPdf";
import {
  RESORT,
  MENU_TITLE,
  MENU_EPIGRAPH,
  MENU_INTRO,
  DINNER_SECTIONS,
  DESSERT_NOTE,
  BREAKFAST_STYLES,
  DAY_PASS_MENU_TITLE,
  DAY_PASS_MENU_INTRO,
  DAY_PASS_SECTIONS,
  DAY_PASS_DESSERT_NOTE,
  DAY_PASS_BREAKFAST_NOTE,
} from "@workspace/voucher-content";

export type MenuVariant = "half-board" | "day-pass";

const MENU_CONFIG = {
  "half-board": {
    label: "Half Board",
    title: MENU_TITLE,
    intro: MENU_INTRO,
    sections: DINNER_SECTIONS,
    dessert: DESSERT_NOTE,
    breakfastNote: undefined as string | undefined,
    pdfUrl: "/api/menu/pdf",
    pdfName: "seaboards-menu.pdf",
  },
  "day-pass": {
    label: "Day Pass",
    title: DAY_PASS_MENU_TITLE,
    intro: DAY_PASS_MENU_INTRO,
    sections: DAY_PASS_SECTIONS,
    dessert: DAY_PASS_DESSERT_NOTE,
    breakfastNote: DAY_PASS_BREAKFAST_NOTE as string | undefined,
    pdfUrl: "/api/menu/pdf?type=day-pass",
    pdfName: "seaboards-day-pass-menu.pdf",
  },
} as const;

function VegBadge() {
  return (
    <span
      role="img"
      aria-label="Vegetarian"
      title="Vegetarian"
      className="ml-2 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-accent text-[10px] font-bold text-accent align-middle"
    >
      <span aria-hidden="true">V</span>
    </span>
  );
}

export default function Menu({
  variant = "half-board",
}: {
  variant?: MenuVariant;
}) {
  const menu = MENU_CONFIG[variant];
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      await downloadVoucherPdf(menu.pdfUrl, menu.pdfName);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Layout>
      <article className="max-w-4xl mx-auto bg-card px-6 sm:px-12 lg:px-[72px] py-10 sm:py-16">
        <header className="text-center pb-6 border-b-2 border-accent">
          <div className="font-sans text-[13px] font-bold uppercase tracking-[0.32em] text-primary">
            {RESORT.name}
          </div>
          <div className="text-[12.5px] text-muted-foreground tracking-[0.04em] mt-1">
            {RESORT.location}
          </div>
          <div className="mt-6 font-sans text-[12.5px] font-bold uppercase tracking-[0.4em] text-accent">
            {menu.label}
          </div>
          <h1 className="font-serif font-semibold text-primary text-3xl md:text-[46px] leading-[1.08] mt-2 mb-2">
            {menu.title}
          </h1>
          <p className="font-serif italic text-muted-foreground text-[16px] m-0 max-w-xl mx-auto">
            &ldquo;{MENU_EPIGRAPH.quote}&rdquo;
            <span className="not-italic text-[13px] tracking-[0.04em]">
              {" "}
              &mdash; {MENU_EPIGRAPH.attribution}
            </span>
          </p>
          <nav
            aria-label="Choose a menu"
            className="mt-5 inline-flex rounded-full border border-accent/50 p-1 font-sans text-[12.5px] font-semibold uppercase tracking-[0.12em]"
          >
            {(["half-board", "day-pass"] as const).map((v) => (
              <Link
                key={v}
                href={v === "day-pass" ? "/menu/day-pass" : "/menu"}
                aria-current={v === variant ? "page" : undefined}
                data-testid={`link-menu-${v}`}
                className={`rounded-full px-4 py-1.5 transition-colors ${
                  v === variant
                    ? "bg-accent/20 text-primary"
                    : "text-muted-foreground hover:text-primary"
                }`}
              >
                {MENU_CONFIG[v].label}
              </Link>
            ))}
          </nav>
          <div className="mt-6">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              data-testid="button-download-menu-pdf"
              className="inline-flex items-center gap-2 rounded-full border border-accent bg-accent/10 px-5 py-2.5 font-sans text-[13px] font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:bg-accent/20 disabled:opacity-60"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {downloading ? "Preparing PDF\u2026" : "Download PDF"}
            </button>
            {downloadError && (
              <p
                className="mt-2 text-[13px] text-destructive"
                data-testid="text-menu-pdf-error"
              >
                Sorry, the PDF could not be generated. Please try again.
              </p>
            )}
          </div>
        </header>

        <p className="mt-6 text-center text-[15px] leading-relaxed text-muted-foreground max-w-2xl mx-auto">
          {menu.intro}
        </p>

        {/* Dinner & à la carte */}
        <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {menu.sections.map((section) => (
            <section key={section.title} className="break-inside-avoid">
              <h2 className="font-serif text-primary text-[22px] font-semibold border-b border-accent/40 pb-2 mb-4">
                {section.title}
              </h2>
              {section.note && (
                <p className="text-[13px] text-muted-foreground italic mb-3 -mt-2">
                  {section.note}
                </p>
              )}
              <ul className="list-none m-0 p-0 space-y-3.5">
                {section.items.map((item) => (
                  <li key={item.name}>
                    <div className="flex items-baseline gap-2">
                      <span className="font-sans text-[15.5px] font-semibold text-ink text-foreground">
                        {item.name}
                      </span>
                      {item.veg && <VegBadge />}
                      {(item.price ?? item.supplement) && (
                        <>
                          <span className="flex-1 border-b border-dotted border-border/70 translate-y-[-3px]" />
                          <span
                            className={`font-sans text-[14px] font-semibold whitespace-nowrap ${
                              item.price ? "text-primary" : "text-accent"
                            }`}
                          >
                            {item.price ?? item.supplement}
                          </span>
                        </>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-[13.5px] text-muted-foreground leading-snug mt-0.5">
                        {item.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Dessert */}
        <div className="mt-12 rounded-2xl border border-accent/50 bg-accent/5 px-6 py-7 text-center">
          <h2 className="font-serif text-primary text-[24px] font-semibold mb-2">
            {menu.dessert.title}
          </h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground max-w-2xl mx-auto">
            {menu.dessert.text}
          </p>
        </div>

        {/* Breakfast */}
        <div className="mt-16 pt-10 border-t-2 border-accent">
          <div className="text-center mb-8">
            <div className="font-sans text-[12.5px] font-bold uppercase tracking-[0.4em] text-accent">
              Every Morning
            </div>
            <h2 className="font-serif text-primary text-[28px] md:text-[34px] font-semibold mt-1">
              Breakfast
            </h2>
            <p className="text-[14px] text-muted-foreground mt-1">
              Choose your style each morning.
            </p>
            {menu.breakfastNote && (
              <p className="text-[13px] text-muted-foreground italic mt-1">
                {menu.breakfastNote}
              </p>
            )}
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {BREAKFAST_STYLES.map((style) => (
              <section
                key={style.title}
                className="rounded-2xl border border-border bg-background/40 p-6"
              >
                <h3 className="font-serif text-primary text-[20px] font-semibold mb-4">
                  {style.title}
                </h3>
                <div className="space-y-4">
                  {style.groups.map((group) => (
                    <div key={group.label}>
                      <div className="font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-accent mb-1.5">
                        {group.label}
                      </div>
                      <ul className="list-none m-0 p-0 space-y-1">
                        {group.options.map((opt, i) => (
                          <li
                            key={i}
                            className="text-[14px] leading-snug text-foreground/90"
                          >
                            {opt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="mt-12 pt-6 border-t-2 border-accent text-center text-muted-foreground text-[13.5px] italic">
          Menu items are subject to seasonal availability.
          <div className="mt-2 not-italic text-primary text-[13px] tracking-[0.04em]">
            {RESORT.name} &middot; {RESORT.location}
          </div>
        </div>

        <div className="mt-8 flex justify-center gap-6">
          <Link
            href="/"
            className="text-primary underline underline-offset-2 text-sm"
          >
            Return to the offer
          </Link>
          <Link
            href="/terms"
            className="text-primary underline underline-offset-2 text-sm"
          >
            Terms &amp; Conditions
          </Link>
        </div>
      </article>
    </Layout>
  );
}
