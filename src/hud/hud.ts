// Screen-space controls layered over the canvas (the Civ-style HUD).
import "./hud.css";
import { startHelp } from "./help";
import { startLensSwitcher } from "./lens-switcher";
import { startMinimap } from "./minimap";
import { startNextWaiting } from "./next-waiting";
import { startReplay } from "./replay";
import { startSearch } from "./search";
import { startStatus } from "./status";

export function startHud(): void {
  const root = document.querySelector<HTMLElement>("#hud");
  if (!root) throw new Error("Missing #hud");
  startNextWaiting(root);
  startLensSwitcher(root);
  startMinimap(root);
  startSearch(root);
  startReplay(root);
  startHelp(root);
  startStatus(root);
}
