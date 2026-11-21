"use client";

// ⌘K (Ctrl+K on Windows) player search. Type a name or club, use the
// arrow keys, and Enter opens that player's panel. The player list loads
// the first time search opens, not with every page.

import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";
import { searchPlayers, usePlayerIndex } from "@/lib/playerIndex";
import { useOpenPlayer } from "./PlayerPanel";

export function SearchPalette() {
  const [isOpen, setIsOpen] = useState(false);

  // ⌘K or Ctrl+K toggles search from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button type="button" className="topnav-search" onClick={() => setIsOpen(true)} aria-label="Search players" title="Search players">
        <span aria-hidden="true">⌕</span>
        <kbd>⌘K</kbd>
      </button>
      {isOpen && <SearchDialog onClose={() => setIsOpen(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { players, error } = usePlayerIndex(true);
  const openPlayer = useOpenPlayer();
  const results = searchPlayers(players, query);

  useEffect(() => inputRef.current?.focus(), []);

  function choose(index: number) {
    const player = results[index];
    if (!player) return;
    onClose();
    openPlayer(player.id);
  }

  // Arrow keys move the highlight, Enter opens it, Escape closes search.
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      // Without this, the Enter press also "clicks" the panel's close button once focus moves there.
      event.preventDefault();
      choose(highlighted);
    }
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search players" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search players or clubs"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={onKeyDown}
          aria-label="Player or club name"
        />
        <ul className="search-results" role="listbox">
          {error && <li className="search-empty">Couldn&apos;t load players: {error}</li>}
          {!error && query && results.length === 0 && <li className="search-empty">No players match &quot;{query}&quot;.</li>}
          {results.map((player, index) => (
            <li
              key={player.id}
              role="option"
              aria-selected={index === highlighted}
              className="search-result"
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => choose(index)}
            >
              <span className="search-name">{player.name}</span>
              <span className="muted">{player.team} · {player.position}</span>
              <span className="num">{formatPrice(player.price)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
