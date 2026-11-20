# SquadSense frontend upgrade and motion guide

SquadSense already has a clean foundation. The dark navy and lime palette reads well on a laptop, the typography separates UI labels from stats, and the pages carry real analytical weight. Still, looking at the built Next.js app in `web/` alongside the HTML design canvas in `docs/design/`, the interface feels static and unfinished in a few obvious places.

This guide breaks down what holds the current build back visually, how to introduce modern surface depth and pitch craft, and how to layer in purposeful motion graphics without turning a fast decision tool into a sluggish toy.

---

## 1. Where the current design stands

Comparing the built components in `web/components/` and `web/app/globals.css` against `docs/screenshots/dashboard-demo.png`, `docs/screenshots/planner-demo.png`, and `docs/design/desktop/Desktop-Dashboard.dc.html` shows five concrete gaps.

1. Empty kit squares on the pitch. In `web/components/Pitch.tsx`, each `.kit-shirt` element renders as an empty 52 by 52 pixel rounded box (`#16213a` with a `#26324d` border). The HTML canvas (`Desktop-Dashboard.dc.html`) at least placed a shirt icon inside that box, and neither version shows club colors or pitch markings. Because the pitch is the focal point of both the Dashboard and the Transfer Planner, empty dark squares make the main card look like a wireframe.
2. Missing navigation and header iconography. In `web/components/Sidebar.tsx`, `LIVE_PAGES` renders text-only links, whereas the canvas design paired each route with a crisp 20px icon and a notification trigger in the top bar. Text-only navigation works, but scanning seven sidebar items takes slightly longer without visual anchors.
3. Abrupt panel mounting and unmounting. The entire app currently has one CSS keyframe animation: `@keyframes panel-in` on `.player-panel` in `web/app/globals.css`. When Clement clicks a player, the panel slides in over 180ms. When he closes it, `PlayerPanelProvider` in `web/components/PlayerPanel.tsx` sets `openId` to `null` and React unmounts `<PlayerPanel>` immediately, so there is no exit transition at all. While the player data fetches, it displays a plain `"Loading..."` paragraph instead of matching the panel layout.
4. Zero continuity during data changes. In `web/components/Planner.tsx`, adding a transfer swaps the player instantly and snaps the Team xP, Bank, and Plan Gain totals. In `web/components/FixtureTickerTable.tsx`, toggling between "For attackers" and "For defenders" re-sorts 20 clubs in one frame, making it impossible for the eye to track where a club moved. In `web/components/PriceWatchView.tsx`, switching filters or watching players cross the 95% price threshold lacks visual emphasis.
5. Flat surface hierarchy. Almost every container uses `--surface` (`#111a2e`) with a flat 1px `--line` (`#26324d`) border. There is no directional top-edge lighting, subtle elevation shadow, hover response on interactive cards, or focus ring polish.

---

## 2. Surface depth, lighting, and typography polish

Before adding any JavaScript animation library, you can make the interface feel noticeably sharper with CSS alone.

Modern dark interfaces use subtle top-edge light rather than heavy drop shadows. In physical spaces, overhead light hits the top lip of a raised panel first. A `1px` inset top border in low-opacity white (`rgba(255, 255, 255, 0.06)`) paired with a soft dark shadow gives `--surface` and `--card` panels tangible depth over `--bg` (`#0b1220`) without muddy blur or extra borders.

Two other low-effort CSS fixes matter especially for a data app. Right now `.stat`, `table`, and `.kit-meta` rely on Space Grotesk and Inter without locking digit widths across every numeric readout. Setting `font-variant-numeric: tabular-nums` stops numbers like `1` and `8` from shifting sideways when animated counters or sorted columns update. On top of that, clickable `.kit` buttons on the pitch, `.week-card` buttons in `Planner.tsx`, and `.btn` actions currently lack hover elevation or transition timing.

### Visual tokens and elevation layer

Add these tokens and rules to `web/app/globals.css`. They keep the existing `#0b1220` and `#b7f34a` palette intact while adding specular edges, radial glow tokens, smooth transitions, and keyboard-accessible `:focus-visible` outlines.

```css
/* Upgrade layer for web/app/globals.css.
   Place these custom properties inside :root and merge the rules below. */
:root {
  /* Motion timing curves: crisp start, smooth settle. */
  --ease-out-quart: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring-soft: cubic-bezier(0.34, 1.4, 0.64, 1);
  --dur-fast: 140ms;
  --dur-med: 240ms;

  /* Surface lighting and focus rings. */
  --edge-light: rgba(255, 255, 255, 0.065);
  --edge-lime: rgba(183, 243, 74, 0.28);
  --accent-glow: rgba(183, 243, 74, 0.14);
  --warn-glow: rgba(255, 162, 76, 0.16);
  --shadow-card: inset 0 1px 0 var(--edge-light), 0 10px 28px -12px rgba(3, 6, 14, 0.72);
  --shadow-lift: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 14px 32px -10px rgba(3, 6, 14, 0.85);
}

/* Lock number widths so animated values and tables never jitter horizontally. */
.num,
.stat b,
.big,
.kit-meta b,
.summary-grid b,
table td,
.chip-card-stats b {
  font-variant-numeric: tabular-nums;
}

/* Give panels physical thickness and a gentle hover response when interactive. */
.card {
  background: linear-gradient(180deg, rgba(22, 33, 58, 0.32) 0%, rgba(17, 26, 46, 0.96) 100%);
  box-shadow: var(--shadow-card);
  transition: border-color var(--dur-fast) var(--ease-out-quart), box-shadow var(--dur-med) var(--ease-out-quart);
}

/* Subtle lime bloom behind the recommended transfer card on the Dashboard. */
.card.highlight {
  background:
    radial-gradient(120% 90% at 10% 0%, var(--accent-glow) 0%, transparent 60%),
    var(--card);
  border-color: rgba(183, 243, 74, 0.55);
  box-shadow: inset 0 1px 0 var(--edge-lime), 0 12px 30px -12px rgba(183, 243, 74, 0.18);
}

/* Tactile button and card-button interactions. */
.btn,
.week-card,
.nav-link {
  transition:
    transform var(--dur-fast) var(--ease-out-quart),
    background-color var(--dur-fast) var(--ease-out-quart),
    border-color var(--dur-fast) var(--ease-out-quart),
    color var(--dur-fast) var(--ease-out-quart);
}

.btn:hover:not(:disabled) {
  border-color: #3a4c73;
  background: rgba(255, 255, 255, 0.04);
}

.btn.primary:hover:not(:disabled) {
  background: #c8fa6b;
  transform: translateY(-1px);
}

.btn:active:not(:disabled) {
  transform: scale(0.98);
}

.week-card:hover {
  border-color: #3a4c73;
  transform: translateY(-2px);
}

/* Clear keyboard focus ring that matches the lime accent. */
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .btn,
  .week-card,
  .nav-link,
  .card {
    transition: none;
  }
}
```

Trade-off note: using `linear-gradient` and `inset` box-shadows adds virtually zero rendering cost, because they paint once per surface rather than animating every frame. Just avoid animating `box-shadow` directly on scroll or drag; transition `transform` and `opacity` instead.

---

## 3. Upgrading the pitch and player kits

The pitch in `web/components/Pitch.tsx` is where you spend the most mental energy deciding captaincy and transfers. Right now it is a flat rectangle with alternating green CSS stripes and empty squares. Two focused upgrades change its presence completely: faint pitch markings in the background and SVG jerseys styled with each club's colors.

### Pitch geometry SVG overlay

Rather than using heavy bitmap textures, place a lightweight, pointer-events-disabled SVG layer behind `.pitch-row`. Keep the markings low contrast (`rgba(207, 232, 214, 0.14)`) so player names and xP figures remain effortless to read. Adding a radial stadium spotlight gradient over the stripes gives natural depth toward the center of the field.

First, update `.pitch` in `web/app/globals.css` so it acts as a positioning context (`position: relative; overflow: hidden;`) and layers the vignette over `--pitch-a` and `--pitch-b`:

```css
.pitch {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  padding: 24px 10px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  border: 1px solid #235536;
  background:
    radial-gradient(85% 60% at 50% 45%, rgba(183, 243, 74, 0.06) 0%, transparent 70%),
    repeating-linear-gradient(180deg, var(--pitch-a) 0 64px, var(--pitch-b) 64px 128px);
  box-shadow: inset 0 1px 0 rgba(207, 232, 214, 0.08), inset 0 0 40px rgba(7, 17, 11, 0.45);
}

.pitch-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

.pitch-row {
  position: relative;
  z-index: 1;
}
```

Then render `<PitchLines />` inside `<div className="pitch">` in `web/components/Pitch.tsx`. Using `preserveAspectRatio="none"` is fine for the outer touchline and boxes, or you can use standard proportional SVG coordinates (`viewBox="0 0 600 440"`) with `preserveAspectRatio="xMidYMid slice"` so the center circle stays round regardless of window width:

```tsx
// Renders subtle penalty box, halfway line, and center circle markings
// behind the players. Purely decorative, so hidden from screen readers.
function PitchLines() {
  const strokeColor = "rgba(207, 232, 214, 0.14)";
  return (
    <svg
      className="pitch-lines"
      viewBox="0 0 600 440"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      {/* Outer field boundary */}
      <rect x="20" y="16" width="560" height="408" rx="6" stroke={strokeColor} strokeWidth="1.5" />
      {/* Top goalkeeper penalty area and 6-yard box */}
      <rect x="170" y="16" width="260" height="84" stroke={strokeColor} strokeWidth="1.5" />
      <rect x="235" y="16" width="130" height="32" stroke={strokeColor} strokeWidth="1.5" />
      {/* Penalty arc */}
      <path d="M 250 100 A 62 62 0 0 0 350 100" stroke={strokeColor} strokeWidth="1.5" />
      {/* Halfway line and center circle */}
      <line x1="20" y1="228" x2="580" y2="228" stroke={strokeColor} strokeWidth="1.5" />
      <circle cx="300" cy="228" r="54" stroke={strokeColor} strokeWidth="1.5" />
      <circle cx="300" cy="228" r="3" fill={strokeColor} />
    </svg>
  );
}
```

### Club kit SVG component

Instead of an empty `.kit-shirt` square, draw a real jersey SVG colored by the player's 3-letter club code (`player.team`, such as `ARS`, `MCI`, `CHE`). Keeping the kit colors in one small lookup table avoids extra API requests or third-party image URLs that break offline or in demo mode.

Notice the error handling here: if a newly promoted club enters the Premier League with a code missing from `CLUB_KITS`, `getClubKit` returns a safe slate-and-lime fallback instead of crashing or returning `undefined`.

Create `web/components/ClubKit.tsx`:

```tsx
// Renders a flat vector football shirt colored by Premier League club code.
// Uses a safe fallback palette if a club code is missing from the table.

interface KitPalette {
  body: string;
  sleeves: string;
  trim: string;
}

const DEFAULT_KIT: KitPalette = {
  body: "#233252",
  sleeves: "#1a2640",
  trim: "#b7f34a",
};

const CLUB_KITS: Record<string, KitPalette> = {
  ARS: { body: "#dc2626", sleeves: "#f3f4f6", trim: "#f3f4f6" },
  AVL: { body: "#6d1d3a", sleeves: "#8cc6ec", trim: "#8cc6ec" },
  BOU: { body: "#b91c1c", sleeves: "#111827", trim: "#e5e7eb" },
  BRE: { body: "#dc2626", sleeves: "#dc2626", trim: "#ffffff" },
  BHA: { body: "#1d5fd6", sleeves: "#1d5fd6", trim: "#ffffff" },
  BUR: { body: "#6c1d45", sleeves: "#99d6ea", trim: "#fde047" },
  CHE: { body: "#1e40af", sleeves: "#1e40af", trim: "#93c5fd" },
  CRY: { body: "#1d4ed8", sleeves: "#b91c1c", trim: "#facc15" },
  EVE: { body: "#1e3a8a", sleeves: "#1e3a8a", trim: "#ffffff" },
  FUL: { body: "#f3f4f6", sleeves: "#f3f4f6", trim: "#111827" },
  LEE: { body: "#f8fafc", sleeves: "#f8fafc", trim: "#eab308" },
  LIV: { body: "#c8102e", sleeves: "#c8102e", trim: "#fef2f2" },
  MCI: { body: "#6cabdd", sleeves: "#6cabdd", trim: "#ffffff" },
  MUN: { body: "#da291c", sleeves: "#da291c", trim: "#111827" },
  NEW: { body: "#1f2937", sleeves: "#111827", trim: "#f9fafb" },
  NFO: { body: "#dd1e26", sleeves: "#dd1e26", trim: "#ffffff" },
  SUN: { body: "#dc2626", sleeves: "#ffffff", trim: "#111827" },
  TOT: { body: "#f8fafc", sleeves: "#f8fafc", trim: "#1e293b" },
  WHU: { body: "#7a263a", sleeves: "#2daef0", trim: "#2daef0" },
  WOL: { body: "#f59e0b", sleeves: "#f59e0b", trim: "#111827" },
};

// Looks up a club's kit colors and falls back cleanly for unknown codes.
function getClubKit(clubCode: string): KitPalette {
  return CLUB_KITS[clubCode.toUpperCase()] ?? DEFAULT_KIT;
}

export function ClubKit({ clubCode, isGoalkeeper = false }: { clubCode: string; isGoalkeeper?: boolean }) {
  const palette = getClubKit(clubCode);
  // Goalkeepers use a distinct collar trim so they stand apart if they share a club.
  const bodyColor = isGoalkeeper ? "#16a34a" : palette.body;
  const sleeveColor = isGoalkeeper ? "#15803d" : palette.sleeves;
  const trimColor = isGoalkeeper ? "#dcfce7" : palette.trim;

  return (
    <svg width="42" height="40" viewBox="0 0 64 60" fill="none" aria-hidden="true">
      {/* Left and right sleeves */}
      <path d="M18 8 L4 18 L10 31 L18 26 Z" fill={sleeveColor} stroke="#0b1220" strokeOpacity="0.45" strokeWidth="1.5" />
      <path d="M46 8 L60 18 L54 31 L46 26 Z" fill={sleeveColor} stroke="#0b1220" strokeOpacity="0.45" strokeWidth="1.5" />
      {/* Shirt torso */}
      <path
        d="M18 8 L24 6 Q32 13 40 6 L46 8 L47 54 Q32 56 17 54 Z"
        fill={bodyColor}
        stroke="#0b1220"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      {/* Collar trim */}
      <path d="M24 6 Q32 14 40 6" stroke={trimColor} strokeWidth="2.5" strokeLinecap="round" />
      {/* Subtle vertical chest shading for depth */}
      <path d="M32 12 V54" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="10" />
    </svg>
  );
}
```

To wire it into `web/components/Pitch.tsx`, place `<ClubKit clubCode={player.team} isGoalkeeper={player.position === "GK"} />` inside `.kit-shirt` and center it with `display: flex; align-items: center; justify-content: center;`.

One visual temptation to skip: a heavy 2.5D CSS tilt like `transform: perspective(900px) rotateX(12deg)` on `.pitch`. While steep perspective looks dramatic in screenshots, it shrinks the goalkeeper's click area at the top of the pitch and blurs small 12px player labels on non-Retina external monitors. If you want mild depth, cap it at `rotateX(3deg)` and keep the player rows unskewed, or rely on the radial spotlight vignette above.

### Interactive kit states

Once players have crisp kits, their interactive states should communicate selection immediately. On hover, lift the shirt slightly with a spring curve (`--ease-spring-soft`). In `Planner.tsx`, when `selectedId` matches a player, give that shirt a subtle pulsing orange ring so Clement never loses track of who he is about to sell while scanning the replacement table on the right. When a new transfer arrives (`incoming`), pop the border in lime.

```css
.kit {
  transition: transform var(--dur-fast) var(--ease-spring-soft);
}

.kit:not(:disabled):hover {
  transform: translateY(-3px);
}

.kit:not(:disabled):hover .kit-shirt {
  border-color: rgba(232, 237, 247, 0.45);
}

.kit-shirt {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--dur-fast) ease, box-shadow var(--dur-med) ease;
}

/* Pulses gently when a player is selected for replacement in the Planner. */
.kit.selected .kit-shirt {
  border-color: var(--warn);
  box-shadow: 0 0 0 4px var(--warn-glow);
  animation: kit-pulse 1.8s ease-in-out infinite;
}

.kit.incoming .kit-shirt {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-glow);
}

@keyframes kit-pulse {
  0%, 100% { box-shadow: 0 0 0 3px var(--warn-glow); }
  50% { box-shadow: 0 0 0 7px rgba(255, 162, 76, 0.04); }
}

@media (prefers-reduced-motion: reduce) {
  .kit,
  .kit-shirt {
    transition: none;
  }
  .kit.selected .kit-shirt {
    animation: none;
  }
}
```

---

## 4. Motion architecture: native CSS first, then Motion for React

Good motion graphics in a stats tool serve a single purpose: orienting the user when state changes. If an animation slows down clicking or obscures numbers, delete it. Keep durations short (140ms to 320ms) and save longer curves for deliberate transitions like sliding out the player panel.

### Timing curves and compositor safety

Browsers split rendering into layout, paint, and composite steps. Animating `width`, `height`, `top`, or `left` forces the browser to recalculate layout on every frame, which causes stutters on large tables. Animating `transform` (translate, scale) and `opacity` stays on the GPU compositor thread, keeping updates smooth at 60Hz or 120Hz (such as MacBook ProMotion displays).

That is why, for example, the xG/xA bars in `PlayerPanel.tsx` should animate with `transform: scaleY(...)` instead of animating `height`. Similarly, progress bars in `PriceWatchView.tsx` can animate `transform: scaleX(...)` from `transform-origin: left` once on mount.

Always wrap non-essential motion in `@media (prefers-reduced-motion: reduce)` or check `window.matchMedia("(prefers-reduced-motion: reduce)").matches` in JavaScript hooks. Users who disable motion at the macOS System Settings level get instant state updates automatically.

### When to install the Motion package

Native CSS handles hover states, keyframe entrances, and simple transitions with zero extra bundle weight. However, two common React UI problems are awkward in plain CSS.

First, exit animations: when React removes a component from JSX (`openId !== null && <PlayerPanel />`), the DOM node disappears immediately before a closing CSS animation can play. Second, FLIP layout transitions (First, Last, Invert, Play): when 20 clubs in `FixtureTickerTable.tsx` change row order after clicking "For defenders", React moves the `<tr>` elements in the DOM. Measuring old positions, comparing them to new positions, and smoothly gliding every row to its new rank in pure CSS takes dozens of lines of manual `getBoundingClientRect` code.

The `motion` package (`npm install motion` in `web/`, imported from `"motion/react"`) supports React 19 cleanly and solves both problems with `<AnimatePresence>` and the `layout` prop. Wrapping the app root in `<MotionConfig reducedMotion="user">` inside `web/components/PlayerPanel.tsx` or `web/app/layout.tsx` also makes every Motion animation honor the user's macOS reduced-motion setting automatically.

Here is the practical trade-off: adding `motion` increases client JavaScript bundle size by roughly 18KB to 30KB gzipped depending on which components import it (and you can use `<LazyMotion>` later to trim that further). If you want zero dependencies first, you can build Recipes 2 and 5 and the CSS parts of Recipes 1 and 3 right now, then install `motion` when you are ready for Recipes 1, 3, and 4 at full polish.

---

## 5. Five concrete motion recipes for SquadSense

Each recipe below starts with the idea, notes the simpler native option where one exists, and provides clean code tailored to SquadSense's actual component names and data types.

### Recipe 1: Sliding pill indicator for segmented controls and sidebar navigation

Right now, clicking `"For defenders"` in `FixtureTickerTable.tsx`, switching filters in `PriceWatchView.tsx`, or clicking a page in `Sidebar.tsx` snaps the highlighted background from one button to another. Sliding the active pill across the control turns a binary cut into clear spatial feedback.

The simpler CSS-only option uses `transform: translateX(...)` on an indicator element when the tab buttons have fixed equal widths. That breaks as soon as tab labels vary in width (like `"All"` vs `"Watchlist"` in `PriceWatchView.tsx`). With `motion/react`, passing a shared `layoutId` to a `<motion.span>` automatically measures the button's exact width and position and slides the lime pill smoothly between them.

Create a reusable `web/components/SegmentedControl.tsx` that both `FixtureTickerTable.tsx` and `PriceWatchView.tsx` can use:

```tsx
"use client";

// A segmented pill toggle where the lime active background glides smoothly
// between options of any width using Motion's shared layoutId.

import { motion } from "motion/react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string | number> {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (nextValue: T) => void;
  layoutGroup: string;
}

export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  layoutGroup,
}: SegmentedControlProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            className="segmented-btn"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            style={{ position: "relative", background: "transparent" }}
          >
            {isActive && (
              <motion.span
                layoutId={layoutGroup}
                aria-hidden="true"
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 8,
                  background: "var(--accent)",
                  zIndex: 0,
                }}
              />
            )}
            <span
              style={{
                position: "relative",
                zIndex: 1,
                color: isActive ? "var(--bg)" : "var(--muted)",
                transition: "color 140ms ease",
              }}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

Apply the same `layoutId="sidebar-active-pill"` pattern to the active `Link` in `web/components/Sidebar.tsx`, and page navigation down the left rail will feel tactile. Remember two details here: pass a unique `layoutGroup` string (like `"ticker-mode"` and `"ticker-window"`) whenever two `SegmentedControl` components appear on the same page so a click in one toolbar does not fly the pill across the screen to the other toolbar, and remove or override the existing `.segmented button[aria-pressed="true"] { background: var(--accent); }` rule in `web/app/globals.css` so the static background does not snap ahead of the sliding pill.

### Recipe 2: Animated number counter for xP, bank, and plan totals

When Clement clicks a replacement in `Planner.tsx`, `totalScore`, `weekPlan.expectedPoints`, and `weekPlan.bankAfter` jump immediately. Tweening those numbers smoothly over 280ms draws the eye directly to the impact of a move (`+18.2 xP` vs `+19.6 xP`), and requires zero third-party packages.

How it works: store the current displayed value in React state and track the active animation in a `requestAnimationFrame` loop. On each frame, compute normalized progress `t` from `0` to `1`, apply a cubic ease-out curve (`1 - (1 - t)^3`), and interpolate between the previous displayed number and the new target.

Notice three safety guards in `web/components/AnimatedNumber.tsx`:
1. Guard `window.matchMedia` inside `useEffect`, because Next.js runs Client Components once on the server during initial SSR where `window` does not exist.
2. Track `currentRef.current` so if Clement clicks three players quickly in a row, each new tween starts smoothly from wherever the number currently sits mid-animation rather than snapping back to zero.
3. Validate `Number.isFinite(target)` explicitly so bad data logs a warning instead of propagating `NaN` across animation frames.

```tsx
"use client";

// Smoothly interpolates a numeric value with requestAnimationFrame so xP,
// bank, and gain readouts count cleanly toward their new value.

import { useEffect, useRef, useState } from "react";

// Eases out fast at the start and slows gently into the final digit.
function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

// Hooks into browser frames to animate from the current displayed number
// to `target` over `durationMs`, cancelling cleanly on rapid updates.
export function useAnimatedNumber(target: number, durationMs = 280): number {
  const [displayValue, setDisplayValue] = useState(target);
  const currentRef = useRef(target);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      console.warn("useAnimatedNumber received a non-finite target:", target);
      return;
    }

    const startValue = currentRef.current;
    if (startValue === target) return;

    // Respect macOS / browser reduced-motion preference immediately.
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion || durationMs <= 0) {
      currentRef.current = target;
      setDisplayValue(target);
      return;
    }

    let frameId = 0;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const nextValue = startValue + (target - startValue) * easeOutCubic(progress);

      currentRef.current = nextValue;
      setDisplayValue(nextValue);

      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      }
    }

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [target, durationMs]);

  return displayValue;
}

interface AnimatedNumberProps {
  value: number;
  format: (num: number) => string;
  durationMs?: number;
  className?: string;
}

export function AnimatedNumber({ value, format, durationMs = 280, className }: AnimatedNumberProps) {
  const animated = useAnimatedNumber(value, durationMs);
  return <span className={className ? `num ${className}` : "num"}>{format(animated)}</span>;
}
```

Use `<AnimatedNumber value={totalScore - baselineScore} format={formatGain} />` in `Planner.tsx` for the `"Whole plan vs making no moves"` readout, `"Bank after"`, and the GW card xP numbers. Because `formatPrice` in `web/lib/format.ts` expects integer tenths (`145` for `£14.5m`), wrap `formatPrice(Math.round(num))` inside the `format` callback so intermediate decimals do not format oddly.

### Recipe 3: Enter and exit motion plus staggered chart bars in PlayerPanel

Currently `PlayerPanelProvider` in `web/components/PlayerPanel.tsx` renders:

```tsx
{openId !== null && <PlayerPanel key={openId} playerId={openId} onClose={() => setOpenId(null)} />}
```

Two fixes upgrade this drawer dramatically.

First, wrap the conditional render inside `<AnimatePresence>` from `motion/react` so the backdrop fades out and the panel slides off to the right when dismissed, instead of popping out of existence. (A simpler native CSS alternative uses the newer `@starting-style` rule with `transition-behavior: allow-discrete` on a `<dialog>` element, though `<AnimatePresence>` works reliably across all browsers and integrates cleanly with React state.)

Second, upgrade what happens inside the panel while loading and once data arrives:
- Replace `<p className="muted">Loading...</p>` with a skeleton layout matching the 4 stat tiles and 6 chart bars so the drawer height does not jump when `/api/players/[id]` resolves.
- Animate the stacked `xG` and `xA` bars in `RecentChart` so each bar grows upward from `scaleY(0)` with a 35ms stagger per gameweek (`delay: index * 0.035`). Note that because `scaleY` runs on the GPU compositor thread, the bars animate smoothly even while the panel itself is settling.

Here is the upgraded `PlayerPanelProvider` and `RecentChart` pattern for `web/components/PlayerPanel.tsx`:

```tsx
import { AnimatePresence, motion } from "motion/react";

// Inside PlayerPanelProvider:
// AnimatePresence keeps PlayerPanel mounted until its exit transition finishes.
export function PlayerPanelProvider({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <PanelContext.Provider value={setOpenId}>
      {children}
      <AnimatePresence>
        {openId !== null && (
          <PlayerPanel key={openId} playerId={openId} onClose={() => setOpenId(null)} />
        )}
      </AnimatePresence>
    </PanelContext.Provider>
  );
}
```

Inside `PlayerPanel`, wrap the backdrop and drawer in a single non-animated container `<div className="panel-root">` (or place explicit keys on separate direct children of `AnimatePresence`) so `AnimatePresence` reliably delays unmount until both the fade and slide exit animations finish, and remove the CSS `animation: panel-in` rule in `globals.css` so it does not compete with Motion:

```tsx
<div className="panel-root">
  <motion.div
    className="panel-backdrop"
    aria-hidden="true"
    onClick={onClose}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.18 }}
  />
  <motion.aside
    className="player-panel"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    initial={{ x: "100%", opacity: 0.6 }}
    animate={{ x: 0, opacity: 1 }}
    exit={{ x: "100%", opacity: 0 }}
    transition={{ type: "spring", stiffness: 380, damping: 36 }}
  >
    {/* Panel header and body */}
  </motion.aside>
</div>
```

For the loading skeleton and staggered `RecentChart` bars:

```tsx
// Skeleton placeholder matching the 4 stat tiles and chart box height
// so the panel never jumps when player data finishes loading.
function PanelSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }} aria-busy="true" aria-label="Loading player stats">
      <div className="panel-tiles">
        {[0, 1, 2, 3].map((slot) => (
          <div key={slot} className="panel-tile skeleton-shimmer" style={{ height: 64 }} />
        ))}
      </div>
      <div className="skeleton-shimmer" style={{ height: 180, borderRadius: 14 }} />
      <div className="skeleton-shimmer" style={{ height: 72, borderRadius: 12 }} />
    </div>
  );
}

// Inside RecentChart: grow xG and xA bars upward with a 35ms stagger per week.
<div className="recent-chart">
  {detail.recent.map((week, index) => (
    <div key={week.gameweek} className="recent-week" title={`${week.minutes} minutes, ${week.xg} xG, ${week.xa} xA`}>
      <span className="recent-points">{week.points} pts</span>
      <div className="recent-bar" style={{ height: BAR_HEIGHT }}>
        <motion.div
          className="bar xa"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.32, delay: 0.08 + index * 0.035, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: (week.xa / scale) * BAR_HEIGHT, transformOrigin: "bottom" }}
        />
        <motion.div
          className="bar xg"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.32, delay: 0.05 + index * 0.035, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: (week.xg / scale) * BAR_HEIGHT, transformOrigin: "bottom" }}
        />
      </div>
      <span className="muted small">GW{week.gameweek}</span>
    </div>
  ))}
</div>
```

Add the `.skeleton-shimmer` CSS class to `web/app/globals.css`:

```css
.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    var(--card) 25%,
    rgba(38, 50, 77, 0.75) 50%,
    var(--card) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-shimmer {
    animation: none;
  }
}
```

### Recipe 4: FLIP row reordering in FixtureTickerTable

In `web/components/FixtureTickerTable.tsx`, toggling between `"For attackers"` and `"For defenders"` or switching between 3, 5, and 8 gameweek windows re-sorts `rankedTeams`. Watching Arsenal jump from row 6 to row 1 or Man City slide down three places in real time gives you immediate intuition for which clubs swing across attacking vs defensive metrics.

Notice a key detail: use `layout="position"` on `<motion.tr>`, not bare `layout`. Using bare `layout` on HTML table rows can distort cell widths during mid-animation scale transforms when columns change text length. `layout="position"` animates only the vertical Y translation while preserving exact table column alignment.

```tsx
// Inside web/components/FixtureTickerTable.tsx
import { motion } from "motion/react";

// Replace the plain <tbody> rows with motion.tr keyed by team.id:
<tbody>
  {rankedTeams.map((team) => (
    <motion.tr
      key={team.id}
      layout="position"
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      className={myTeamIds.includes(team.id) ? "mine" : undefined}
    >
      <th scope="row">{team.name}</th>
      {shownWeeks.map((week) => (
        <td key={week}>
          <WeekCell matches={team.matches[String(week)] ?? []} mode={mode} />
        </td>
      ))}
      <td className="right score">{score(team).toFixed(1)}</td>
    </motion.tr>
  ))}
</tbody>
```

To keep `"Highlight my teams"` smooth too, add `transition: opacity 200ms var(--ease-out-quart);` to `table.ticker tbody tr` in `web/app/globals.css` so non-owned teams fade down smoothly to `0.3` instead of blinking.

### Recipe 5: Transfer swap choreography in Planner and urgency pulse in PriceWatchView

Two targeted micro-interactions finish off the remaining core views.

In `web/components/Planner.tsx`, when Clement clicks a player to open `"Replace {outPlayer.name}"` and adds a move, the move list (`weekMoves`) grows and the incoming player's shirt gets the `.incoming` class on the pitch. Wrapping the replacement panel swap in `<AnimatePresence mode="wait">` crossfades cleanly between `"Suggested moves"` and `"Replace {outPlayer.name}"`, while giving each `.move` pill a quick slide-in entrance when added and slide-out when undone.

```tsx
// Inside web/components/Planner.tsx for the active moves list:
<AnimatePresence initial={false}>
  {weekMoves.map((move) => (
    <motion.div
      className="move"
      key={`${move.outId}-${move.inId}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="grow">
        {players[move.outId].name} → {players[move.inId].name}
      </span>
      <button type="button" className="btn" onClick={() => removeMove(move)}>
        Undo
      </button>
    </motion.div>
  ))}
</AnimatePresence>
```

In `web/components/PriceWatchView.tsx`, the 00:00 UK price change deadline is urgent only when a player is right on the threshold (`Math.abs(row.progress) >= 95`). Add a `.imminent` class to `.progress` for those rows and apply a subtle CSS glow pulse to `.progress-fill` so tonight's likely risers and fallers catch the eye immediately without adding noise to the rest of the 50-row table.

```css
/* In web/app/globals.css: pulse only players >= 95% of the way to a price change. */
.progress.imminent.rise .progress-fill {
  animation: pulse-lime 2s ease-in-out infinite;
}

.progress.imminent.fall .progress-fill {
  animation: pulse-warn 2s ease-in-out infinite;
}

@keyframes pulse-lime {
  0%, 100% { box-shadow: 0 0 0 0 rgba(183, 243, 74, 0.45); }
  50% { box-shadow: 0 0 10px 1px rgba(183, 243, 74, 0.55); }
}

@keyframes pulse-warn {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 162, 76, 0.45); }
  50% { box-shadow: 0 0 10px 1px rgba(255, 162, 76, 0.55); }
}

@media (prefers-reduced-motion: reduce) {
  .progress.imminent.rise .progress-fill,
  .progress.imminent.fall .progress-fill {
    animation: none;
  }
}
```

And in `web/app/chips/page.tsx`, adding a CSS hover lift (`transform: translateY(-2px)`) and brighter outline to `.chip-week-box` when hovering available future gameweeks gives the 38-week strip a clean interactive feel even while `ChipsPage` stays a fast Server Component.

---

## 6. Practical build order and verification

Do not refactor all six pages in one pass. Ship these upgrades in four small, testable steps so any layout bug is trivial to isolate.

Phase 1 (zero new dependencies, CSS and SVG only):
1. Add the surface depth tokens, `tabular-nums`, button transitions, and `:focus-visible` outlines to `web/app/globals.css`.
2. Add `<PitchLines />` and `web/components/ClubKit.tsx`, wire them into `web/components/Pitch.tsx`, and add the `.kit.selected` pulse animation.
3. Add 20px inline SVG icons to `web/components/Sidebar.tsx` matching `docs/design/desktop/Desktop-Dashboard.dc.html`.

Phase 2 (zero-dependency React motion):
1. Build `web/components/AnimatedNumber.tsx` and wire it into `web/components/Planner.tsx` for Team xP, Bank after, and Plan Gain.
2. Add the `.imminent` pulse class in `web/components/PriceWatchView.tsx` for rows with `Math.abs(row.progress) >= 95`.

Phase 3 (install `motion` for layout choreography):
1. Run `npm install motion` inside `web/`.
2. Wrap `PlayerPanel` in `<AnimatePresence>`, swap in `PanelSkeleton`, and animate the `RecentChart` bars in `web/components/PlayerPanel.tsx`.
3. Create `web/components/SegmentedControl.tsx` and replace the raw buttons in `web/components/FixtureTickerTable.tsx` and `web/components/PriceWatchView.tsx`.
4. Add `layout="position"` to the `<tr>` rows in `web/components/FixtureTickerTable.tsx` and `<AnimatePresence>` to `weekMoves` in `web/components/Planner.tsx`.

Phase 4 (verify before committing):
1. From `web/`, run `npm run typecheck` and `npm run build` to confirm TypeScript types and Next.js production bundling succeed cleanly.
2. Open the site locally (`npm run dev`), toggle System Settings -> Accessibility -> Display -> Reduce motion on macOS, and verify every transition respects `prefers-reduced-motion` without stuck opacity or broken drawer closes.
3. Capture updated desktop screenshots at 1440px wide to compare against `docs/screenshots/dashboard-demo.png` and `docs/screenshots/planner-demo.png`.
