"use client";

// Loads the 3D formation behind the account pages' card. The scene's code
// (Three.js) downloads only here, in the browser, after the form is on
// screen, so signing in never waits for it. Without WebGL nothing extra
// shows: the flat logo is already on the card.

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { canUseWebGl, usePrefersReducedMotion } from "./sceneHelpers";

const FormationScene = dynamic(() => import("./FormationScene"), { ssr: false, loading: () => null });

export function FormationBackdrop() {
  const still = usePrefersReducedMotion();
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(canUseWebGl()), []);
  return supported ? <FormationScene still={still} /> : null;
}
