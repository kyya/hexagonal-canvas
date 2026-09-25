// Help panel: every mouse gesture and shortcut in one place. "?" or the ? button opens it; it also
// opens once by itself on the first visit that has sessions to explore.
import { currentConnection, currentLayout, subscribeLayout } from "../live";

const SEEN_KEY = "hexagonal-canvas.help-seen";

const MOUSE: [string, string][] = [
  ["拖动", "平移地图"],
  ["滚轮", "缩放；缩得够小进入战略视图"],
  ["悬停在会话上", "查看摘要，并显示它的派生关系"],
  ["右键会话", "详情、恢复命令和完整对话"],
  ["右键硬币堆", "列出叠在里面的过时会话"],
  ["右键空格子", "插一枚地图钉"],
  ["点项目横幅", "飞到这个项目"],
  ["点击或拖动小地图", "跳到那里"],
];

const KEYS: [string, string][] = [
  ["W A S D / 方向键", "平移"],
  ["N", "下一个等你处理的会话"],
  ["1 – 5", "视图：状态、新旧、工具、模型、消息量"],
  ["Y", "在格子上显示消息数"],
  ["T", "倾斜视角"],
  ["/ 或 ⌘K", "搜索"],
  ["R", "回放"],
  ["Esc", "关闭菜单或面板"],
  ["?", "打开这份说明"],
];

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

function section(title: string, rows: [string, string][]): HTMLElement {
  const box = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("dl");
  for (const [key, text] of rows) {
    const term = document.createElement("dt");
    term.textContent = key;
    const description = document.createElement("dd");
    description.textContent = text;
    list.append(term, description);
  }
  box.append(heading, list);
  return box;
}

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode: it may show again next time.
  }
}

export function startHelp(root: HTMLElement): void {
  const opener = document.createElement("button");
  opener.type = "button";
  opener.className = "hud-help-open";
  opener.textContent = "?";
  opener.title = "操作说明（?）";
  opener.setAttribute("aria-label", "操作说明");
  const panel = document.createElement("div");
  panel.className = "hud-help";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "操作说明");
  panel.hidden = true;
  const header = document.createElement("div");
  header.className = "hud-help-header";
  const title = document.createElement("h2");
  title.textContent = "操作说明";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "hud-help-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "关闭");
  header.append(title, close);
  const intro = document.createElement("p");
  intro.className = "hud-help-intro";
  intro.textContent = "每个格子是本机的一次 agent 会话，按项目聚在一起。运行中的会话会着色并“呼吸”：绿色空闲，蓝色工作中，琥珀色等你处理。";
  panel.append(header, intro, section("鼠标", MOUSE), section("键盘", KEYS));
  root.append(opener, panel);

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    opener.setAttribute("aria-expanded", String(open));
    if (open) markSeen();
  };
  opener.addEventListener("click", () => setOpen(panel.hidden === true));
  close.addEventListener("click", () => setOpen(false));
  for (const node of [opener, panel]) node.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.addEventListener("pointerdown", () => setOpen(false));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      return;
    }
    if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    event.preventDefault();
    setOpen(panel.hidden === true);
  });

  // First visit: open once there is a map to explore.
  const unsubscribe = subscribeLayout(() => {
    if (!currentConnection().received || currentLayout().sessions.length === 0) return;
    queueMicrotask(() => unsubscribe());
    if (!seen()) setOpen(true);
  });
}
