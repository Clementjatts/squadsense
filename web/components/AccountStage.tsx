// The look shared by the account pages (sign in, sign up, forgotten and
// reset password): a dark "stadium" stage with faint pitch markings, and a
// card with the logo and a heading. Each page puts its own form inside.

import { BrandMark } from "./BrandMark";

interface AccountStageProps {
  eyebrow: string;
  title: string;
  text: string;
  children: React.ReactNode;
}

// The stage and the card's top part; the page's form goes in `children`.
export function AccountStage({ eyebrow, title, text, children }: AccountStageProps) {
  return (
    <main className="signin-stage">
      <PitchMarkings />
      <span className="signin-glow signin-glow-lime" aria-hidden="true" />
      <span className="signin-glow signin-glow-blue" aria-hidden="true" />
      <div className="signin-card">
        <span className="signin-stripe" aria-hidden="true" />
        <div className="signin-brand">
          <BrandMark size={40} />
          <span className="signin-wordmark">SQUADSENSE</span>
        </div>
        <div className="signin-heading">
          <span className="signin-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

// A text box in the account pages' style, with a small icon in front.
export function AccountField({ icon, ...input }: { icon: "mail" | "user" | "key" | "shirt" } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="signin-field">
      <svg className="signin-field-icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[icon]}</svg>
      <input aria-label={input.placeholder} {...input} />
    </div>
  );
}

// The field icons: envelope, person, key and football shirt.
const ICONS = {
  mail: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H20M17 12v3" />
    </>
  ),
  shirt: <path d="M8 4l-4.5 3 2 4 2-1V20h9V10l2 1 2-4L16 4c-.5 1.5-2 2.5-4 2.5S8.5 5.5 8 4z" />,
};

// A faint pitch outline behind the card: halfway line, center circle and both boxes.
function PitchMarkings() {
  return (
    <svg className="signin-pitch" viewBox="0 0 1050 680" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect x="25" y="25" width="1000" height="630" />
      <line x1="525" y1="25" x2="525" y2="655" />
      <circle cx="525" cy="340" r="92" />
      <circle cx="525" cy="340" r="4" className="signin-pitch-spot" />
      <rect x="25" y="178" width="165" height="324" />
      <rect x="860" y="178" width="165" height="324" />
      <rect x="25" y="258" width="55" height="164" />
      <rect x="970" y="258" width="55" height="164" />
    </svg>
  );
}

// The arrow on each page's main button.
export function SubmitArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
  );
}
