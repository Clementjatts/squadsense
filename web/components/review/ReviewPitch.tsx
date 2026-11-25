"use client";

// The Review's pitch: last week's team on the shared Broadcast pitch, each
// player tagged with the points he scored for you (captain doubled, or
// tripled with Triple Captain). The tag is lime when he beat the model's
// forecast and orange when he fell short. Clicking opens his detail panel.

import type { GameweekReview, Player } from "@/lib/types";
import { BroadcastPitch, type PlayerTag } from "../BroadcastPitch";
import { useOpenPlayer } from "../PlayerPanel";

type ReviewTeam = NonNullable<GameweekReview["team"]>;
type ReviewLine = ReviewTeam["starters"][number];

// The points a player earned you: his own points times the captain's multiplier.
function earned(line: ReviewLine, team: ReviewTeam): number {
  if (line.playerId !== team.captain.playerId) return line.points;
  return line.points * (team.chip === "3xc" ? 3 : 2);
}

// The tag for one player: points earned, colored by his own points against his forecast.
function tagFor(line: ReviewLine | undefined, team: ReviewTeam): PlayerTag {
  if (!line) return { text: "-", label: "no points recorded", tone: "plain" };
  const points = earned(line, team);
  const tone = line.xp === null ? "plain" : line.points >= line.xp ? "good" : "short";
  return { text: String(points), label: `${points} points`, tone };
}

export function ReviewPitch({ review, players }: { review: GameweekReview; players: Record<string, Player> }) {
  const openPlayer = useOpenPlayer();
  const team = review.team!;
  const bench = team.bench ?? [];
  const lines = new Map([...team.starters, ...bench].map((line) => [line.playerId, line]));
  const benchCounted = team.chip === "bboost";
  return (
    <BroadcastPitch
      title={`YOUR TEAM IN GW${review.gameweek}`}
      hint="Lime beat his forecast, orange fell short"
      starters={team.starters.map((line) => line.playerId)}
      bench={bench.map((line) => line.playerId)}
      captain={team.captain.playerId}
      viceCaptain={team.viceCaptain ?? -1}
      players={players}
      week={review.gameweek}
      tagFor={(id) => tagFor(lines.get(id), team)}
      benchNote={benchCounted ? "Bench Boost: these points counted" : "Not counted unless a starter missed out"}
      onPlayerClick={openPlayer}
    />
  );
}
