// Map search (Civ's map search): "/" or ⌘/Ctrl+K opens a box at the top; typing dims everything
// that does not match, lists sessions and pins that do, and Enter flies to the selected one.
import { agentName } from "../agents";
import { currentLayout, subscribeLayout } from "../live";
import { allPins, subscribePins } from "../pins";
import { pinMatches, searchQuery, sessionMatches, setSearchQuery, type SearchHit } from "../search";
import { view } from "../view";

const MAX_RESULTS = 8;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

export function startSearch(root: HTMLElement): void {
  const opener = document.createElement("button");
  opener.type = "button";
  opener.className = "hud-search-open";
  opener.innerHTML = `搜索 <kbd>/</kbd>`;
  const box = document.createElement("div");
  box.className = "hud-search";
  box.hidden = true;
  box.innerHTML = `<input class="hud-search-input" type="search" placeholder="搜索会话标题、项目、工具、模型、地图钉…" aria-label="搜索" />
    <div class="hud-search-count"></div>
    <div class="hud-search-results" role="listbox"></div>`;
  root.append(opener, box);
  const input = box.querySelector<HTMLInputElement>(".hud-search-input")!;
  const count = box.querySelector<HTMLElement>(".hud-search-count")!;
  const results = box.querySelector<HTMLElement>(".hud-search-results")!;

  let hits: SearchHit[] = [];
  let selected = 0;

  const go = (hit: SearchHit) => {
    if (hit.kind === "session") view().focus(hit.session.col, hit.session.row, { openMenu: true });
    else view().focus(hit.pin.col, hit.pin.row);
  };

  const render = () => {
    const text = searchQuery();
    hits = text
      ? [
          ...currentLayout()
            .sessions.filter((session) => sessionMatches(session, text))
            .map((session): SearchHit => ({ kind: "session", session })),
          ...allPins()
            .filter((pin) => pinMatches(pin, text))
            .map((pin): SearchHit => ({ kind: "pin", pin })),
        ]
      : [];
    if (selected >= hits.length) selected = 0;
    count.textContent = text ? `${hits.length} 个结果` : "";
    results.replaceChildren(
      ...hits.slice(0, MAX_RESULTS).map((hit, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "hud-search-item";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(index === selected));
        const title = document.createElement("span");
        title.className = "hud-search-item-title";
        const meta = document.createElement("span");
        meta.className = "hud-search-item-meta";
        if (hit.kind === "session") {
          title.textContent = hit.session.title;
          meta.textContent = [agentName(hit.session.agent), projectName(hit.session.cwd)].filter(Boolean).join(" · ");
        } else {
          title.textContent = `📍 ${hit.pin.note}`;
          meta.textContent = "地图钉";
        }
        item.append(title, meta);
        item.addEventListener("click", () => go(hit));
        return item;
      }),
    );
  };

  const open = () => {
    box.hidden = false;
    opener.hidden = true;
    input.focus();
    input.select();
  };
  const close = () => {
    box.hidden = true;
    opener.hidden = false;
    input.value = "";
    setSearchQuery("");
    render();
    input.blur();
  };

  input.addEventListener("input", () => {
    selected = 0;
    setSearchQuery(input.value);
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const size = Math.min(hits.length, MAX_RESULTS);
      if (size > 0) selected = (selected + (event.key === "ArrowDown" ? 1 : size - 1)) % size;
      render();
    } else if (event.key === "Enter") {
      const hit = hits[selected];
      if (hit) go(hit);
    }
  });
  opener.addEventListener("click", open);
  for (const element of [opener, box]) element.addEventListener("pointerdown", (event) => event.stopPropagation());
  subscribeLayout(render);
  subscribePins(render);
  window.addEventListener("keydown", (event) => {
    const shortcut = (event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !isTyping(event.target));
    if (!shortcut) return;
    event.preventDefault();
    open();
  });
}
