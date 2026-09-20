"use client";
import { ThinkingOrb } from "thinking-orbs";

// Decorative only: readiness and instructions are always conveyed in text.
export function ConcertoOrb({ ready = false, paused = false }: { ready?: boolean; paused?: boolean }) {
  return <div className="concerto-orb" aria-hidden="true">
    <div className="orb-bezel"><div className="orb-screen">
      <ThinkingOrb state={ready ? "listening" : "connecting"} size={64} theme="dark" speed={0.65} paused={paused} />
    </div></div>
  </div>;
}
