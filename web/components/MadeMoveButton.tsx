"use client";

// "Done on FPL": tells SquadSense a planned move has been made on the FPL
// site, which hides it until the deadline. Saved through /api/made-moves;
// the sync it starts plans from the squad after the move.

import { useState } from "react";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "done"; note: string } | { kind: "error"; message: string };

const UPDATE_NOTE = "The plan updates in about 5 minutes.";

// Sends the mark (POST) or its undo (DELETE) and returns the server's warning, if any.
async function send(method: "POST" | "DELETE", body: object): Promise<string | null> {
  const response = await fetch("/api/made-moves", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed with status ${response.status}`);
  return result.warning ?? null;
}

export function MadeMoveButton({ gameweek, out, into, marked }: { gameweek: number; out: number; into: number; marked: boolean }) {
  const [status, setStatus] = useState<Status>(marked ? { kind: "done", note: UPDATE_NOTE } : { kind: "idle" });

  async function mark() {
    setStatus({ kind: "saving" });
    try {
      setStatus({ kind: "done", note: (await send("POST", { gameweek, out, in: into })) ?? UPDATE_NOTE });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
    }
  }

  async function undo() {
    setStatus({ kind: "saving" });
    try {
      await send("DELETE", { gameweek, out });
      setStatus({ kind: "idle" });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
    }
  }

  if (status.kind === "done") {
    return (
      <span className="made-move made-move-done">
        <b>Made on FPL</b>
        <button type="button" className="made-move-undo" onClick={undo}>Undo</button>
        <span className="muted">{status.note}</span>
      </span>
    );
  }
  return (
    <span className="made-move">
      <button type="button" className="btn made-move-button" onClick={mark} disabled={status.kind === "saving"}>
        {status.kind === "saving" ? "Saving..." : "Done on FPL"}
      </button>
      {status.kind === "error" && <span className="bc-warn">{status.message}</span>}
    </span>
  );
}
