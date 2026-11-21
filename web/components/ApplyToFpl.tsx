"use client";

// "Apply to FPL" on the Planner. Shows exactly what would change on your
// real team (read fresh from FPL), lists anything that blocks it, and only
// sends it after you type the confirm word. Transfers can't be undone.

import { useEffect, useState } from "react";
import type { ApplyPreview, ApplyRequest } from "@/lib/applyPlan";

type Status = { available: boolean; reason: string | null; confirmWord: string };
type Stage =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "preview"; preview: ApplyPreview }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

// Asks the server once whether applying is possible on this copy of the site.
function useApplyStatus(): Status | null {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    fetch("/api/apply")
      .then((response) => response.json())
      .then(setStatus)
      .catch((error: Error) => setStatus({ available: false, reason: `Couldn't check: ${error.message}`, confirmWord: "APPLY" }));
  }, []);
  return status;
}

async function callApply(body: unknown) {
  const response = await fetch("/api/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed with status ${response.status}`);
  return result;
}

export function ApplyToFpl({ plan }: { plan: ApplyRequest }) {
  const status = useApplyStatus();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [typed, setTyped] = useState("");

  if (!status) return null;
  if (!status.available) return <p className="muted apply-note">{status.reason}</p>;

  async function preview() {
    setStage({ kind: "working", message: "Signing in to FPL and reading your team..." });
    try {
      setStage({ kind: "preview", preview: await callApply({ action: "preview", plan }) });
      setTyped("");
    } catch (error) {
      setStage({ kind: "error", message: (error as Error).message });
    }
  }

  async function apply() {
    setStage({ kind: "working", message: "Sending to FPL..." });
    try {
      const result = await callApply({ action: "apply", plan, confirm: typed });
      setStage({ kind: "done", message: `Done: ${result.done.join(" and ")} saved on FPL. Run the sync to see them here.` });
    } catch (error) {
      setStage({ kind: "error", message: (error as Error).message });
    }
  }

  return (
    <div className="apply-box">
      {stage.kind !== "preview" && (
        <button type="button" className="btn" onClick={preview} disabled={stage.kind === "working"}>
          Apply GW{plan.gameweek} to FPL...
        </button>
      )}
      {stage.kind === "working" && <p className="muted apply-note">{stage.message}</p>}
      {stage.kind === "done" && <p className="bc-accent apply-note">{stage.message}</p>}
      {stage.kind === "error" && <p className="bc-warn apply-note">{stage.message}</p>}
      {stage.kind === "preview" && (
        <div className="apply-preview" role="region" aria-label="Changes to send to FPL">
          <b>This will change your real FPL team for GW{plan.gameweek}:</b>
          <ul>{stage.preview.lines.map((line) => <li key={line}>{line}</li>)}</ul>
          <span className="muted">Bank after: £{(stage.preview.bankAfter / 10).toFixed(1)}m. Prices are FPL&apos;s, read just now.</span>
          {(plan.chip === "bboost" || plan.chip === "3xc") && (
            <span className="bc-warn">Playing Bench Boost or Triple Captain this way may not work. If it doesn&apos;t, play it on the FPL site.</span>
          )}
          {stage.preview.problems.length > 0 ? (
            <ul className="bc-warn">{stage.preview.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          ) : (
            <label className="apply-confirm">
              <span>Transfers can&apos;t be undone. Type {status.confirmWord} to confirm.</span>
              <input className="bc-select" value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Confirm word" />
            </label>
          )}
          <div className="apply-actions">
            <button type="button" className="btn primary" disabled={stage.preview.problems.length > 0 || typed !== status.confirmWord} onClick={apply}>
              Send to FPL
            </button>
            <button type="button" className="btn" onClick={() => setStage({ kind: "idle" })}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
