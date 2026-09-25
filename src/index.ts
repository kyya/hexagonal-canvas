import {
  clickAt,
  describePlaced,
  drawOverlays,
  openEmptyMenu,
  drawPlacedCell,
  openPlacedMenu,
  placedCellAt,
  placedCells,
  startCells,
} from "./cells/board";
import { bannerRects } from "./cells/territory";
import { startHud } from "./hud/hud";
import { currentLayout } from "./live";
import { installView } from "./view";
import { cellGeometry, PHI } from "./cells/golden";
import type { CellDetails, CellForm, CellMenu } from "./cells/types";
import { mountTranscript } from "./transcript/TranscriptView";
import "./app.css";
import { beginFrame, popScale, pumpPops } from "./cells/pop";
import { drawHexIcon, ICON_CYCLE, iconReady, iconsEqual, type HexIcon } from "./icons";

const canvasEl = document.querySelector<HTMLCanvasElement>("#app");
if (!canvasEl) {
  throw new Error("Missing canvas #app");
}
const canvas: HTMLCanvasElement = canvasEl;

const context = canvas.getContext("2d");
if (!context) {
  throw new Error("Canvas 2D context is unavailable");
}
const ctx: CanvasRenderingContext2D = context;

// 画布按 2 倍像素绘制。线宽单位是 CSS 像素，1 / outputScale 才是 1 个设备像素。
// 再细时，4 倍多重采样会漏掉落在采样点之间的竖边。
const outputScale = 2;

const hexagonAngle = Math.PI / 6; // 30 degrees in radians
const sideLength = 64;
const hexHeight = Math.sin(hexagonAngle) * sideLength;
const hexRadius = Math.cos(hexagonAngle) * sideLength;
const hexRectangleHeight = sideLength + 2 * hexHeight;
const hexRectangleWidth = 2 * hexRadius;
const rowStep = sideLength + hexHeight;

const CHUNK_SIZE = 16;
const CLICK_SLOP = 5;

type Hex = {
  col: number;
  row: number;
};

type HexState = {
  id: string;
  col: number;
  row: number;
  marked: boolean;
  icon: HexIcon | null;
};

type Chunk = {
  col: number;
  row: number;
  cells: HexState[];
};

type Pointer = {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  col: number;
  row: number;
  mode: "pan" | "select";
};

const STORAGE_KEY = "hexagonal-canvas.hex-states";
const CAMERA_KEY = "hexagonal-canvas.camera";

const chunks = new Map<string, Chunk>();
const hexStates = new Map<string, HexState>();
const heldPanKeys = new Set<string>();
let panFrame = 0;
let lastPanTime = 0;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
const PAN_SPEED = 960;
const camera = { x: 0, y: 0, zoom: 1 };
const selection = new Map<string, Hex>();
let hover: Hex | null = null;
let pointer: Pointer | null = null;
let suppressClick = false;


const menuRoot = document.querySelector<HTMLElement>("#hex-menu");
const menuTranscriptNode = menuRoot?.querySelector<HTMLElement>(".hex-menu-transcript");
const menuDetailsNode = menuRoot?.querySelector<HTMLElement>(".hex-menu-details");
const menuFormNode = menuRoot?.querySelector<HTMLElement>(".hex-menu-form");
if (!menuRoot || !menuTranscriptNode || !menuDetailsNode || !menuFormNode) {
  throw new Error("Missing hex menu");
}
const menu: HTMLElement = menuRoot;
const menuTranscript: HTMLElement = menuTranscriptNode;
const menuDetails: HTMLElement = menuDetailsNode;
const menuForm: HTMLElement = menuFormNode;
canvas.style.touchAction = "none";
canvas.addEventListener("contextmenu", onContextMenu);
canvas.addEventListener("wheel", onWheel, { passive: false });
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerCancel);
canvas.addEventListener("pointerleave", () => hideTooltip());
menu.addEventListener("pointerdown", (event) => event.stopPropagation());
document.addEventListener("pointerdown", onDocumentPointerDown);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", releasePanKeys);
window.addEventListener("resize", onResize);

const tooltipNode = document.querySelector<HTMLElement>("#hex-tooltip");
if (!tooltipNode) throw new Error("Missing hex tooltip");
const tooltip: HTMLElement = tooltipNode;
// Hover must rest this long on a cell before its tooltip shows (φ⁻² s).
const TOOLTIP_DELAY_MS = 1000 / PHI ** 2;
// Camera glides to a focused cell over φ⁻¹ s.
const GLIDE_MS = 1000 / PHI;
let tooltipTimer = 0;
const renderListeners = new Set<() => void>();
let glideFrame = 0;

installView({
  camera: () => ({ ...camera }),
  focus: focusHex,
  centreOn(x, y) {
    camera.x = x - window.innerWidth / 2 / camera.zoom;
    camera.y = y - window.innerHeight / 2 / camera.zoom;
    saveCamera();
    syncChunks();
    render();
  },
  hexCentre(col, row) {
    const { x, y } = hexOrigin(col, row);
    return { x: x + hexRadius, y: y + sideLength };
  },
  requestRender: () => render(),
  onRender: (listener) => renderListeners.add(listener),
});

// Introspection for the end-to-end tests: layout, camera and banner hit areas as the page sees them.
Object.assign(window, {
  __hexCanvas: {
    camera: () => ({ ...camera }),
    layout: () => currentLayout(),
    banners: () => bannerRects(),
    focus: (col: number, row: number) => focusHex(col, row),
  },
});

loadHexStates();
let framed = loadCamera();
fitCanvas();
syncChunks();
render();
startCells(() => {
  if (!framed) framed = frameCells();
  render();
});
startHud();

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function focusHex(col: number, row: number, options: { openMenu?: boolean; zoom?: number } = {}): void {
  cancelAnimationFrame(glideFrame);
  closeMenu();
  hideTooltip();
  const { x, y } = hexOrigin(col, row);
  const target = { x: x + hexRadius, y: y + sideLength };
  const fromZoom = camera.zoom;
  const toZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, options.zoom ?? Math.max(camera.zoom, 1)));
  const from = { x: camera.x + window.innerWidth / 2 / camera.zoom, y: camera.y + window.innerHeight / 2 / camera.zoom };
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / GLIDE_MS);
    const k = easeInOut(t);
    camera.zoom = fromZoom + (toZoom - fromZoom) * k;
    const centreX = from.x + (target.x - from.x) * k;
    const centreY = from.y + (target.y - from.y) * k;
    camera.x = centreX - window.innerWidth / 2 / camera.zoom;
    camera.y = centreY - window.innerHeight / 2 / camera.zoom;
    saveCamera();
    syncChunks();
    render();
    if (t < 1) {
      glideFrame = requestAnimationFrame(step);
    } else if (options.openMenu && placedCellAt(col, row)) {
      openMenu({ col, row }, window.innerWidth / 2, window.innerHeight / 2);
    }
  };
  glideFrame = requestAnimationFrame(step);
}

function hideTooltip(): void {
  clearTimeout(tooltipTimer);
  tooltipTimer = 0;
  tooltip.hidden = true;
}

function scheduleTooltip(hex: Hex, clientX: number, clientY: number): void {
  clearTimeout(tooltipTimer);
  tooltip.hidden = true;
  if (pointer || !menu.hidden) return;
  const placed = placedCellAt(hex.col, hex.row);
  const details = placed ? describePlaced(placed) : null;
  if (!details) return;
  tooltipTimer = window.setTimeout(() => {
    tooltipTimer = 0;
    const title = document.createElement("div");
    title.className = "hex-tooltip-title";
    title.textContent = details.title;
    const subtitle = document.createElement("div");
    subtitle.className = "hex-tooltip-subtitle";
    subtitle.textContent = details.subtitle;
    tooltip.replaceChildren(title, subtitle);
    tooltip.hidden = false;
    const offset = 14;
    const rect = tooltip.getBoundingClientRect();
    const left = Math.min(clientX + offset, window.innerWidth - rect.width - 8);
    const top = Math.min(clientY + offset, window.innerHeight - rect.height - 8);
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }, TOOLTIP_DELAY_MS);
}

function fitCanvas(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * outputScale;
  canvas.height = height * outputScale;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
}

function onResize(): void {
  closeMenu();
  fitCanvas();
  syncChunks();
  render();
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  const world = screenToWorld(event.offsetX, event.offsetY);
  const hex = pixelToHex(world.x, world.y);
  openMenu(hex, event.clientX, event.clientY);
}

function openMenu(hex: Hex, x: number, y: number): void {
  hideTooltip();
  menuTranscript.hidden = true;
  menuDetails.hidden = true;
  menuForm.hidden = true;
  const api: CellMenu = {
    showDetails,
    showTranscript,
    showForm,
  };
  const placed = placedCellAt(hex.col, hex.row);
  if (placed) {
    openPlacedMenu(placed, api);
  } else if (!openEmptyMenu(hex.col, hex.row, api)) {
    closeMenu();
    return;
  }
  menu.hidden = false;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const rect = menu.getBoundingClientRect();
  const pad = 8;
  let left = x;
  let top = y;
  if (rect.right > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
  if (rect.bottom > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeMenu(): void {
  menu.hidden = true;
  menuTranscript.hidden = true;
  menuDetails.hidden = true;
  menuForm.hidden = true;
  mountTranscript(menuTranscript, null);
}

function showForm(form: CellForm): void {
  const title = document.createElement("div");
  title.className = "hex-menu-title";
  title.textContent = form.title;
  const input = document.createElement("input");
  input.className = "hex-menu-input";
  input.value = form.value;
  input.placeholder = form.placeholder;
  const actions = document.createElement("div");
  actions.className = "hex-menu-actions";
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "hex-menu-submit";
  submit.textContent = form.submitLabel;
  const done = () => {
    form.onSubmit(input.value);
    closeMenu();
  };
  submit.addEventListener("click", done);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") done();
    if (event.key === "Escape") closeMenu();
  });
  actions.append(submit);
  if (form.onDelete) {
    const onDelete = form.onDelete;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "hex-menu-delete";
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      onDelete();
      closeMenu();
    });
    actions.append(remove);
  }
  menuForm.replaceChildren(title, input, actions);
  menuForm.hidden = false;
  requestAnimationFrame(() => input.focus());
}

function showDetails(details: CellDetails): void {
  const title = document.createElement("div");
  title.className = "hex-menu-title";
  title.textContent = details.title;
  const subtitle = document.createElement("div");
  subtitle.className = "hex-menu-subtitle";
  subtitle.textContent = details.subtitle;
  menuDetails.replaceChildren(title, subtitle);
  if (details.command) {
    const command = details.command;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hex-menu-command";
    button.title = "复制恢复命令";
    button.textContent = command;
    button.addEventListener("click", () => {
      void navigator.clipboard?.writeText(command).then(() => {
        button.dataset.copied = "true";
      });
    });
    menuDetails.append(button);
  }
  menuDetails.hidden = false;
}

function showTranscript(sessionId: string, live = false): void {
  if (!sessionId) {
    menuTranscript.hidden = true;
    mountTranscript(menuTranscript, null);
    return;
  }
  menuTranscript.hidden = false;
  mountTranscript(menuTranscript, sessionId, live);
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || menu.hidden) return;
  if (menu.contains(event.target as Node)) return;
  closeMenu();
  suppressClick = true;
}

function panByScreen(dx: number, dy: number): void {
  camera.x += dx / camera.zoom;
  camera.y += dy / camera.zoom;
  saveCamera();
  syncChunks();
  render();
}

function isPanKey(key: string): boolean {
  return (
    key === "a" ||
    key === "d" ||
    key === "w" ||
    key === "s" ||
    key === "arrowleft" ||
    key === "arrowright" ||
    key === "arrowup" ||
    key === "arrowdown"
  );
}

function panDirection(): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (heldPanKeys.has("a") || heldPanKeys.has("arrowleft")) x -= 1;
  if (heldPanKeys.has("d") || heldPanKeys.has("arrowright")) x += 1;
  if (heldPanKeys.has("w") || heldPanKeys.has("arrowup")) y -= 1;
  if (heldPanKeys.has("s") || heldPanKeys.has("arrowdown")) y += 1;
  if (x !== 0 && y !== 0) {
    x *= Math.SQRT1_2;
    y *= Math.SQRT1_2;
  }
  return { x, y };
}

function releasePanKeys(): void {
  heldPanKeys.clear();
}

function ensurePanLoop(): void {
  if (panFrame !== 0) return;
  lastPanTime = performance.now();
  panFrame = requestAnimationFrame(stepKeyboardPan);
}

function stepKeyboardPan(now: number): void {
  panFrame = 0;
  const dir = panDirection();
  if (dir.x === 0 && dir.y === 0) return;
  const dt = Math.min(0.05, (now - lastPanTime) / 1000);
  lastPanTime = now;
  if (dt > 0) panByScreen(dir.x * PAN_SPEED * dt, dir.y * PAN_SPEED * dt);
  panFrame = requestAnimationFrame(stepKeyboardPan);
}

function onKeyUp(event: KeyboardEvent): void {
  heldPanKeys.delete(event.key.toLowerCase());
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeMenu();
    if (selection.size === 0) return;
    selection.clear();
    render();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
  ) {
    return;
  }
  const key = event.key.toLowerCase();
  if (!isPanKey(key)) return;
  event.preventDefault();
  if (event.repeat) return;
  heldPanKeys.add(key);
  ensurePanLoop();
}

function onPointerDown(event: PointerEvent): void {
  hideTooltip();
  if (event.button !== 0) return;
  const downWorld = screenToWorld(event.offsetX, event.offsetY);
  const hex = pixelToHex(downWorld.x, downWorld.y);
  const select = event.shiftKey;
  pointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    col: hex.col,
    row: hex.row,
    mode: select ? "select" : "pan",
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = select ? "default" : "grabbing";
}

function onPointerMove(event: PointerEvent): void {
  if (pointer && pointer.id === event.pointerId && pointer.mode === "pan") {
    camera.x -= (event.clientX - pointer.x) / camera.zoom;
    camera.y -= (event.clientY - pointer.y) / camera.zoom;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    saveCamera();
    syncChunks();
  }
  if (pointer && pointer.id === event.pointerId && pointer.mode === "select") {
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (dx * dx + dy * dy > CLICK_SLOP * CLICK_SLOP) {
      const selectWorld = screenToWorld(event.offsetX, event.offsetY);
      const hex = pixelToHex(selectWorld.x, selectWorld.y);
      selection.set(hexId(hex.col, hex.row), hex);
    }
  }
  const hoverWorld = screenToWorld(event.offsetX, event.offsetY);
  const next = pixelToHex(hoverWorld.x, hoverWorld.y);
  // Re-arm on a new hex, and also when the tooltip was dismissed (a glide or click) while the
  // pointer stayed on the same hex.
  const moved = !hover || hover.col !== next.col || hover.row !== next.row;
  if (moved || (tooltip.hidden && tooltipTimer === 0)) scheduleTooltip(next, event.clientX, event.clientY);
  hover = next;
  render();
}

function onPointerUp(event: PointerEvent): void {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  const { col, row } = pointer;
  const mode = pointer.mode;
  pointer = null;
  canvas.style.cursor = "default";
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const moved = dx * dx + dy * dy > CLICK_SLOP * CLICK_SLOP;
  if (mode === "pan" && !moved) {
    const world = screenToWorld(event.offsetX, event.offsetY);
    if (clickAt(world.x, world.y)) return;
  }
  if (mode === "select") {
    if (!moved) {
      const id = hexId(col, row);
      if (selection.has(id)) selection.delete(id);
      else selection.set(id, { col, row });
    }
    render();
  }
}

function onPointerCancel(event: PointerEvent): void {
  if (!pointer || pointer.id !== event.pointerId) return;
  pointer = null;
  canvas.style.cursor = "default";
}

function chunkKey(col: number, row: number): string {
  return `${col},${row}`;
}

function hexId(col: number, row: number): string {
  return `hex:${col},${row}`;
}

function isStoredIcon(value: unknown): value is HexIcon {
  return ICON_CYCLE.some((icon) => icon !== null && iconsEqual(icon, value as HexIcon));
}

function loadHexStates(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as { col?: unknown; row?: unknown; icon?: unknown };
      if (typeof record.col !== "number" || typeof record.row !== "number") continue;
      if (!Number.isInteger(record.col) || !Number.isInteger(record.row)) continue;
      if (!isStoredIcon(record.icon)) continue;
      const id = hexId(record.col, record.row);
      hexStates.set(id, {
        id,
        col: record.col,
        row: record.row,
        marked: true,
        icon: record.icon,
      });
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// Returns whether a saved camera was restored.
function loadCamera(): boolean {
  try {
    const raw = localStorage.getItem(CAMERA_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const record = parsed as { x?: unknown; y?: unknown; zoom?: unknown };
    if (typeof record.x !== "number" || typeof record.y !== "number") return false;
    if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return false;
    camera.x = record.x;
    camera.y = record.y;
    if (typeof record.zoom === "number" && Number.isFinite(record.zoom)) {
      camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, record.zoom));
    }
    return true;
  } catch {
    localStorage.removeItem(CAMERA_KEY);
    return false;
  }
}

// First visit: fit every placed cell (plus room for project labels) into the view.
function frameCells(): boolean {
  const cells = placedCells();
  if (cells.length === 0) return false;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { cell } of cells) {
    const { x, y } = hexOrigin(cell.col, cell.row);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y - 24);
    maxX = Math.max(maxX, x + hexRectangleWidth);
    maxY = Math.max(maxY, y + hexRectangleHeight);
  }
  const pad = 48;
  const zoom = Math.min(
    1,
    (window.innerWidth - pad * 2) / (maxX - minX),
    (window.innerHeight - pad * 2) / (maxY - minY),
  );
  camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  camera.x = (minX + maxX) / 2 - window.innerWidth / 2 / camera.zoom;
  camera.y = (minY + maxY) / 2 - window.innerHeight / 2 / camera.zoom;
  saveCamera();
  syncChunks();
  return true;
}

function saveCamera(): void {
  localStorage.setItem(
    CAMERA_KEY,
    JSON.stringify({ x: camera.x, y: camera.y, zoom: camera.zoom }),
  );
}

function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: camera.x + screenX / camera.zoom,
    y: camera.y + screenY / camera.zoom,
  };
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  if (delta === 0) return;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * Math.exp(-delta * 0.0015)));
  const world = screenToWorld(event.offsetX, event.offsetY);
  camera.zoom = next;
  camera.x = world.x - event.offsetX / camera.zoom;
  camera.y = world.y - event.offsetY / camera.zoom;
  saveCamera();
  syncChunks();
  render();
}

function defaultHexState(col: number, row: number): HexState {
  return { id: hexId(col, row), col, row, marked: false, icon: null };
}

function hexState(col: number, row: number): HexState {
  return hexStates.get(hexId(col, row)) ?? defaultHexState(col, row);
}

function generateChunk(col: number, row: number): Chunk {
  const cells: HexState[] = [];
  const col0 = col * CHUNK_SIZE;
  const row0 = row * CHUNK_SIZE;
  for (let localRow = 0; localRow < CHUNK_SIZE; localRow++) {
    for (let localCol = 0; localCol < CHUNK_SIZE; localCol++) {
      cells.push(hexState(col0 + localCol, row0 + localRow));
    }
  }
  return { col, row, cells };
}

function visibleHexBounds(): { col0: number; col1: number; row0: number; row1: number } {
  const viewW = window.innerWidth / camera.zoom;
  const viewH = window.innerHeight / camera.zoom;
  return {
    col0: Math.floor((camera.x - hexRectangleWidth) / hexRectangleWidth) - 1,
    col1: Math.ceil((camera.x + viewW) / hexRectangleWidth) + 1,
    row0: Math.floor((camera.y - hexRectangleHeight) / rowStep) - 1,
    row1: Math.ceil((camera.y + viewH) / rowStep) + 1,
  };
}

function syncChunks(): void {
  const { col0, col1, row0, row1 } = visibleHexBounds();
  const chunkCol0 = Math.floor(col0 / CHUNK_SIZE) - 1;
  const chunkCol1 = Math.floor(col1 / CHUNK_SIZE) + 1;
  const chunkRow0 = Math.floor(row0 / CHUNK_SIZE) - 1;
  const chunkRow1 = Math.floor(row1 / CHUNK_SIZE) + 1;
  const keep = new Set<string>();

  for (let row = chunkRow0; row <= chunkRow1; row++) {
    for (let col = chunkCol0; col <= chunkCol1; col++) {
      const key = chunkKey(col, row);
      keep.add(key);
      if (!chunks.has(key)) chunks.set(key, generateChunk(col, row));
    }
  }

  for (const key of chunks.keys()) {
    if (!keep.has(key)) chunks.delete(key);
  }
}

function hexIntersectsView(col: number, row: number): boolean {
  const { x, y } = hexOrigin(col, row);
  return (
    x < camera.x + window.innerWidth / camera.zoom &&
    x + hexRectangleWidth > camera.x &&
    y < camera.y + window.innerHeight / camera.zoom &&
    y + hexRectangleHeight > camera.y
  );
}

function render(): void {
  beginFrame();
  const width = window.innerWidth;
  const height = window.innerHeight;
  ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(outputScale * camera.zoom, 0, 0, outputScale * camera.zoom, 0, 0);
  ctx.translate(-camera.x, -camera.y);

  ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
  for (const hex of selection.values()) {
    if (!hexIntersectsView(hex.col, hex.row)) continue;
    const { x, y } = hexOrigin(hex.col, hex.row);
    drawHexagon(x, y, true);
  }

  const icons: HexState[] = [];
  for (const chunk of chunks.values()) {
    for (let localRow = 0; localRow < CHUNK_SIZE; localRow++) {
      for (let localCol = 0; localCol < CHUNK_SIZE; localCol++) {
        const cell = chunk.cells[localRow * CHUNK_SIZE + localCol];
        if (!cell || !hexIntersectsView(cell.col, cell.row)) continue;
        const { x, y } = hexOrigin(cell.col, cell.row);
        drawHexagon(x, y, false);
        if (cell.icon) icons.push(cell);
      }
    }
  }

  const occupied = new Set(placedCells().map(({ cell }) => hexId(cell.col, cell.row)));
  const { iconSize } = cellGeometry(hexRadius);
  for (const cell of icons) {
    if (!cell.icon || occupied.has(cell.id)) continue;
    const { x, y } = hexOrigin(cell.col, cell.row);
    const ready = iconReady(cell.icon, render);
    const scale = popScale(cell.id, ready);
    if (!ready || scale === 0) continue;
    drawHexIcon(
      ctx,
      cell.icon,
      x + hexRectangleWidth / 2 - iconSize / 2,
      y + sideLength - iconSize / 2,
      iconSize,
      scale,
      render,
    );
  }
  for (const placed of placedCells()) {
    if (!hexIntersectsView(placed.cell.col, placed.cell.row)) continue;
    const { x, y } = hexOrigin(placed.cell.col, placed.cell.row);
    drawPlacedCell(placed, { ctx, x, y, width: hexRectangleWidth, midY: y + sideLength, zoom: camera.zoom });
  }
  drawOverlays({ ctx, width: hexRectangleWidth, side: sideLength, zoom: camera.zoom, origin: hexOrigin });
  pumpPops(render);

  if (hover) {
    const { x, y } = hexOrigin(hover.col, hover.row);
    ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    drawHexagon(x, y, true);
  }
  for (const listener of renderListeners) listener();
}

function pixelToHex(x: number, y: number): Hex {
  const px = x - hexRadius;
  const py = y - hexRectangleHeight / 2;
  const q = ((Math.sqrt(3) / 3) * px - py / 3) / sideLength;
  const r = ((2 / 3) * py) / sideLength;
  const rounded = cubeRound(q, r);
  const parity = ((rounded.r % 2) + 2) % 2;
  return {
    col: rounded.q + (rounded.r - parity) / 2,
    row: rounded.r,
  };
}

function cubeRound(q: number, r: number): { q: number; r: number } {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
}

function hexOrigin(col: number, row: number): { x: number; y: number } {
  const parity = ((row % 2) + 2) % 2;
  return {
    x: col * hexRectangleWidth + parity * hexRadius,
    y: row * rowStep,
  };
}

function drawHexagon(x: number, y: number, fill = true): void {
  ctx.lineWidth = 1 / (outputScale * camera.zoom);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.16)";
  ctx.beginPath();
  ctx.moveTo(x + hexRadius, y);
  ctx.lineTo(x + hexRectangleWidth, y + hexHeight);
  ctx.lineTo(x + hexRectangleWidth, y + hexHeight + sideLength);
  ctx.lineTo(x + hexRadius, y + hexRectangleHeight);
  ctx.lineTo(x, y + sideLength + hexHeight);
  ctx.lineTo(x, y + hexHeight);
  ctx.closePath();

  if (fill) {
    ctx.fill();
  } else {
    ctx.stroke();
  }
}
