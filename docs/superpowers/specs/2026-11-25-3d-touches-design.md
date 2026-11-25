# 3D touches

Approved by Clement on 25 November 2026, after the palette mockup at
https://claude.ai/artifact/RkzPnvL4239oVGLDafr2e4.

## Why

Clement wants the site to feel more immersive and less like a template.
SquadSense is a tool he opens several times a week, and pages were once too
slow, so 3D goes only where depth shows something or shapes a first
impression, and never slows the everyday pages.

## Goals

- A broadcast-angle pitch on the Dashboard, Planner and Review.
- A 3D scene on the account pages (sign in, sign up, forgot and reset password).
- A 3D fixture terrain on the Fixture Ticker.

## Colors

The Signal palette (teal-black, cyan, amber) was built and then dropped the
same evening: Clement preferred the original navy and lime. The 3D work
reads its colors from the CSS tokens, so it follows whichever palette the
site uses.

## Non-goals and anti-goals

- No 3D on any other page, no floating decorations, nothing animating all the time.
- It's a failure if a page gets slower, a player becomes harder to click,
  the form can't be used before the 3D loads, or "Reduce motion" is ignored.

## Approaches

- Pitch: CSS 3D (chosen; no library, no cost) against a WebGL pitch (heavy,
  and the players would stop being normal buttons).
- Account scene and terrain: React Three Fiber, loaded only on those pages
  (chosen) against plain Three.js (more code for the same result) or Spline
  (a hosted scene, outside the repo, harder to recolor).

## What gets built

1. **Pitch.** Only the turf and its lines tilt back (`rotateX`) inside a
   perspective; the player rows stay upright and flat, and rows further back
   are drawn smaller (`lib/pitchDepth.ts`). The captain gets a soft
   spotlight. Phones get a gentler angle.
2. **Account scene.** Eleven glowing dots drift in and settle into the
   Formation dots logo, then turn a little with the mouse. Loaded after the
   form with `next/dynamic` and `ssr: false`. "Reduce motion" shows the
   finished formation without movement; no WebGL shows nothing extra (the
   flat logo is already on the card).
3. **Terrain.** A Table / 3D switch on the Fixture Ticker. One column per
   club and gameweek, height and color from difficulty (attackers or
   defenders, the chosen window, "Highlight my teams"). Hover names the
   match; drag turns it. Wide screens only; the table stays the accessible
   view. Data built by `lib/terrain.ts`.

All 3D colors are read from the CSS tokens (`--accent`, `--line`, `--muted`
and the new `--level-1` to `--level-5`), so a later palette change carries over.

## Left to the builder

Exact tilt angle, dot sizes, camera angles and lighting.
