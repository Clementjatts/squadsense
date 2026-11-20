"use client";

// Numbers that count smoothly to their new value instead of jumping, so a
// change to xP, bank or plan gain catches the eye. No animation library:
// it steps once per browser frame with requestAnimationFrame.

import { useEffect, useRef, useState } from "react";

// Starts fast and slows into the final value.
function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

// True when the Mac (or browser) is set to reduce motion. Only runs in the
// browser: Next.js also renders this component on the server, where
// `window` doesn't exist.
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Animates from whatever is on screen now to `target` over `durationMs`.
// A new target mid-animation starts from the current in-between value, so
// quick clicks never snap backwards.
export function useAnimatedNumber(target: number, durationMs = 280): number {
  const [displayValue, setDisplayValue] = useState(target);
  const currentRef = useRef(target);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      console.warn("useAnimatedNumber received a value that isn't a finite number:", target);
      return;
    }
    const startValue = currentRef.current;
    if (startValue === target) return;

    if (prefersReducedMotion() || durationMs <= 0) {
      currentRef.current = target;
      setDisplayValue(target);
      return;
    }

    let frameId = 0;
    const startTime = performance.now();
    function step(now: number) {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const nextValue = startValue + (target - startValue) * easeOutCubic(progress);
      currentRef.current = nextValue;
      setDisplayValue(nextValue);
      if (progress < 1) frameId = requestAnimationFrame(step);
    }
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [target, durationMs]);

  return displayValue;
}

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  durationMs?: number;
  className?: string;
}

// Shows `value` through `format`, counting smoothly whenever it changes.
export function AnimatedNumber({ value, format, durationMs = 280, className }: AnimatedNumberProps) {
  const shown = useAnimatedNumber(value, durationMs);
  return <span className={className ? `num ${className}` : "num"}>{format(shown)}</span>;
}
