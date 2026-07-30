/**
 * The disclosure text itself, and nothing else.
 *
 * Extracted so there is exactly **one** copy of it. It is read in two places — the blocking
 * screen before a man files anything, and the Circle tab where he can go back and re-read it —
 * and two copies of a consent text is the worst possible outcome: they drift, and then nobody
 * can say which version he actually agreed to. `profiles.disclosure_version` records a version
 * string, and that string is only meaningful if the words it names are in one place.
 *
 * SECURITY.md §3 requires both readings. The second one was missing until this file existed.
 */
export function DisclosureBody() {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-[0.14em] text-text-primary uppercase">
          What the mentor sees
        </h3>
        <p>
          <strong className="text-text-primary">Everything you record, itemised.</strong> Which
          protocols you passed, which you passed at MED, and which you failed — including the
          sexual-discipline protocol and the ones covering alcohol and drugs. He also sees your
          debriefs, your commitments and your revenue.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-[0.14em] text-text-primary uppercase">
          What the other men see
        </h3>
        <p>
          Whether you filed, whether your day held, your weekly commitments and whether you hit
          them. <strong className="text-text-primary">Not</strong> which specific protocol you
          failed. The sensitive ones count toward your day&rsquo;s status and are never itemised to
          your peers.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-[0.14em] text-text-primary uppercase">
          What nobody outside sees
        </h3>
        <p>
          No analytics service, error reporter or log aggregator ever receives protocol detail.
          Your data is exportable and deletable on request, and deletion means deletion.
        </p>
      </section>

      <p className="text-text-muted">
        This only works if what you record is true. If you would rather not have the mentor see a
        particular protocol itemised, say so to him directly — do not solve it by filing a report
        that is not accurate.
      </p>
    </>
  );
}
