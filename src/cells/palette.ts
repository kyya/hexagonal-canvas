// Stable colour per project: hash the path into a hue (0–359). No imports, so tests can load it.
export function projectHue(cwd: string): number {
  let hash = 0;
  for (const char of cwd) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}
