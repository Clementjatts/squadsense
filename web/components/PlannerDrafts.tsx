"use client";

// Saved drafts for the Transfer Planner. usePlannerDrafts restores your
// last draft when the Planner opens and saves it again a second after each
// change. ScenariosCard keeps up to three named drafts side by side, each
// with its five-week total, so two ideas can be compared before you load one.

import { useEffect, useRef, useState } from "react";
import {
  CURRENT_DRAFT, MAX_NAMED_DRAFTS, cleanDraftName, deleteDraft, draftForSnapshot, isEmptyDraft, loadDrafts, saveDraft,
  type DraftStore, type PlannerDraft, type SavedDraft,
} from "@/lib/drafts";
import { formatGain, formatXp } from "@/lib/format";
import { planScore, simulatePlan, type FreeHitSquads } from "@/lib/planning";
import type { Snapshot } from "@/lib/types";

const SAVE_DELAY_MS = 1000;

interface DraftsOptions {
  snapshot: Snapshot;
  current: PlannerDraft;
  onRestore: (draft: PlannerDraft) => void; // called once, with your last draft, when the Planner opens
}

export interface PlannerDrafts {
  store: DraftStore;
  scenarios: SavedDraft[];
  savedAt: string | null; // when the current draft was last saved
  error: string | null;
  saveAs: (name: string) => Promise<boolean>;
  remove: (name: string) => Promise<void>;
}

export function usePlannerDrafts({ snapshot, current, onRestore }: DraftsOptions): PlannerDrafts {
  const [store, setStore] = useState<DraftStore>({ where: "shared", reason: null });
  const [scenarios, setScenarios] = useState<SavedDraft[]>([]);
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoreOnce = useRef(onRestore);

  // Load every draft once. The current draft goes back into the Planner; the named ones become scenarios.
  useEffect(() => {
    let cancelled = false;
    loadDrafts().then(({ store: found, drafts }) => {
      if (cancelled) return;
      setStore(found);
      const last = drafts.find((saved) => saved.name === CURRENT_DRAFT);
      const draft = last ? draftForSnapshot(last.draft, snapshot) : null;
      if (draft && !isEmptyDraft(draft)) restoreOnce.current(draft);
      setScenarios(drafts.filter((saved) => saved.name !== CURRENT_DRAFT));
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  // Save the current draft a moment after each change, but only once the
  // saved one has been restored, so an empty Planner never overwrites it.
  const currentKey = JSON.stringify(current);
  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => {
      saveDraft(CURRENT_DRAFT, JSON.parse(currentKey) as PlannerDraft, store)
        .then((used) => {
          setStore(used);
          setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
        })
        .catch((failure: Error) => setError(failure.message));
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentKey, restored, store]);

  // Saves the current plan as a named scenario. Returns false (with the reason shown) if it was refused.
  async function saveAs(name: string): Promise<boolean> {
    const clean = cleanDraftName(name);
    if (!clean || clean === CURRENT_DRAFT) {
      setError("Give the scenario a name (not \"current\").");
      return false;
    }
    try {
      const used = await saveDraft(clean, current, store);
      setStore(used);
      setScenarios([{ name: clean, draft: current, updatedAt: new Date().toISOString() }, ...scenarios.filter((saved) => saved.name !== clean)]);
      setError(null);
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    }
  }

  // Deletes a named scenario.
  async function remove(name: string): Promise<void> {
    try {
      await deleteDraft(name, store);
      setScenarios(scenarios.filter((saved) => saved.name !== name));
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return { store, scenarios, savedAt, error, saveAs, remove };
}

interface ScenariosCardProps {
  drafts: PlannerDrafts;
  snapshot: Snapshot;
  freeHitSquads: FreeHitSquads;
  currentScore: number;
  onLoad: (draft: PlannerDraft) => void;
}

// Where drafts are kept, a box to name the current plan, and each saved
// scenario with its five-week total against what's planned now.
export function ScenariosCard({ drafts, snapshot, freeHitSquads, currentScore, onLoad }: ScenariosCardProps) {
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null); // scenario waiting for a second "Delete" click
  const full = drafts.scenarios.length >= MAX_NAMED_DRAFTS;

  // A scenario's five-week total and hits, worked out with the same rules as the Planner.
  function scoreOf(draft: PlannerDraft) {
    const fitted = draftForSnapshot(draft, snapshot);
    const plans = simulatePlan(snapshot, fitted.moves, fitted.chips, freeHitSquads, fitted.captains, fitted.lineups);
    return { score: planScore(plans), hits: plans.reduce((sum, plan) => sum + plan.hitPoints, 0), fitted };
  }

  return (
    <section className="card scenarios-card" aria-label="Scenarios">
      <div className="card-head">
        <h2>Scenarios</h2>
        <span className="muted small">
          {drafts.store.where === "shared" ? "Saved on all your devices" : "Saved in this browser only"}
          {drafts.savedAt && ` · ${drafts.savedAt}`}
        </span>
      </div>
      {drafts.store.where === "browser" && drafts.store.reason && <p className="muted small">{drafts.store.reason}</p>}
      <form
        className="scenario-save"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await drafts.saveAs(name)) setName("");
        }}
      >
        <label className="visually-hidden" htmlFor="scenario-name">Scenario name</label>
        <input id="scenario-name" className="bc-select" value={name} maxLength={30} placeholder={full ? `${MAX_NAMED_DRAFTS} saved: delete one first` : "Name this plan, e.g. Roll GW12"} disabled={full} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="btn primary" disabled={full || !cleanDraftName(name)}>Save</button>
      </form>
      {drafts.error && <p className="bc-warn small" role="alert">{drafts.error}</p>}
      {drafts.scenarios.length === 0 ? (
        <p className="muted small">Save up to {MAX_NAMED_DRAFTS} plans to compare their five-week totals here.</p>
      ) : (
        <ul className="list">
          {drafts.scenarios.map((saved) => {
            const { score, hits, fitted } = scoreOf(saved.draft);
            return (
              <li key={saved.name} className="scenario-row">
                <span className="grow">
                  <strong>{saved.name}</strong>
                  <span className="muted small scenario-meta">
                    {formatXp(score)} xP over five weeks · {formatGain(score - currentScore)} against now
                    {hits > 0 && <span className="bc-warn"> · -{hits} hits</span>}
                  </span>
                </span>
                <button type="button" className="btn" onClick={() => onLoad(fitted)}>Load</button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => (confirming === saved.name ? (setConfirming(null), drafts.remove(saved.name)) : setConfirming(saved.name))}
                >
                  {confirming === saved.name ? "Sure?" : "Delete"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
