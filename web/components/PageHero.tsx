// The banner at the top of each page in the Broadcast style: slanted lime
// light, a big italic title and a one-line subtitle. The right side holds
// only figures that belong to this page; the deadline is already in the
// header and the squad's money is on the Dashboard, so neither repeats.

import type { ReactNode } from "react";

export interface HeroFigure {
  label: string;
  value: ReactNode;
  accent?: boolean;
}

interface PageHeroProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  figures?: HeroFigure[];
  children?: ReactNode; // anything else for the right side, such as a countdown
}

export function PageHero({ eyebrow, title, subtitle, figures = [], children }: PageHeroProps) {
  return (
    <section className="bc-card bc-hero bc-page-hero">
      <span className="bc-slash bc-slash-wide" aria-hidden="true" />
      <span className="bc-slash bc-slash-thin" aria-hidden="true" />
      <div className="bc-page-hero-text">
        <span className="bc-eyebrow bc-accent">{eyebrow}</span>
        <h1 className="bc-page-title">{title}</h1>
        <p className="bc-note">{subtitle}</p>
      </div>
      {(figures.length > 0 || children) && (
        <div className="bc-page-hero-side">
          {figures.map((figure) => (
            <div key={figure.label} className="bc-hero-figure">
              <span className="bc-stat-label">{figure.label}</span>
              <span className={figure.accent ? "bc-hero-figure-value bc-accent" : "bc-hero-figure-value"}>{figure.value}</span>
            </div>
          ))}
          {children}
        </div>
      )}
    </section>
  );
}
