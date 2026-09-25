// Replay timeline (Civ's end-game replay map): R or the 回放 button opens a bar at the bottom. Like
// Civ's turns, each step reveals the next session in creation order, so bursts and quiet weeks
// replay at the same pace; play sweeps every session in φ⁴ seconds, the slider scrubs, × exits.
import { PHI } from "../cells/golden";
import { sessionTimes, subscribeLayout } from "../live";
import { replayState, setReplay, subscribeReplay } from "../replay";

const SWEEP_MS = 1000 * PHI ** 4;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

function formatDate(time: number): string {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function startReplay(root: HTMLElement): void {
  const opener = document.createElement("button");
  opener.type = "button";
  opener.className = "hud-replay-open";
  opener.innerHTML = `回放 <kbd>R</kbd>`;
  const bar = document.createElement("div");
  bar.className = "hud-replay";
  bar.hidden = true;
  bar.innerHTML = `
    <button type="button" class="hud-replay-play" aria-label="播放">▶</button>
    <input class="hud-replay-slider" type="range" min="1" max="1" value="1" aria-label="回放进度" />
    <span class="hud-replay-date"></span>
    <button type="button" class="hud-replay-close" aria-label="退出回放">×</button>`;
  root.append(opener, bar);
  const play = bar.querySelector<HTMLButtonElement>(".hud-replay-play")!;
  const slider = bar.querySelector<HTMLInputElement>(".hud-replay-slider")!;
  const date = bar.querySelector<HTMLElement>(".hud-replay-date")!;
  const close = bar.querySelector<HTMLButtonElement>(".hud-replay-close")!;

  let frame = 0;
  // Step k shows the first k sessions; its time is the k-th creation time.
  const times = () => sessionTimes();
  const timeAt = (step: number) => {
    const list = times();
    return list[Math.min(list.length, Math.max(1, step)) - 1] ?? Date.now();
  };
  const stepAt = (time: number) => times().filter((value) => value <= time).length;

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (replayState().playing) setReplay({ playing: false });
  };

  const sweep = () => {
    const total = times().length;
    if (total === 0) return;
    const from = stepAt(replayState().time) >= total ? 1 : stepAt(replayState().time);
    const began = performance.now() - ((from - 1) / Math.max(1, total - 1)) * SWEEP_MS;
    setReplay({ playing: true, time: timeAt(from) });
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / SWEEP_MS);
      setReplay({ time: timeAt(1 + Math.round(t * (total - 1))) });
      if (t < 1 && replayState().playing) frame = requestAnimationFrame(step);
      else stop();
    };
    frame = requestAnimationFrame(step);
  };

  const openReplay = () => {
    // Open at the very beginning, paused, so the first press of ▶ shows the whole story.
    setReplay({ active: true, playing: false, time: timeAt(1) });
  };
  const exitReplay = () => {
    stop();
    setReplay({ active: false, playing: false });
  };

  // Nothing to replay until there are sessions.
  const refreshOpener = () => {
    opener.hidden = replayState().active || times().length === 0;
  };
  subscribeLayout(refreshOpener);
  subscribeReplay(() => {
    const state = replayState();
    bar.hidden = !state.active;
    refreshOpener();
    play.textContent = state.playing ? "⏸" : "▶";
    play.setAttribute("aria-label", state.playing ? "暂停" : "播放");
    slider.max = String(Math.max(1, times().length));
    slider.value = String(stepAt(state.time));
    date.textContent = `${formatDate(state.time)} · ${stepAt(state.time)}/${times().length}`;
  });

  opener.addEventListener("click", openReplay);
  close.addEventListener("click", exitReplay);
  play.addEventListener("click", () => (replayState().playing ? stop() : sweep()));
  slider.addEventListener("input", () => {
    stop();
    setReplay({ time: timeAt(Number(slider.value)) });
  });
  for (const element of [opener, bar]) element.addEventListener("pointerdown", (event) => event.stopPropagation());
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "r" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    if (!replayState().active && times().length === 0) return;
    event.preventDefault();
    if (replayState().active) exitReplay();
    else openReplay();
  });
}
