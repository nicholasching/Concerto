"use client";
import type { RefObject } from "react";

// Full-screen calibration surface. The flash renderer paints it directly each frame.
export function CalibrationOverlay({ surface, text, onSkip }: { surface: RefObject<HTMLDivElement | null>; text: RefObject<HTMLParagraphElement | null>; onSkip: () => void }) {
  return <div ref={surface} className="calibration" role="dialog" aria-label="Calibration">
    <p ref={text} className="calibration-text" />
    <button type="button" className="calibration-skip" onClick={onSkip}>Skip calibration</button>
  </div>;
}
