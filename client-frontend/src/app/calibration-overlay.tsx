"use client";
import type { RefObject } from "react";

// Full-screen calibration surface. The flash renderer paints it directly each frame.
export function CalibrationOverlay({ surface, text }: { surface: RefObject<HTMLDivElement | null>; text: RefObject<HTMLParagraphElement | null> }) {
  return <div ref={surface} className="calibration" role="dialog" aria-label="Calibration">
    <p ref={text} className="calibration-text" />
  </div>;
}
