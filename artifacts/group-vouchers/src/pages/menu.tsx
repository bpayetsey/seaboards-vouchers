import { Link } from "wouter";
import { Layout } from "@/components/layout";
import {
  RESORT,
  MENU_TITLE,
  MENU_EPIGRAPH,
  MENU_INTRO,
  DINNER_SECTIONS,
  DESSERT_NOTE,
  BREAKFAST_STYLES,
} from "@workspace/voucher-content";

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

export default function Menu() {
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
            Half Board
          </div>
          <h1 className="font-serif font-semibold text-primary text-3xl md:text-[46px] leading-[1.08] mt-2 mb-2">
            {MENU_TITLE}
          </h1>
          <p className="font-serif italic text-muted-foreground text-[16px] m-0 max-w-xl mx-auto">
            &ldquo;{MENU_EPIGRAPH.quote}&rdquo;
            <span className="not-italic text-[13px] tracking-[0.04em]">
              {" "}
              &mdash; {MENU_EPIGRAPH.attribution}
            </span>
          </p>
        </header>

        <p className="mt-6 text-center text-[15px] leading-relaxed text-muted-foreground max-w-2xl mx-auto">
          {MENU_INTRO}
        </p>

        {/* Dinner & à la carte */}
        <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {DINNER_SECTIONS.map((section) => (
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
                      {item.price && (
                        <>
                          <span className="flex-1 border-b border-dotted border-border/70 translate-y-[-3px]" />
                          <span className="font-sans text-[14px] font-semibold text-primary whitespace-nowrap">
                            {item.price}
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
            {DESSERT_NOTE.title}
          </h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground max-w-2xl mx-auto">
            {DESSERT_NOTE.text}
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
