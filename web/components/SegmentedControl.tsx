"use client";

// A row of toggle buttons where the lime "selected" background slides to
// the option you click. Motion's shared layoutId measures each button, so
// it works with labels of any width ("All" next to "Watchlist").

import { motion } from "motion/react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string | number> {
  label: string; // read out by screen readers for the whole group
  options: SegmentedOption<T>[];
  value: T;
  onChange: (nextValue: T) => void;
  // Unique per control on a page, so a click in one toolbar doesn't send
  // the pill flying across to another.
  layoutGroup: string;
}

export function SegmentedControl<T extends string | number>({ label, options, value, onChange, layoutGroup }: SegmentedControlProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button key={String(option.value)} type="button" className="segmented-btn" aria-pressed={isActive} onClick={() => onChange(option.value)}>
            {isActive && (
              <motion.span
                className="segmented-pill"
                layoutId={layoutGroup}
                aria-hidden="true"
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
              />
            )}
            <span className="segmented-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
