import { Link } from "wouter";
import { Layout } from "@/components/layout";
import {
  RESORT,
  VOUCHER_TERMS_FULL,
  TERMS_ACCEPTANCE,
} from "@workspace/voucher-content";

export default function Terms() {
  return (
    <Layout>
      <article className="max-w-3xl mx-auto bg-card px-6 sm:px-12 lg:px-[72px] py-10 sm:py-16">
        <header className="text-center pb-6 border-b-2 border-accent">
          <div className="font-sans text-[13px] font-bold uppercase tracking-[0.32em] text-primary">
            {RESORT.name}
          </div>
          <div className="text-[12.5px] text-muted-foreground tracking-[0.04em] mt-1">
            {RESORT.location}
          </div>
          <div className="mt-6 font-sans text-[12.5px] font-bold uppercase tracking-[0.4em] text-accent">
            50 Years of Freedom
          </div>
          <h1 className="font-serif font-semibold text-primary text-3xl md:text-[46px] leading-[1.08] mt-2 mb-1">
            {RESORT.offerTitle}
          </h1>
          <p className="font-serif italic text-muted-foreground text-[17px] m-0">
            Celebrating 50 Years of Seychelles Independence &middot; 1976&ndash;2026
          </p>
        </header>
        <div className="text-center mt-5 mb-1 font-sans text-[13px] font-bold uppercase tracking-[0.28em] text-primary">
          Terms &amp; Conditions
        </div>

        {VOUCHER_TERMS_FULL.map((section) => (
          <section key={section.title} className="mt-9">
            <h2 className="font-serif text-primary text-[22px] font-semibold mb-1">
              {section.title}
            </h2>
            <ul className="list-none m-0 mt-2.5 p-0">
              {section.clauses.map((clause, i) => (
                <li
                  key={i}
                  className="relative pl-7 mb-2.5 text-[16.5px] leading-relaxed"
                >
                  <span className="absolute left-2 top-0 text-accent font-bold">
                    &bull;
                  </span>
                  {clause}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="mt-10 pt-5 border-t-2 border-accent text-center text-muted-foreground text-[13.5px] italic">
          {TERMS_ACCEPTANCE}
          <div className="mt-2 not-italic text-primary text-[13px] tracking-[0.04em]">
            {RESORT.name} &middot; {RESORT.location}
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/"
            className="text-primary underline underline-offset-2 text-sm"
          >
            Return to the offer
          </Link>
        </div>
      </article>
    </Layout>
  );
}
