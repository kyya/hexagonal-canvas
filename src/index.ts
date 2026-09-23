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

fitCanvas();

// 参数
const hexagonAngle = Math.PI / 6; // 30 degrees in radians
const sideLength = 64;
const boardWidth = 100;
const boardHeight = 100;

const hexHeight = Math.sin(hexagonAngle) * sideLength;
const hexRadius = Math.cos(hexagonAngle) * sideLength;
const hexRectangleHeight = sideLength + 2 * hexHeight;
const hexRectangleWidth = 2 * hexRadius;

// 开始动画
render();

// 监听鼠标位置
canvas.addEventListener("mousemove", onMouseMove);
window.addEventListener("resize", onResize);

function fitCanvas(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * outputScale;
  canvas.height = height * outputScale;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
}

function onResize(): void {
  fitCanvas();
  render();
}

function onMouseMove(event: MouseEvent): void {
  const x = event.offsetX;
  const y = event.offsetY;
  const { col: hexX, row: hexY } = pixelToHex(x, y);
  const screenX = hexX * hexRectangleWidth + (hexY % 2) * hexRadius;
  const screenY = hexY * (hexHeight + sideLength);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawBoard(boardWidth, boardHeight);

  // Check if the mouse's coords are on the board
  if (hexX >= 0 && hexX < boardWidth && hexY >= 0 && hexY < boardHeight) {
    ctx.fillStyle = "#333333";
    drawHexagon(screenX, screenY, true);
    drawPoint(screenX + hexRectangleWidth / 2, screenY + sideLength, hexHeight);
  }
}

function pixelToHex(x: number, y: number): { col: number; row: number } {
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

function drawPoint(x: number, y: number, radian = 3): void {
  ctx.beginPath();
  ctx.arc(x, y, radian, 0, 2 * Math.PI);
  ctx.fillStyle = "#FFF";
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fill();
  ctx.closePath();
}

function drawBoard(width: number, height: number): void {
  for (let i = 0; i < width; ++i) {
    for (let j = 0; j < height; ++j) {
      drawHexagon(
        i * hexRectangleWidth + (j % 2) * hexRadius,
        j * (sideLength + hexHeight),
        false,
      );
    }
  }
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

function render(): void {
  drawBoard(boardWidth, boardHeight);
}
