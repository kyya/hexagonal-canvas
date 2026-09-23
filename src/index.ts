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

type Chunk = {
  col: number;
  row: number;
};

type Hex = {
  col: number;
  row: number;
};

const chunks = new Map<string, Chunk>();
const camera = { x: 0, y: 0 };
let hover: Hex | null = null;
let pointer: { id: number; x: number; y: number } | null = null;

canvas.style.touchAction = "none";
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
window.addEventListener("resize", onResize);

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
  fitCanvas();
  syncChunks();
  render();
}

function onPointerDown(event: PointerEvent): void {
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = "grabbing";
}

function onPointerMove(event: PointerEvent): void {
  if (pointer && pointer.id === event.pointerId) {
    camera.x -= event.clientX - pointer.x;
    camera.y -= event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    syncChunks();
  }
  hover = pixelToHex(event.offsetX + camera.x, event.offsetY + camera.y);
  render();
}

function onPointerUp(event: PointerEvent): void {
  if (!pointer || pointer.id !== event.pointerId) return;
  pointer = null;
  canvas.style.cursor = "default";
}

function chunkKey(col: number, row: number): string {
  return `${col},${row}`;
}

function generateChunk(col: number, row: number): Chunk {
  return { col, row };
}

function visibleHexBounds(): { col0: number; col1: number; row0: number; row1: number } {
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
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
    x < camera.x + window.innerWidth &&
    x + hexRectangleWidth > camera.x &&
    y < camera.y + window.innerHeight &&
    y + hexRectangleHeight > camera.y
  );
}

function render(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.translate(-camera.x, -camera.y);

  for (const chunk of chunks.values()) {
    const col0 = chunk.col * CHUNK_SIZE;
    const row0 = chunk.row * CHUNK_SIZE;
    for (let row = row0; row < row0 + CHUNK_SIZE; row++) {
      for (let col = col0; col < col0 + CHUNK_SIZE; col++) {
        if (!hexIntersectsView(col, row)) continue;
        const { x, y } = hexOrigin(col, row);
        drawHexagon(x, y, false);
      }
    }
  }

  if (hover) {
    const { x, y } = hexOrigin(hover.col, hover.row);
    ctx.fillStyle = "#333333";
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
  ctx.lineWidth = 1 / outputScale;
  ctx.strokeStyle = "#333333";
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
