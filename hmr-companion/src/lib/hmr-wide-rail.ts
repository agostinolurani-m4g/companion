/** Viewport “largo e basso”: rail UI a sinistra, misure a destra (stessa soglia ovunque). */
export const HMR_WIDE_RAIL_MEDIA = "(min-aspect-ratio: 5/4)";

export function subscribeHmrWideRail(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(HMR_WIDE_RAIL_MEDIA);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function getHmrWideRailSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(HMR_WIDE_RAIL_MEDIA).matches;
}
