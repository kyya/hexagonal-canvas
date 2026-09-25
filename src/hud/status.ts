// What the map says when there is nothing to show yet: looking for sessions, nothing found, or the
// local server cannot be reached (a card in the middle), and a strip at the top when an open
// connection drops and the page is reconnecting.
import { AGENT_NAMES } from "../agents";
import { PHI } from "../cells/golden";
import { currentConnection, currentLayout, subscribeConnection, subscribeLayout } from "../live";
import { replayState, subscribeReplay } from "../replay";

// "Looking for sessions" only appears after φ⁻¹ s, so a quick start does not flash it.
const LOADING_DELAY_MS = 1000 / PHI;

type Card = { kind: string; title: string; body: (HTMLElement | string)[] };

function code(text: string): HTMLElement {
  const node = document.createElement("code");
  node.textContent = text;
  return node;
}

function paragraph(...parts: (HTMLElement | string)[]): HTMLElement {
  const node = document.createElement("p");
  node.append(...parts);
  return node;
}

export function startStatus(root: HTMLElement): void {
  const card = document.createElement("div");
  card.className = "hud-status";
  card.setAttribute("role", "status");
  card.hidden = true;
  const strip = document.createElement("div");
  strip.className = "hud-offline";
  strip.setAttribute("role", "alert");
  strip.textContent = "与本地服务的连接断开了，正在重连…";
  strip.hidden = true;
  root.append(card, strip);

  let patient = false;
  window.setTimeout(() => {
    patient = true;
    render();
  }, LOADING_DELAY_MS);

  const pick = (): Card | null => {
    const connection = currentConnection();
    if (!connection.received && connection.state === "lost") {
      return {
        kind: "offline",
        title: "连不上本地服务",
        body: [paragraph("地图需要本机的服务来读取各个 agent 的会话。在项目目录运行 ", code("pnpm dev"), "，页面会自动连上。")],
      };
    }
    if (!connection.received) return patient ? { kind: "loading", title: "正在寻找本机的 agent 会话…", body: [] } : null;
    if (currentLayout().sessions.length === 0 && !replayState().active) {
      const list = document.createElement("ul");
      list.className = "hud-status-agents";
      for (const name of Object.values(AGENT_NAMES)) {
        const item = document.createElement("li");
        item.textContent = name;
        list.append(item);
      }
      return {
        kind: "empty",
        title: "还没有找到 agent 会话",
        body: [paragraph("在任意项目里用下面这些工具开始一次对话，它就会出现在地图上："), list, paragraph("会话只从本机读取，不会上传。")],
      };
    }
    return null;
  };

  function render(): void {
    const next = pick();
    card.hidden = !next;
    if (next) {
      card.dataset.kind = next.kind;
      const title = document.createElement("div");
      title.className = "hud-status-title";
      title.textContent = next.title;
      card.replaceChildren(title, ...next.body);
    }
    const connection = currentConnection();
    strip.hidden = !(connection.received && connection.state === "lost");
  }

  subscribeConnection(render);
  subscribeLayout(render);
  subscribeReplay(render);
}
