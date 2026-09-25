// Screen-space controls layered over the canvas (the Civ-style HUD).
import "./hud.css";
import { startNextWaiting } from "./next-waiting";

export function startHud(): void {
  const root = document.querySelector<HTMLElement>("#hud");
  if (!root) throw new Error("Missing #hud");
  startNextWaiting(root);
}
