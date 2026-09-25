// Lens switcher (top-left): pick how the map is coloured, keys 1–5, with a legend for the lens.
import { FOG } from "../cells/golden";
import { AGENT_COLOURS, lens, LENSES, modelHue, setLens, subscribeLens, type LensId } from "../lens";
import { currentLayout, subscribeLayout } from "../live";
import { toggleTilt } from "../tilt";
import { isOn, setToggle, subscribeToggles } from "../toggles";

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

function swatch(colour: string, text: string): HTMLElement {
  const item = document.createElement("span");
  item.className = "hud-legend-item";
  const dot = document.createElement("i");
  dot.style.background = colour;
  item.append(dot, text);
  return item;
}

function gradient(from: string, to: string, left: string, right: string): HTMLElement {
  const row = document.createElement("span");
  row.className = "hud-legend-gradient";
  const bar = document.createElement("i");
  bar.style.background = `linear-gradient(90deg, ${from}, ${to})`;
  const start = document.createElement("small");
  start.textContent = left;
  const end = document.createElement("small");
  end.textContent = right;
  row.append(start, bar, end);
  return row;
}

function legendFor(id: LensId): HTMLElement[] {
  const sessions = currentLayout().sessions;
  switch (id) {
    case "status":
      return [
        swatch("#22c55e", "空闲"),
        swatch("#2563eb", "工作中"),
        swatch("#f59e0b", "等你处理"),
        swatch("#d1d5db", `迷雾：${FOG.afterDays} 天未动`),
      ];
    case "recency":
      return [gradient("rgba(124, 58, 237, 0.62)", "rgba(124, 58, 237, 0.08)", "今天", "4 周前")];
    case "agent":
      return [...new Set(sessions.map((session) => session.agent))].sort().map((agent) => swatch(AGENT_COLOURS[agent] ?? "#6b7280", agent));
    case "model": {
      const models = [...new Set(sessions.map((session) => session.model).filter((model): model is string => !!model))].sort();
      return models.length > 0 ? models.map((model) => swatch(`hsl(${modelHue(model)}, 60%, 50%)`, model)) : [swatch("#e5e7eb", "没有模型信息")];
    }
    case "messages": {
      const max = Math.max(0, ...sessions.map((session) => session.messages));
      return [gradient("rgba(8, 145, 178, 0.08)", "rgba(8, 145, 178, 0.62)", "0", `${max} 条`)];
    }
  }
}

export function startLensSwitcher(root: HTMLElement): void {
  const box = document.createElement("div");
  box.className = "hud-lens";
  const tabs = document.createElement("div");
  tabs.className = "hud-lens-tabs";
  tabs.setAttribute("role", "tablist");
  const legend = document.createElement("div");
  legend.className = "hud-legend";
  box.append(tabs, legend);
  root.append(box);

  const buttons = LENSES.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.dataset.lens = item.id;
    button.title = `${item.label}（${item.key}）`;
    button.textContent = item.label;
    button.addEventListener("click", () => setLens(item.id));
    tabs.append(button);
    return button;
  });

  // Civ's yield icons: show each cell's message count (key Y).
  const yields = document.createElement("button");
  yields.type = "button";
  yields.className = "hud-lens-toggle";
  yields.title = "在格子上显示消息数（Y）";
  yields.textContent = "数字";
  yields.addEventListener("click", () => setToggle("yields", !isOn("yields")));
  tabs.append(yields);

  // Civ's default camera: tilt the map so sessions stand as prisms (key T).
  const tilt = document.createElement("button");
  tilt.type = "button";
  tilt.className = "hud-lens-toggle";
  tilt.title = "倾斜视角，格子按消息数升高（T）";
  tilt.textContent = "倾斜";
  tilt.addEventListener("click", toggleTilt);
  tabs.append(tilt);

  const render = () => {
    yields.setAttribute("aria-pressed", String(isOn("yields")));
    tilt.setAttribute("aria-pressed", String(isOn("tilt")));
    const active = lens();
    for (const button of buttons) button.setAttribute("aria-selected", String(button.dataset.lens === active));
    legend.replaceChildren(...legendFor(active));
  };
  render();
  subscribeLens(render);
  subscribeToggles(render);
  subscribeLayout(render);
  box.addEventListener("pointerdown", (event) => event.stopPropagation());
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    if (event.key.toLowerCase() === "y") {
      event.preventDefault();
      setToggle("yields", !isOn("yields"));
      return;
    }
    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      toggleTilt();
      return;
    }
    const match = LENSES.find((item) => item.key === event.key);
    if (!match) return;
    event.preventDefault();
    setLens(match.id);
  });
}
