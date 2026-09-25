// Civ's "unit needs orders" button: whenever sessions are waiting on you, a button in the corner
// jumps to the next one (or press N) and opens its menu; the caret lists them all.
import { subscribeLayout, type LiveSession } from "../live";
import { view } from "../view";

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

export function startNextWaiting(root: HTMLElement): void {
  const box = document.createElement("div");
  box.className = "hud-waiting";
  box.hidden = true;
  box.innerHTML = `
    <div class="hud-waiting-list" role="menu" hidden></div>
    <div class="hud-waiting-bar">
      <button type="button" class="hud-waiting-next" title="跳到下一个等你处理的会话（N）">
        <span class="hud-waiting-badge">!</span>
        <span class="hud-waiting-label"></span>
        <kbd>N</kbd>
      </button>
      <button type="button" class="hud-waiting-toggle" aria-label="列出等你处理的会话">▴</button>
    </div>`;
  root.append(box);
  const list = box.querySelector<HTMLElement>(".hud-waiting-list")!;
  const label = box.querySelector<HTMLElement>(".hud-waiting-label")!;
  const next = box.querySelector<HTMLButtonElement>(".hud-waiting-next")!;
  const toggle = box.querySelector<HTMLButtonElement>(".hud-waiting-toggle")!;

  let waiting: LiveSession[] = [];
  let cursor = 0;

  const go = (session: LiveSession) => {
    list.hidden = true;
    view().focus(session.col, session.row, { openMenu: true });
  };

  const goNext = () => {
    if (waiting.length === 0) return;
    const session = waiting[cursor % waiting.length];
    cursor = (cursor + 1) % waiting.length;
    if (session) go(session);
  };

  const renderList = () => {
    list.replaceChildren(
      ...waiting.map((session) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "hud-waiting-item";
        const title = document.createElement("span");
        title.className = "hud-waiting-item-title";
        title.textContent = session.title;
        const meta = document.createElement("span");
        meta.className = "hud-waiting-item-meta";
        meta.textContent = [projectName(session.cwd), session.waitingFor].filter(Boolean).join(" · ");
        item.append(title, meta);
        item.addEventListener("click", () => go(session));
        return item;
      }),
    );
  };

  subscribeLayout((layout) => {
    // Stable order: by project, then by position in the cluster.
    waiting = layout.sessions
      .filter((session) => session.status === "waiting")
      .sort((a, b) => a.cwd.localeCompare(b.cwd) || a.row - b.row || a.col - b.col);
    if (cursor >= waiting.length) cursor = 0;
    box.hidden = waiting.length === 0;
    label.textContent = `${waiting.length} 个等你处理`;
    renderList();
  });

  next.addEventListener("click", goNext);
  toggle.addEventListener("click", () => {
    list.hidden = !list.hidden;
  });
  box.addEventListener("pointerdown", (event) => event.stopPropagation());
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    event.preventDefault();
    goNext();
  });
}
