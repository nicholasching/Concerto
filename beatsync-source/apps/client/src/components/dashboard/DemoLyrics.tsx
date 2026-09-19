"use client";

import { getCurrentLineIndex, parseLrc, type LrcLine } from "@/lib/lrc";
import { useGlobalStore } from "@/store/global";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const LRC_URL = "/love-me-again.lrc";

export const DemoLyrics = () => {
  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const getPositionRef = useRef(useGlobalStore.getState().getCurrentTrackPosition);
  const [lines, setLines] = useState<LrcLine[]>([]);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const rafRef = useRef<number>(0);
  const lastIdxRef = useRef(-1);

  useEffect(() => {
    return useGlobalStore.subscribe((state) => {
      getPositionRef.current = state.getCurrentTrackPosition;
    });
  }, []);

  useEffect(() => {
    fetch(LRC_URL)
      .then((r) => r.text())
      .then((raw) => setLines(parseLrc(raw)))
      .catch((err) => console.error("Failed to load LRC:", err));
  }, []);

  useEffect(() => {
    if (!isPlaying || lines.length === 0) {
      lastIdxRef.current = -1;
      setCurrentIdx(-1);
      return;
    }

    const tick = () => {
      const pos = getPositionRef.current();
      const idx = getCurrentLineIndex({ lines, timeSeconds: pos });
      if (idx !== lastIdxRef.current) {
        lastIdxRef.current = idx;
        setCurrentIdx(idx);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, lines]);

  if (!isPlaying || currentIdx < 0 || currentIdx >= lines.length) return null;

  const current = lines[currentIdx];
  const next = currentIdx + 1 < lines.length ? lines[currentIdx + 1] : null;

  return (
    <div className="flex items-center justify-center text-center w-full overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIdx}
          className="flex flex-col items-center gap-3"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <p className="text-3xl md:text-5xl font-bold tracking-tight leading-snug text-white whitespace-pre-line">
            {current.text}
          </p>
          {next && currentIdx > 0 && (
            <p className="text-2xl md:text-4xl font-medium tracking-tight leading-snug text-neutral-500 opacity-55 whitespace-pre-line">
              {next.text}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
