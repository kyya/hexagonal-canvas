// The tilted camera (key T or the 倾斜 chip): a persisted on/off switch, and the tilt amount easing
// between 0 (top-down) and 1 (tilted) over TILT.glideMs. src/index.ts turns the amount into the
// ground's foreshortening with tiltSquash.
import { TILT } from "./cells/golden";
import { isOn, setToggle, subscribeToggles } from "./toggles";

let from = isOn("tilt") ? 1 : 0;
let to = from;
let start = 0;
let frame = 0;
const listeners = new Set<() => void>();

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function tiltAmount(now = performance.now()): number {
  const t = Math.min(1, (now - start) / TILT.glideMs);
  return from + (to - from) * ease(t);
}

function pump(): void {
  if (frame !== 0) return;
  frame = requestAnimationFrame((now) => {
    frame = 0;
    for (const listener of listeners) listener();
    if (now - start < TILT.glideMs) pump();
  });
}

subscribeToggles(() => {
  const target = isOn("tilt") ? 1 : 0;
  if (target === to) return;
  const now = performance.now();
  from = tiltAmount(now);
  to = target;
  start = now;
  pump();
});

export function toggleTilt(): void {
  setToggle("tilt", !isOn("tilt"));
}

// Called on every frame of a tilt glide.
export function subscribeTilt(listener: () => void): void {
  listeners.add(listener);
}
