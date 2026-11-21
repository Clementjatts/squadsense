"use client";

// The header's account menu: turn alerts on or off for this device, and
// sign out. Alerts use web push: the browser makes a subscription for
// this device, the site saves it in Supabase (/api/push), and the sync
// job sends alerts to it. On an iPhone this only works once the site has
// been added to the Home Screen, so the menu says so.

import { useEffect, useRef, useState } from "react";

type AlertState =
  | { kind: "checking" }
  | { kind: "unsupported"; reason: string }
  | { kind: "off" }
  | { kind: "on"; endpoint: string }
  | { kind: "blocked" }
  | { kind: "working" }
  | { kind: "error"; message: string };

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// The public key as the bytes the browser's subscribe() call wants.
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

// Why this device can't get alerts, or null if it can.
// We test for push support itself rather than asking whether the page runs
// as a Home Screen app: iPhones only offer push inside a Home Screen app,
// and their answer to the "running as an app" question isn't reliable.
function unsupportedReason(): string | null {
  const canPush = "serviceWorker" in navigator && "PushManager" in window;
  const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!canPush && iPhone) {
    return "On iPhone, alerts only work in the Home Screen app: Share, then Add to Home Screen, with Open as Web App switched on. Open it from that icon (no Safari address bar) and sign in again.";
  }
  if (!canPush) return "This browser can't receive alerts.";
  if (!PUBLIC_KEY) return "Alerts aren't set up on this copy of the site yet.";
  return null;
}

// Works out whether this device already has alerts on.
async function currentState(): Promise<AlertState> {
  const reason = unsupportedReason();
  if (reason) return { kind: "unsupported", reason };
  if (Notification.permission === "denied") return { kind: "blocked" };
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? { kind: "on", endpoint: subscription.endpoint } : { kind: "off" };
}

async function callPush(method: "POST" | "DELETE", body: unknown) {
  const response = await fetch("/api/push", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed with status ${response.status}`);
}

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AlertState>({ kind: "checking" });
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    currentState().then(setState).catch((error: Error) => setState({ kind: "error", message: error.message }));
  }, []);

  // Close the menu on a click outside it or on Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => !menu.current?.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function turnOn() {
    setState({ kind: "working" });
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      if ((await Notification.requestPermission()) !== "granted") return setState({ kind: "blocked" });
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) });
      await callPush("POST", { subscription: subscription.toJSON() });
      setState({ kind: "on", endpoint: subscription.endpoint });
    } catch (error) {
      setState({ kind: "error", message: (error as Error).message });
    }
  }

  async function turnOff(endpoint: string) {
    setState({ kind: "working" });
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      await callPush("DELETE", { endpoint });
      setState({ kind: "off" });
    } catch (error) {
      setState({ kind: "error", message: (error as Error).message });
    }
  }

  return (
    <div className="account-menu" ref={menu}>
      <button type="button" className="topnav-signout account-button" aria-expanded={open} aria-label="Account and alerts" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {state.kind === "on" && <span className="account-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="account-panel" role="dialog" aria-label="Account and alerts">
          <b>Alerts on this device</b>
          <AlertControls state={state} onTurnOn={turnOn} onTurnOff={turnOff} />
          <hr />
          <form method="post" action="/api/logout">
            <button type="submit" className="btn">Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}

// The alerts part of the menu, worded for each state.
function AlertControls({ state, onTurnOn, onTurnOff }: { state: AlertState; onTurnOn: () => void; onTurnOff: (endpoint: string) => void }) {
  switch (state.kind) {
    case "checking":
    case "working":
      return <span className="muted">One moment...</span>;
    case "unsupported":
      return <span className="muted">{state.reason}</span>;
    case "blocked":
      return <span className="muted">Notifications are blocked for this site. Allow them in your browser or phone settings, then reopen this menu.</span>;
    case "error":
      return <span className="bc-warn">{state.message}</span>;
    case "on":
      return (
        <>
          <span className="muted">On: deadline reminders, price drops, injury news, ban risk and plan changes.</span>
          <button type="button" className="btn" onClick={() => onTurnOff(state.endpoint)}>Turn off</button>
        </>
      );
    default:
      return (
        <>
          <span className="muted">Get deadline reminders, price drops, injury news, ban risk and plan changes here.</span>
          <button type="button" className="btn primary" onClick={onTurnOn}>Turn on alerts</button>
        </>
      );
  }
}
