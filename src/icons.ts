import claudeUrl from "@lobehub/icons-static-svg/icons/claude-color.svg?url";
import codebuddyUrl from "@lobehub/icons-static-svg/icons/codebuddy-color.svg?url";
import deepseekUrl from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import geminiUrl from "@lobehub/icons-static-svg/icons/gemini-color.svg?url";
import kimiUrl from "@lobehub/icons-static-svg/icons/kimi.svg?url";
import kiroUrl from "@lobehub/icons-static-svg/icons/kiro-color.svg?url";
import openaiUrl from "@lobehub/icons-static-svg/icons/openai.svg?url";
import piUrl from "@lobehub/icons-static-svg/icons/pi.svg?url";
import qoderUrl from "@lobehub/icons-static-svg/icons/qoder-color.svg?url";
import xaiUrl from "@lobehub/icons-static-svg/icons/xai.svg?url";
import twemoji from "twemoji";
import { placeOnKeyline, type Ink } from "./cells/keyline";

const TWEMOJI_SVG = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/";

export type LobeSlug =
  | "openai"
  | "claude"
  | "xai"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "qoder"
  | "codebuddy"
  | "kiro"
  | "pi";

export type HexIcon =
  | { kind: "lobe"; slug: LobeSlug }
  | { kind: "emoji"; emoji: string };

export const ICON_CYCLE: Array<HexIcon | null> = [
  null,
  { kind: "lobe", slug: "openai" },
  { kind: "lobe", slug: "claude" },
  { kind: "lobe", slug: "xai" },
  { kind: "lobe", slug: "gemini" },
  { kind: "lobe", slug: "deepseek" },
  { kind: "emoji", emoji: "😀" },
  { kind: "emoji", emoji: "🚀" },
  { kind: "emoji", emoji: "✨" },
];

const LOBE_URLS: Record<LobeSlug, string> = {
  openai: openaiUrl,
  claude: claudeUrl,
  xai: xaiUrl,
  gemini: geminiUrl,
  deepseek: deepseekUrl,
  kimi: kimiUrl,
  qoder: qoderUrl,
  codebuddy: codebuddyUrl,
  kiro: kiroUrl,
  pi: piUrl,
};

const AGENT_SLUG = {
  claude: "claude",
  codex: "openai",
  grok: "xai",
  kimi: "kimi",
  qoder: "qoder",
  codebuddy: "codebuddy",
  // WorkBuddy is CodeBuddy's desktop sibling; Oh My Pi is a fork of Pi.
  workbuddy: "codebuddy",
  omp: "pi",
  gemini: "gemini",
  kiro: "kiro",
  pi: "pi",
  dsh: "deepseek",
} as const;

export function agentHexIcon(agent: string): HexIcon | null {
  const slug = AGENT_SLUG[agent as keyof typeof AGENT_SLUG];
  if (!slug) return null;
  return { kind: "lobe", slug };
}

const images = new Map<string, HTMLImageElement>();

export function iconsEqual(a: HexIcon | null, b: HexIcon | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "lobe" && b.kind === "lobe") return a.slug === b.slug;
  if (a.kind === "emoji" && b.kind === "emoji") return a.emoji === b.emoji;
  return false;
}

function iconKey(icon: HexIcon): string {
  return icon.kind === "lobe" ? `lobe:${icon.slug}` : `emoji:${icon.emoji}`;
}

export function iconUrl(icon: HexIcon): string {
  if (icon.kind === "lobe") return LOBE_URLS[icon.slug];
  return `${TWEMOJI_SVG}${twemoji.convert.toCodePoint(icon.emoji)}.svg`;
}

const inks = new Map<string, Ink>();
// Resolution of the offscreen raster used to find an icon's ink.
const MEASURE = 128;
const FULL_INK: Ink = { x: 0, y: 0, width: 1, height: 1, cornersInked: true };

// Where the icon's ink sits in its file, and whether it fills its corners (a rounded tile) or not
// (a round glyph). Measured once from an offscreen raster; falls back to the whole image when the
// pixels cannot be read (e.g. a cross-origin emoji).
function measureInk(image: HTMLImageElement): Ink {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = MEASURE;
    canvas.height = MEASURE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return FULL_INK;
    ctx.drawImage(image, 0, 0, MEASURE, MEASURE);
    const data = ctx.getImageData(0, 0, MEASURE, MEASURE).data;
    const inked = (x: number, y: number) => (data[(y * MEASURE + x) * 4 + 3] ?? 0) > 32;
    let left = MEASURE;
    let top = MEASURE;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < MEASURE; y++) {
      for (let x = 0; x < MEASURE; x++) {
        if (!inked(x, y)) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left) return FULL_INK;
    const width = right - left + 1;
    const height = bottom - top + 1;
    // Probe 12% in from each bounding-box corner: inside a rounded tile, outside a circle.
    const inset = 0.12;
    const corners = [
      [left + width * inset, top + height * inset],
      [right - width * inset, top + height * inset],
      [left + width * inset, bottom - height * inset],
      [right - width * inset, bottom - height * inset],
    ].filter(([x, y]) => inked(Math.round(x ?? 0), Math.round(y ?? 0))).length;
    return { x: left / MEASURE, y: top / MEASURE, width: width / MEASURE, height: height / MEASURE, cornersInked: corners >= 3 };
  } catch {
    return FULL_INK;
  }
}

function loadIcon(icon: HexIcon, onLoad: () => void): HTMLImageElement {
  const key = iconKey(icon);
  const cached = images.get(key);
  if (cached) return cached;

  const image = new Image();
  image.onload = () => {
    inks.set(key, measureInk(image));
    onLoad();
  };
  image.src = iconUrl(icon);
  images.set(key, image);
  return image;
}

export function iconReady(icon: HexIcon, onLoad: () => void): boolean {
  return loadIcon(icon, onLoad).naturalWidth > 0;
}

// Test hook: the measured ink of every loaded icon, keyed like "lobe:claude".
export function measuredInks(): Record<string, Ink> {
  return Object.fromEntries(inks);
}

// Draws the icon on its keyline inside the `size` box at (x, y): see src/cells/keyline.ts.
export function drawHexIcon(
  ctx: CanvasRenderingContext2D,
  icon: HexIcon,
  x: number,
  y: number,
  size: number,
  scale: number,
  onLoad: () => void,
): boolean {
  const image = loadIcon(icon, onLoad);
  if (image.naturalWidth === 0) return false;
  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const placed = placeOnKeyline(inks.get(iconKey(icon)) ?? FULL_INK, size, 0, 0);
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);
  ctx.drawImage(image, placed.x, placed.y, placed.size, placed.size);
  ctx.restore();
  return true;
}
