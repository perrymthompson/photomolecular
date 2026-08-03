"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. Server snapshot is false so SSR matches
 * the desktop layout until hydration.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phones / small tablets — stack chrome and compact Plotly legends. */
export function usePrefersNarrow(maxWidthPx = 768): boolean {
  return useMediaQuery(`(max-width: ${maxWidthPx}px)`);
}
