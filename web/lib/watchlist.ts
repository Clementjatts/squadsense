"use client";

// The watchlist, saved in this browser's local storage so it survives a
// reload. Price Watch and the player panel both use it; a small window
// event keeps them in step when both are on screen.

import { useEffect, useState } from "react";

const WATCHLIST_KEY = "squadsense.watchlist";
const CHANGE_EVENT = "squadsense-watchlist-change";

// Reads the saved list. If storage is blocked (private browsing, for
// example) it says so in the console and starts empty.
function readSaved(): number[] {
  try {
    const saved = window.localStorage.getItem(WATCHLIST_KEY);
    return saved ? (JSON.parse(saved) as number[]) : [];
  } catch (error) {
    console.warn("Couldn't read the saved watchlist:", error);
    return [];
  }
}

export function useWatchlist(): [number[], (ids: number[]) => void] {
  const [ids, setIds] = useState<number[]>([]);

  useEffect(() => {
    setIds(readSaved());
    const reload = () => setIds(readSaved());
    window.addEventListener(CHANGE_EVENT, reload);
    return () => window.removeEventListener(CHANGE_EVENT, reload);
  }, []);

  function save(next: number[]) {
    setIds(next);
    try {
      window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn("Couldn't save the watchlist; it will reset when you leave the page:", error);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [ids, save];
}
