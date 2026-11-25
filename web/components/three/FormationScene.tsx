"use client";

// The 3D backdrop of the account pages: eleven glowing dots drift in from
// the dark and settle into the SquadSense formation, laid on the floor like
// a pitch seen from the stand. Afterwards the formation turns a little with
// the mouse. With "Reduce motion" on, the dots start in place and stay still.
// Loaded only on the account pages, after the form (FormationBackdrop.tsx).

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, Color, type Group, type Mesh } from "three";
import { FORMATION_DOTS, PICKED_DOT } from "@/lib/formationDots";
import { readToken } from "./sceneHelpers";

const SETTLE_SECONDS = 2.6; // how long the dots take to reach their places
const SPREAD = 13; // world units across the formation's width, so the wide players show either side of the card
const FLOOR_TILT = -Math.PI / 2; // radians: lays the formation flat on the floor, forwards furthest away
const MOUSE_TURN = 0.22; // radians the formation turns at the screen's edge

interface FormationSceneProps {
  still: boolean; // "Reduce motion" is on
}

export default function FormationScene({ still }: FormationSceneProps) {
  return (
    <Canvas
      className="signin-scene"
      camera={{ position: [0, 11, 9], fov: 50 }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 1.3)}
      dpr={[1, 1.75]}
      frameloop={still ? "demand" : "always"}
      // A still scene draws once, so it keeps that picture rather than letting the browser clear it.
      gl={{ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: still }}
      aria-hidden="true"
    >
      <ambientLight intensity={0.4} />
      <Formation still={still} />
    </Canvas>
  );
}

// The eleven dots, the ring around the picked forward and the mouse turn.
function Formation({ still }: FormationSceneProps) {
  const group = useRef<Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const accent = useMemo(() => new Color(readToken("--accent", "#b7f34a")), []);
  const places = useMemo(() => FORMATION_DOTS.map(toWorld), []);
  const starts = useMemo(() => places.map((_, index) => scatteredStart(index)), [places]);

  // The mouse is read from the window, so the scene never takes clicks from the form.
  useEffect(() => {
    if (still) return;
    const onMove = (event: PointerEvent) => {
      pointer.current = { x: (event.clientX / window.innerWidth) * 2 - 1, y: (event.clientY / window.innerHeight) * 2 - 1 };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [still]);

  // Each frame eases the formation's turn toward the mouse.
  useFrame((_, delta) => {
    const formation = group.current;
    if (!formation || still) return;
    const ease = Math.min(1, delta * 2.5);
    formation.rotation.z += (-pointer.current.x * MOUSE_TURN - formation.rotation.z) * ease;
    formation.rotation.x += (FLOOR_TILT + pointer.current.y * MOUSE_TURN * 0.4 - formation.rotation.x) * ease;
  });

  return (
    <group ref={group} rotation={[FLOOR_TILT, 0, 0]} position={[0, 0, 0]}>
      {places.map((place, index) => (
        <Dot key={index} start={still ? place : starts[index]} place={place} color={accent} delay={index * 0.07} />
      ))}
      <PickedRing place={toWorld(PICKED_DOT)} color={accent} still={still} />
    </group>
  );
}

interface DotProps {
  start: [number, number, number];
  place: [number, number, number];
  color: Color;
  delay: number; // seconds before this dot sets off, so they arrive one after another
}

// One player: a bright core and a soft halo, gliding from its start to its place.
function Dot({ start, place, color, delay }: DotProps) {
  const dot = useRef<Mesh>(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    const mesh = dot.current;
    if (!mesh) return;
    elapsed.current += delta;
    const progress = easeOutCubic(Math.min(1, Math.max(0, (elapsed.current - delay) / SETTLE_SECONDS)));
    mesh.position.set(
      start[0] + (place[0] - start[0]) * progress,
      start[1] + (place[1] - start[1]) * progress,
      start[2] + (place[2] - start[2]) * progress,
    );
  });
  return (
    <mesh ref={dot} position={start}>
      <sphereGeometry args={[0.11, 20, 20]} />
      <meshBasicMaterial color={color} toneMapped={false} />
      <mesh>
        <sphereGeometry args={[0.34, 20, 20]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </mesh>
  );
}

// The circle around the picked forward, which fades in once the dots have settled.
function PickedRing({ place, color, still }: { place: [number, number, number]; color: Color; still: boolean }) {
  const ring = useRef<Mesh>(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    const mesh = ring.current;
    if (!mesh || Array.isArray(mesh.material)) return;
    elapsed.current += delta;
    mesh.material.opacity = still ? 0.9 : Math.min(0.9, Math.max(0, (elapsed.current - SETTLE_SECONDS) / 0.8));
  });
  return (
    <mesh ref={ring} position={place}>
      <torusGeometry args={[0.3, 0.03, 12, 64]} />
      <meshBasicMaterial color={color} transparent opacity={still ? 0.9 : 0} toneMapped={false} />
    </mesh>
  );
}

// A logo dot (64 by 64 grid, goalkeeper at the bottom) as a point on the formation's plane.
function toWorld([x, y]: [number, number]): [number, number, number] {
  const scale = SPREAD / 36; // the dots span 36 grid units across
  return [(x - 32) * scale, (35 - y) * scale, 0];
}

// A fixed, scattered starting point for dot `index`, out in the dark and above the floor.
function scatteredStart(index: number): [number, number, number] {
  const angle = index * 2.39996; // the golden angle spreads the dots evenly around
  const radius = 9 + (index % 3) * 2;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius, 3 + (index % 4)];
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
