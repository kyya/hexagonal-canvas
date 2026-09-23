import {
  drawHexIcon,
  ICON_CYCLE,
  iconReady,
  iconUrl,
  iconsEqual,
  type HexIcon,
} from "./icons";

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

const POP_MS = 900;

const chunks = new Map<string, Chunk>();
const hexStates = new Map<string, HexState>();
const iconPops = new Map<string, number>();
let popFrame = 0;
let iconPopping = false;
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
let menuHex: Hex | null = null;
let suppressClick = false;

const menuRoot = document.querySelector<HTMLElement>("#hex-menu");
const menuIdNode = menuRoot?.querySelector<HTMLElement>(".hex-menu-id");
const menuIconsNode = menuRoot?.querySelector<HTMLElement>(".hex-menu-icons");
if (!menuRoot || !menuIdNode || !menuIconsNode) {
  throw new Error("Missing hex menu");
}
const menu: HTMLElement = menuRoot;
const menuId: HTMLElement = menuIdNode;
const menuIcons: HTMLElement = menuIconsNode;

buildMenu();
canvas.style.touchAction = "none";
canvas.addEventListener("contextmenu", onContextMenu);
canvas.addEventListener("wheel", onWheel, { passive: false });
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerCancel);
menu.addEventListener("pointerdown", (event) => event.stopPropagation());
menu.addEventListener("click", onMenuClick);
document.addEventListener("pointerdown", onDocumentPointerDown);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", releasePanKeys);
window.addEventListener("resize", onResize);

loadHexStates();
loadCamera();
fitCanvas();
syncChunks();
render();

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

function buildMenu(): void {
  for (const icon of ICON_CYCLE) {
    if (!icon) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.kind = icon.kind;
    button.dataset.value = icon.kind === "lobe" ? icon.slug : icon.emoji;
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", "false");
    button.setAttribute("aria-label", icon.kind === "lobe" ? icon.slug : icon.emoji);
    const image = document.createElement("img");
    image.alt = "";
    image.src = iconUrl(icon);
    button.append(image);
    menuIcons.append(button);
  }
}

function menuIconOf(button: HTMLButtonElement): HexIcon | null {
  const kind = button.dataset.kind;
  const value = button.dataset.value;
  return (
    ICON_CYCLE.find(
      (icon) =>
        icon !== null &&
        ((icon.kind === "lobe" && kind === "lobe" && icon.slug === value) ||
          (icon.kind === "emoji" && kind === "emoji" && icon.emoji === value)),
    ) ?? null
  );
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  const world = screenToWorld(event.offsetX, event.offsetY);
  const hex = pixelToHex(world.x, world.y);
  openMenu(hex, event.clientX, event.clientY);
}

function openMenu(hex: Hex, x: number, y: number): void {
  menuHex = hex;
  menuId.textContent = hexId(hex.col, hex.row);
  const current = hexState(hex.col, hex.row).icon;
  for (const button of menuIcons.querySelectorAll("button")) {
    const icon = menuIconOf(button);
    button.setAttribute("aria-checked", iconsEqual(icon, current) ? "true" : "false");
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
  menuHex = null;
  menu.hidden = true;
}

function onMenuClick(event: MouseEvent): void {
  const button = (event.target as Element | null)?.closest("button");
  if (!button || !menuHex) return;
  const icon = button.dataset.action === "clear" ? null : menuIconOf(button);
  if (button.dataset.action !== "clear" && !icon) return;
  writeHexState(menuHex.col, menuHex.row, icon);
  closeMenu();
  render();
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
  hover = pixelToHex(hoverWorld.x, hoverWorld.y);
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
  if (mode === "select") {
    if (!moved) {
      const id = hexId(col, row);
      if (selection.has(id)) selection.delete(id);
      else selection.set(id, { col, row });
    }
    render();
    return;
  }
  if (moved) return;
  cycleHex(col, row);
  render();
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

function saveHexStates(): void {
  const payload = [...hexStates.values()];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadCamera(): void {
  try {
    const raw = localStorage.getItem(CAMERA_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const record = parsed as { x?: unknown; y?: unknown; zoom?: unknown };
    if (typeof record.x !== "number" || typeof record.y !== "number") return;
    if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return;
    camera.x = record.x;
    camera.y = record.y;
    if (typeof record.zoom === "number" && Number.isFinite(record.zoom)) {
      camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, record.zoom));
    }
  } catch {
    localStorage.removeItem(CAMERA_KEY);
  }
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

function chunkIndex(value: number): number {
  return Math.floor(value / CHUNK_SIZE);
}

function localIndex(value: number): number {
  return value - chunkIndex(value) * CHUNK_SIZE;
}

function defaultHexState(col: number, row: number): HexState {
  return { id: hexId(col, row), col, row, marked: false, icon: null };
}

function hexState(col: number, row: number): HexState {
  return hexStates.get(hexId(col, row)) ?? defaultHexState(col, row);
}

function writeHexState(col: number, row: number, icon: HexIcon | null): void {
  const id = hexId(col, row);
  const state = { id, col, row, marked: icon !== null, icon };
  if (icon) {
    hexStates.set(id, state);
    iconPops.set(id, -1);
  } else {
    hexStates.delete(id);
    iconPops.delete(id);
  }
  saveHexStates();

  const chunk = chunks.get(chunkKey(chunkIndex(col), chunkIndex(row)));
  if (!chunk) return;
  chunk.cells[localIndex(row) * CHUNK_SIZE + localIndex(col)] = icon
    ? state
    : defaultHexState(col, row);
}

function cycleHex(col: number, row: number): void {
  const current = hexState(col, row).icon;
  const index = ICON_CYCLE.findIndex((icon) => iconsEqual(icon, current));
  const next = ICON_CYCLE[(index + 1) % ICON_CYCLE.length] ?? null;
  writeHexState(col, row, next);
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

function easeOutElastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const period = (2 * Math.PI) / 3;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * period) + 1;
}

function iconPopScale(id: string, ready: boolean): number {
  if (!iconPops.has(id)) return 1;
  if (!ready) return 0;
  let start = iconPops.get(id) ?? -1;
  if (start < 0) {
    start = performance.now();
    iconPops.set(id, start);
  }
  const t = (performance.now() - start) / POP_MS;
  if (t >= 1) {
    iconPops.delete(id);
    return 1;
  }
  iconPopping = true;
  return Math.max(0, easeOutElastic(t));
}

function pumpIconPops(): void {
  if (!iconPopping || popFrame !== 0) return;
  popFrame = requestAnimationFrame(() => {
    popFrame = 0;
    render();
  });
}

function render(): void {
  iconPopping = false;
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

  const iconSize = 48;
  for (const cell of icons) {
    if (!cell.icon) continue;
    const { x, y } = hexOrigin(cell.col, cell.row);
    const ready = iconReady(cell.icon, render);
    const scale = iconPopScale(cell.id, ready);
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
  pumpIconPops();

  if (hover) {
    const { x, y } = hexOrigin(hover.col, hover.row);
    ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    drawHexagon(x, y, true);
  }
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
