import { createContext, useContext } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";

const SectionCtx = createContext(1);

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <SectionCtx.Provider value={n}>
      <section className="mt-9">
        <h2 className="font-serif text-primary text-[22px] font-semibold mb-1">
          <span className="text-accent font-bold mr-1.5">{n}.</span>
          {title}
        </h2>
        {children}
      </section>
    </SectionCtx.Provider>
  );
}

function Clauses({
  start = 1,
  items,
}: {
  start?: number;
  items: React.ReactNode[];
}) {
  const section = useContext(SectionCtx);
  return (
    <ol className="list-none m-0 mt-2.5 p-0">
      {items.map((item, i) => (
        <li key={i} className="relative pl-11 mb-2.5 text-[16.5px] leading-relaxed">
          <span className="absolute left-0 top-0 font-bold text-accent text-sm tabular-nums">
            {section}.{start + i}
          </span>
          {item}
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-none my-2 p-0">
      {items.map((item, i) => (
        <li key={i} className="relative pl-7 mb-1.5 text-[16.5px] leading-relaxed">
          <span className="absolute left-2 top-0 text-accent font-bold">&bull;</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

const S = ({ children }: { children: React.ReactNode }) => (
  <strong className="text-primary">{children}</strong>
);

export default function Terms() {
  return (
    <Layout>
      <article className="max-w-3xl mx-auto bg-card px-6 sm:px-12 lg:px-[72px] py-10 sm:py-16">
        <header className="text-center pb-6 border-b-2 border-accent">
          <div className="font-sans text-[13px] font-bold uppercase tracking-[0.32em] text-primary">
            The Seaboards Apartments
          </div>
          <div className="text-[12.5px] text-muted-foreground tracking-[0.04em] mt-1">
            Anse La Mouche &middot; Mah&eacute; &middot; Seychelles
          </div>
          <div className="mt-6 font-sans text-[12.5px] font-bold uppercase tracking-[0.4em] text-accent">
            50 Years of Freedom
          </div>
          <h1 className="font-serif font-semibold text-primary text-3xl md:text-[46px] leading-[1.08] mt-2 mb-1">
            Golden Jubilee Stay Offer
          </h1>
          <p className="font-serif italic text-muted-foreground text-[17px] m-0">
            Celebrating 50 Years of Seychelles Independence &middot; 1976&ndash;2026
          </p>
        </header>
        <div className="text-center mt-5 mb-1 font-sans text-[13px] font-bold uppercase tracking-[0.28em] text-primary">
          Terms &amp; Conditions
        </div>

        <Section n={1} title="The Offer">
          <Clauses
            items={[
              <>To mark 50 years of Seychelles Independence, The Seaboards Apartments is releasing a limited allocation of <S>Golden Jubilee Stay Vouchers</S> at specially reduced rates, payable over three (3) monthly instalments.</>,
              <>Each voucher is sold per room, per night, on a Half Board basis, and is fully stackable &mdash; guests may purchase as many nights as they wish, subject to availability and the blackout dates set out in Clause 6.</>,
              <>The minimum purchase is one (1) night.</>,
              <>The Golden Jubilee rates are as follows:</>,
            ]}
          />
          <div className="overflow-x-auto my-3.5">
            <table className="border-collapse w-full text-[15px] min-w-[460px]">
              <thead>
                <tr>
                  <th className="bg-primary text-white text-left font-semibold px-3.5 py-2.5 text-[13.5px]">Apartment / Occupancy</th>
                  <th className="bg-primary text-white text-left font-semibold px-3.5 py-2.5 text-[13.5px]">Standard HB Rate</th>
                  <th className="bg-primary text-white text-left font-semibold px-3.5 py-2.5 text-[13.5px]">Jubilee HB Rate</th>
                  <th className="bg-primary text-white text-left font-semibold px-3.5 py-2.5 text-[13.5px]">You Save</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3.5 py-2.5 border border-border">One-Bedroom &mdash; 2 adults</td>
                  <td className="px-3.5 py-2.5 border border-border text-center">SCR 3,285</td>
                  <td className="px-3.5 py-2.5 border border-border text-center bg-muted text-primary font-bold">SCR 2,300</td>
                  <td className="px-3.5 py-2.5 border border-border text-center text-accent font-bold">~30%</td>
                </tr>
                <tr>
                  <td className="px-3.5 py-2.5 border border-border">Two-Bedroom &mdash; 4 persons</td>
                  <td className="px-3.5 py-2.5 border border-border text-center">SCR 5,520</td>
                  <td className="px-3.5 py-2.5 border border-border text-center bg-muted text-primary font-bold">SCR 3,750</td>
                  <td className="px-3.5 py-2.5 border border-border text-center text-accent font-bold">~32%</td>
                </tr>
              </tbody>
            </table>
            <div className="text-[13px] italic text-muted-foreground mt-2">
              All rates are quoted per room, per night, in Seychelles Rupees (SCR).
            </div>
          </div>
        </Section>

        <Section n={2} title="What Is Included">
          <Clauses
            items={[
              <>Half Board for the named adult occupants &mdash; daily breakfast and a two-course dinner at the in-house restaurant.</>,
              <>Children stay free of charge on a shared-room basis with an extra bed provided, where room capacity allows.</>,
              <>A breakfast supplement of SCR 295 per child, per day applies for each child taking breakfast.</>,
              <>Children's dinner is available &agrave; la carte at separate cost and is not included in the Half Board package.</>,
              <>Beverages are not included unless expressly stated in writing.</>,
            ]}
          />
        </Section>

        <Section n={3} title="The Golden Fifty Perk">
          <Clauses
            items={[
              <>The first fifty (50) Jubilee Vouchers sold will receive <S>one (1) complimentary cocktail or mocktail per adult (two adults), served with dinner</S>.</>,
              <>The Perk is allocated strictly in order of completed booking and is limited to the first fifty (50) vouchers sold. It applies on one (1) evening of the stay, has no cash value, and is non-transferable.</>,
            ]}
          />
        </Section>

        <Section n={4} title="Payment & Voucher Issue">
          <Clauses items={[<>Guests may pay for their voucher(s) in either of two ways:</>]} />
          <Bullets
            items={[
              <><S>Pay in full</S> at the time of booking; or</>,
              <><S>Pay over three (3) equal monthly instalments.</S></>,
            ]}
          />
          <Clauses
            start={2}
            items={[
              <><S>Where payment is made in full, the voucher is issued immediately upon receipt of cleared payment.</S></>,
              <>Under the instalment plan, Instalment 1 is payable at the time of booking and secures the Jubilee price. Instalments 2 and 3 fall due at <S>30 and 60 days</S> after the booking date respectively.</>,
              <><S>Where payment is made by instalments, the voucher is issued only once the third (final) instalment has cleared in full.</S> No voucher is valid, and no stay may be redeemed, until full payment is received.</>,
              <>Illustrative instalment schedule (single night):</>,
            ]}
          />
          <div className="overflow-x-auto my-3.5">
            <table className="border-collapse w-full text-[15px] min-w-[460px]">
              <thead>
                <tr>
                  <th className="bg-primary text-white text-left font-semibold px-3.5 py-2.5 text-[13.5px]">Apartment (1 night)</th>
                  <th className="bg-primary text-white text-left font-semibold px-3.5 py-2.5 text-[13.5px]">Instalment 1 (Booking)</th>
                  <th className="bg-primary text-white text-left font-semibold px-3.5 py-2.5 text-[13.5px]">Instalment 2 (+30 days)</th>
                  <th className="bg-primary text-white text-left font-semibold px-3.5 py-2.5 text-[13.5px]">Instalment 3 (+60 days)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3.5 py-2.5 border border-border bg-secondary font-semibold">One-Bedroom &mdash; SCR 2,300</td>
                  <td className="px-3.5 py-2.5 border border-border text-center">SCR 767</td>
                  <td className="px-3.5 py-2.5 border border-border text-center">SCR 767</td>
                  <td className="px-3.5 py-2.5 border border-border text-center">SCR 766</td>
                </tr>
                <tr>
                  <td className="px-3.5 py-2.5 border border-border bg-secondary font-semibold">Two-Bedroom &mdash; SCR 3,750</td>
                  <td className="px-3.5 py-2.5 border border-border text-center">SCR 1,250</td>
                  <td className="px-3.5 py-2.5 border border-border text-center">SCR 1,250</td>
                  <td className="px-3.5 py-2.5 border border-border text-center">SCR 1,250</td>
                </tr>
              </tbody>
            </table>
            <div className="text-[13px] italic text-muted-foreground mt-2">
              For multi-night vouchers, instalments are calculated as the total basket value divided by three.
            </div>
          </div>
        </Section>

        <Section n={5} title="Missed or Incomplete Payments">
          <Clauses
            items={[
              <>If any instalment is not received by its due date, The Seaboards will attempt to recover the payment by issuing <S>up to three (3) payment reminders over a grace period of fourteen (14) days</S> from the missed due date.</>,
              <>If the outstanding instalment is settled within the grace period, the payment plan continues unaffected and the schedule resumes as normal.</>,
              <>If the plan is not brought up to date by the end of the grace period, the booking is cancelled, no room voucher is issued, and <S>all amounts already paid are converted into non-refundable Ezzy Group Credit</S>.</>,
              <>Ezzy Group Credit may be redeemed against either of the following sister services:</>,
            ]}
          />
          <Bullets
            items={[
              <><S>Ezzy Foods</S> &mdash; dining at the Ezzy Foods restaurant; or</>,
              <><S>Ezzy Courier &ldquo;Shop &amp; Ship&rdquo;</S> &mdash; shipping of goods from the United Arab Emirates to Seychelles (<a className="text-primary underline underline-offset-2" href="https://ezzycourrier.com">ezzycourrier.com</a>).</>,
            ]}
          />
          <Clauses
            start={5}
            items={[
              <>The credit is equal in value to the total instalments paid, is valid for twelve (12) months from the date of conversion, is non-refundable and non-transferable, and may not be exchanged for cash.</>,
              <>No room amount paid under this offer is refundable in cash under any circumstances. The Jubilee rate is a non-refundable promotional rate.</>,
            ]}
          />
        </Section>

        <Section n={6} title="Validity & Blackout Dates">
          <Clauses
            items={[
              <>Vouchers are sold from <S>29 June 2026</S> until <S>30 September 2026</S>, or until the limited Jubilee allocation is exhausted, whichever occurs first.</>,
              <>Issued vouchers are redeemable for stays up to and including <S>30 June 2027</S>, subject to availability.</>,
              <>Vouchers may not be redeemed for stays falling, in whole or in part, within the following blackout periods:</>,
            ]}
          />
          <Bullets
            items={[
              <><S>15 July 2026 &ndash; 31 August 2026 (inclusive)</S></>,
              <><S>20 December 2026 &ndash; 15 January 2027 (inclusive)</S></>,
            ]}
          />
          <Clauses
            start={4}
            items={[
              <>Stays that overlap a blackout period, even partially, are not permitted under this offer.</>,
            ]}
          />
        </Section>

        <Section n={7} title="Availability & Booking">
          <Clauses
            items={[
              <>All stays are subject to availability at the time the voucher is redeemed. Purchasing a voucher does not, in itself, guarantee a specific date; guests are encouraged to confirm their stay dates as early as possible.</>,
              <>Vouchers are subject to a minimum of one (1) night and are valid for the apartment type purchased only. A One-Bedroom voucher may not be applied to a Two-Bedroom apartment, or vice versa.</>,
            ]}
          />
        </Section>

        <Section n={8} title="Date Changes & Transfers">
          <Clauses
            items={[
              <>Once a voucher is issued, the guest may request a change of redemption dates subject to availability and the blackout dates. The Seaboards will use reasonable efforts to accommodate requested dates but does not guarantee any specific date.</>,
              <>Vouchers are issued to the named purchaser and may not be re-sold. They may be gifted to a third party only with the prior written agreement of The Seaboards.</>,
            ]}
          />
        </Section>

        <Section n={9} title="General">
          <Clauses
            items={[
              <>This offer cannot be combined with any other promotion, discount, or corporate rate.</>,
              <>The Seaboards reserves the right to amend or withdraw this offer at any time. Vouchers already issued will be honoured in accordance with these terms.</>,
              <>These Terms &amp; Conditions are governed by the laws of the Republic of Seychelles.</>,
              <>All bookings are handled through The Seaboards' licensed booking entity. For any query relating to this offer, please contact reservations at <S>+248 4303151</S> (WhatsApp available).</>,
            ]}
          />
        </Section>

        <div className="mt-10 pt-5 border-t-2 border-accent text-center text-muted-foreground text-[13.5px] italic">
          By completing the first instalment, the guest confirms they have read, understood and accepted these Terms &amp; Conditions.
          <div className="mt-2 not-italic text-primary text-[13px] tracking-[0.04em]">
            The Seaboards Apartments &middot; Anse La Mouche &middot; Mah&eacute; &middot; Seychelles
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-primary underline underline-offset-2 text-sm">
            Return to the offer
          </Link>
        </div>
      </article>
    </Layout>
  );
}
