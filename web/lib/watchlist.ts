"use client";

// The watchlist, saved in Supabase through /api/watchlist so every device
// sees the same players. Price Watch and the player panel both use it; a
// small window event keeps them in step when both are on screen.
//
// When the server can't keep it (Supabase not set up, the table missing,
// or the request failing), the list is kept in this browser's local
// storage as before. The first time the server works again, ids only this
// browser had are added to the server's list and the local copy is removed.

import { useEffect, useState } from "react";
import { cleanIds, mergeIds } from "./watchlistIds";

const WATCHLIST_KEY = "squadsense.watchlist";
const CHANGE_EVENT = "squadsense-watchlist-change";
const API = "/api/watchlist";

// The list every hook on the page shares, and where it is being kept.
let shared: { ids: number[]; onServer: boolean } = { ids: [], onServer: false };
let loading: Promise<void> | null = null;

// Reads the list saved in this browser. If storage is blocked (private
// browsing, for example) it says so in the console and starts empty.
function readLocal(): number[] {
  try {
    const saved = window.localStorage.getItem(WATCHLIST_KEY);
    return saved ? cleanIds(JSON.parse(saved)) ?? [] : [];
  } catch (error) {
    console.warn("Couldn't read the watchlist saved in this browser:", error);
    return [];
  }
}

// Saves the list in this browser, reporting a failure in the console.
function writeLocal(ids: number[]) {
  try {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(ids));
  } catch (error) {
    console.warn("Couldn't save the watchlist; it will reset when you leave the page:", error);
  }
}

// Removes the browser's copy once the server holds everything in it.
function clearLocal() {
  try {
    window.localStorage.removeItem(WATCHLIST_KEY);
  } catch (error) {
    console.warn("Couldn't remove the watchlist saved in this browser:", error);
  }
}

// The server's error message for a refused request, or its status when the body has none.
async function reasonFor(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `HTTP ${response.status}`;
}

// Sends the whole list to the server. Returns true when it was saved there.
async function putServer(ids: number[]): Promise<boolean> {
  try {
    const response = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    if (response.ok) return true;
    console.warn("Couldn't save the watchlist to the server, so it's kept in this browser:", await reasonFor(response));
  } catch (error) {
    console.warn("Couldn't reach the server to save the watchlist, so it's kept in this browser:", error);
  }
  return false;
}

// Asks the server for the list. Returns the ids, or null (with the reason
// in the console) when the browser has to keep the list itself.
async function getServer(): Promise<number[] | null> {
  try {
    const response = await fetch(API, { cache: "no-store" });
    if (response.ok) return cleanIds(((await response.json()) as { ids?: unknown }).ids) ?? [];
    console.warn("Watchlist kept in this browser:", await reasonFor(response));
  } catch (error) {
    console.warn("Couldn't reach the server for the watchlist, so it's kept in this browser:", error);
  }
  return null;
}

// Loads the list from the server, merging in (once) anything only this
// browser had saved, or falls back to the browser's own copy.
async function loadList() {
  const server = await getServer();
  const local = readLocal();
  if (server === null) {
    shared = { ids: local, onServer: false };
    return;
  }
  const merged = mergeIds(server, local);
  if (merged.length > server.length && !(await putServer(merged))) {
    shared = { ids: merged, onServer: false }; // the local copy stays until a save reaches the server
    writeLocal(merged);
    return;
  }
  if (local.length) clearLocal();
  shared = { ids: merged, onServer: true };
}

// Starts one load for every hook mounted at the same time, then tells them all.
function refresh() {
  loading ??= loadList().finally(() => {
    loading = null;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  });
}

// Saves a new list: on screen at once, then on the server (or in this
// browser when the server can't keep it).
async function saveList(next: number[]) {
  shared = { ...shared, ids: next };
  window.dispatchEvent(new Event(CHANGE_EVENT));
  if (shared.onServer && (await putServer(next))) return;
  shared = { ...shared, onServer: false };
  writeLocal(next);
}

/** The watched player ids and a function that replaces the whole list. */
export function useWatchlist(): [number[], (ids: number[]) => void] {
  const [ids, setIds] = useState<number[]>(shared.ids);

  useEffect(() => {
    const update = () => setIds(shared.ids);
    window.addEventListener(CHANGE_EVENT, update);
    refresh();
    return () => window.removeEventListener(CHANGE_EVENT, update);
  }, []);

  return [ids, (next) => void saveList(next)];
}
