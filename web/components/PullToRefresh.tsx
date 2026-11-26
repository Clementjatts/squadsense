"use client";

// Pull down to refresh, for the site saved to an iPhone's Home Screen.
// Safari tabs have this built in, but the Home Screen app loses it, so it
// only switches on there. At the very top of a page, pull down: a spinner
// follows your finger (lib/pullToRefresh.ts does the maths), and letting
// go past the line reloads the page with the latest data. A pull that
// starts inside something already scrolled down, or inside the player
// panel, is left alone.

import { useEffect, useRef, useState } from "react";
import { pullDistance, shouldRefresh } from "@/lib/pullToRefresh";

/** True when the site runs as a Home Screen app rather than in a browser tab. */
function isHomeScreenApp(): boolean {
  // iPhones have reported display-mode "browser" from the Home Screen, so check Safari's own flag too.
  const iosFlag = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosFlag || window.matchMedia("(display-mode: standalone)").matches;
}

/** True when the touch starts somewhere a pull should scroll instead: a scrolled box or a dialog. */
function startsInsideScrolledArea(target: EventTarget | null): boolean {
  for (let node = target as HTMLElement | null; node && node !== document.body; node = node.parentElement) {
    if (node.scrollTop > 0 || node.getAttribute("role") === "dialog") return true;
  }
  return false;
}

export function PullToRefresh() {
  const [enabled, setEnabled] = useState(false);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const current = useRef(0); // the latest distance, read when the finger lifts

  useEffect(() => setEnabled(isHomeScreenApp()), []);

  useEffect(() => {
    if (!enabled) return;
    const onStart = (event: TouchEvent) => {
      const atTop = window.scrollY <= 0;
      startY.current = atTop && event.touches.length === 1 && !startsInsideScrolledArea(event.target) ? event.touches[0].clientY : null;
    };
    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const pulled = pullDistance(event.touches[0].clientY - startY.current);
      if (pulled > 0) event.preventDefault(); // stop the page's own bounce while the spinner follows the finger
      current.current = pulled;
      setDistance(pulled);
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (shouldRefresh(current.current)) {
        setRefreshing(true);
        window.location.reload();
        return;
      }
      current.current = 0;
      setDistance(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  if (!enabled || (distance === 0 && !refreshing)) return null;
  const ready = refreshing || shouldRefresh(distance);
  return (
    <div className="pull-refresh" style={{ transform: `translate(-50%, ${refreshing ? 70 : distance}px)` }} role="status" aria-live="polite">
      <span className={ready ? "pull-refresh-spinner pull-refresh-ready" : "pull-refresh-spinner"} style={{ rotate: `${distance * 3}deg` }} aria-hidden="true" />
      <span className="visually-hidden">{refreshing ? "Refreshing" : ready ? "Let go to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
