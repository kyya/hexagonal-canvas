const POP_MS = 900;

const pops = new Map<string, number>();
let frame = 0;
let popping = false;

function easeOutElastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const period = (2 * Math.PI) / 3;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * period) + 1;
}

export function armPop(id: string): void {
  pops.set(id, -1);
}

export function clearPop(id: string): void {
  pops.delete(id);
}

export function beginFrame(): void {
  popping = false;
}

export function popScale(id: string, ready: boolean): number {
  if (!pops.has(id)) return 1;
  if (!ready) return 0;
  let start = pops.get(id) ?? -1;
  if (start < 0) {
    start = performance.now();
    pops.set(id, start);
  }
  const t = (performance.now() - start) / POP_MS;
  if (t >= 1) {
    pops.delete(id);
    return 1;
  }
  popping = true;
  return Math.max(0, easeOutElastic(t));
}

export function pumpPops(render: () => void): void {
  if (!popping || frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}
