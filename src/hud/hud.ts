// Screen-space controls layered over the canvas (the Civ-style HUD).
import "./hud.css";
import { startLensSwitcher } from "./lens-switcher";
import { startMinimap } from "./minimap";
import { startNextWaiting } from "./next-waiting";

export function startHud(): void {
  const root = document.querySelector<HTMLElement>("#hud");
  if (!root) throw new Error("Missing #hud");
  startNextWaiting(root);
  startLensSwitcher(root);
  startMinimap(root);
}
