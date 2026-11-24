// Shown the moment you tap a link, while the next page's data loads on the
// server. Without it the app looked frozen until the page was ready, so a
// tap seemed to do nothing. Next.js also prefetches this outline for every
// link in view, so it appears straight away even on a slow connection.

export default function Loading() {
  return (
    <div className="bc-page page-loading" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the page</span>
      <section className="bc-card bc-hero bc-page-hero page-loading-hero" aria-hidden="true">
        <span className="bc-slash bc-slash-wide" />
        <span className="bc-slash bc-slash-thin" />
        <div className="bc-page-hero-text">
          <span className="page-loading-bar page-loading-eyebrow" />
          <span className="page-loading-bar page-loading-title" />
          <span className="page-loading-bar page-loading-line" />
        </div>
        <span className="page-loading-sweep" />
      </section>
      <div className="page-loading-cards" aria-hidden="true">
        <span className="bc-card page-loading-card" />
        <span className="bc-card page-loading-card" />
      </div>
    </div>
  );
}
