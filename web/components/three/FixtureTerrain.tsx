"use client";

// The Fixture Ticker as a 3D terrain (lib/terrain.ts builds the blocks).
// Clubs run left to right in the table's order, best run on the left, and
// gameweeks run away from you into the future. Tall orange blocks are hard
// weeks, low lime ones easy; a flat tile is a blank. Hover a block to read
// the match, drag sideways to turn the terrain. Loaded only when the 3D
// view is picked (TerrainView.tsx), so the table never waits for Three.js.

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { CanvasTexture, Color, DoubleSide, SRGBColorSpace } from "three";
import type { Terrain, TerrainColumn } from "@/lib/terrain";
import { readToken } from "./sceneHelpers";

const GAP = 1.08; // world units from one block's center to the next
const BLOCK = 0.86; // a block's width and depth
const UNIT_HEIGHT = 0.42; // height per point of difficulty
const BLANK_HEIGHT = 0.05; // a blank week is a thin tile
const DRAG_TURN = 0.006; // radians the terrain turns per pixel dragged
const MAX_TURN = 0.7; // radians either way, so it never turns its back on you

interface FixtureTerrainProps {
  terrain: Terrain;
  highlightMine: boolean; // fade the clubs you don't own players from
}

export default function FixtureTerrain({ terrain, highlightMine }: FixtureTerrainProps) {
  const [hovered, setHovered] = useState<TerrainColumn | null>(null);
  const [turn, setTurn] = useState(0);
  const drag = useRef<number | null>(null); // the pointer's last x while dragging

  const onPointerDown = (event: React.PointerEvent) => {
    drag.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (drag.current === null) return;
    const moved = event.clientX - drag.current;
    drag.current = event.clientX;
    setTurn((current) => Math.max(-MAX_TURN, Math.min(MAX_TURN, current + moved * DRAG_TURN)));
  };
  const endDrag = () => { drag.current = null; };

  return (
    <div className="terrain">
      <p className="terrain-status" aria-hidden="true">
        {hovered ? hovered.label : "Hover a block to see the match. Drag sideways to turn."}
      </p>
      <div className="terrain-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <Canvas
          frameloop="demand"
          dpr={[1, 1.75]}
          camera={{ position: [0, 10, 16.5], fov: 40 }}
          onCreated={({ camera }) => camera.lookAt(0, 0.6, -0.8)}
          gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
          onPointerMissed={() => setHovered(null)}
          aria-hidden="true"
        >
          <ambientLight intensity={0.75} />
          <directionalLight position={[6, 12, 8]} intensity={1.5} />
          <directionalLight position={[-8, 6, -4]} intensity={0.35} />
          <group rotation={[0, turn, 0]}>
            <Blocks terrain={terrain} highlightMine={highlightMine} hovered={hovered} onHover={setHovered} />
            <Labels terrain={terrain} />
          </group>
        </Canvas>
      </div>
    </div>
  );
}

interface BlocksProps extends FixtureTerrainProps {
  hovered: TerrainColumn | null;
  onHover: (column: TerrainColumn | null) => void;
}

// Every club's weeks as blocks, colored by difficulty like the table.
function Blocks({ terrain, highlightMine, hovered, onHover }: BlocksProps) {
  const colors = useMemo(() => levelColors(), []);
  const { teams, weeks } = terrain;
  return (
    <>
      {terrain.columns.map((column) => {
        const height = column.height === 0 ? BLANK_HEIGHT : column.height * UNIT_HEIGHT;
        const [x, z] = gridPosition(column.row, column.col, teams.length, weeks.length);
        const faded = highlightMine && !column.mine;
        const isHovered = hovered === column;
        const over = (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onHover(column); };
        return (
          <mesh key={`${column.teamId}-${column.gameweek}`} position={[x, height / 2, z]} onPointerOver={over} onPointerOut={() => onHover(null)}>
            <boxGeometry args={[BLOCK, height, BLOCK]} />
            <meshStandardMaterial
              color={colors[column.level]}
              emissive={isHovered ? colors[1] : colors[0]}
              emissiveIntensity={isHovered ? 0.6 : 0}
              // Always transparent: three.js can't switch it on later, and the fade comes and goes.
              transparent
              opacity={faded ? 0.18 : 1}
              depthWrite={!faded}
              roughness={0.55}
            />
          </mesh>
        );
      })}
    </>
  );
}

// Club names along the front edge and gameweeks down the left side, standing up to face you.
function Labels({ terrain }: { terrain: Terrain }) {
  const { teams, weeks } = terrain;
  const ink = useMemo(() => readToken("--muted", "#9aa6bf"), []);
  const front = gridPosition(0, -1, teams.length, weeks.length)[1] + 0.1;
  const left = gridPosition(-1, 0, teams.length, weeks.length)[0] - 0.5;
  return (
    <>
      {teams.map((team, row) => (
        <FloorLabel key={team.id} text={team.name} color={ink} position={[gridPosition(row, 0, teams.length, weeks.length)[0], front]} />
      ))}
      {weeks.map((week, col) => (
        <FloorLabel key={week} text={`GW${week}`} color={ink} position={[left, gridPosition(0, col, teams.length, weeks.length)[1]]} />
      ))}
    </>
  );
}

// One short label painted onto a small card, leaning back slightly toward the camera.
function FloorLabel({ text, color, position }: { text: string; color: string; position: [number, number] }) {
  const texture = useMemo(() => labelTexture(text, color), [text, color]);
  return (
    <mesh position={[position[0], 0.32, position[1]]} rotation={[-0.45, 0, 0]}>
      <planeGeometry args={[1.5, 0.62]} />
      <meshBasicMaterial map={texture} transparent side={DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// Where a block sits on the floor: clubs left to right, later gameweeks further away.
function gridPosition(row: number, col: number, teamCount: number, weekCount: number): [number, number] {
  return [(row - (teamCount - 1) / 2) * GAP, -(col - (weekCount - 1) / 2) * GAP];
}

// Colors by level: 0 (a blank) uses the line color, 1 to 5 the ticker's difficulty colors.
function levelColors(): Color[] {
  const blank = new Color(readToken("--line", "#26324d"));
  const levels = [1, 2, 3, 4, 5].map((level) => new Color(readToken(`--level-${level}`, "#3e6267")));
  return [blank, ...levels];
}

// Text drawn on a small canvas, used as a picture on a floor label.
function labelTexture(text: string, color: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 100;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = color;
    context.font = "700 64px 'Barlow Condensed', 'Space Grotesk', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 120, 54);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
