import { useEffect, useRef } from "react";

/**
 * Hook that detects state transitions and calls a callback when the state changes.
 * Useful for implementing middleware-like behavior on state changes.
 *
 * @param trackedValue - The current state value to monitor
 * @param onTransition - Callback fired when state transitions (receives previous and current values)
 */
export function useStateTransition<T>({
  trackedValue,
  onTransition,
}: {
  trackedValue: T;
  onTransition: (previousValue: T, currentValue: T) => void;
}) {
  const previousRef = useRef(trackedValue);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip the first render to avoid calling the callback on mount
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (previousRef.current !== trackedValue) {
      onTransition(previousRef.current, trackedValue);
      previousRef.current = trackedValue;
    }
  }, [trackedValue, onTransition]);
}
