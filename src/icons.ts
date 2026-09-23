import claudeUrl from "@lobehub/icons-static-svg/icons/claude-color.svg?url";
import deepseekUrl from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import geminiUrl from "@lobehub/icons-static-svg/icons/gemini-color.svg?url";
import kimiUrl from "@lobehub/icons-static-svg/icons/kimi-color.svg?url";
import openaiUrl from "@lobehub/icons-static-svg/icons/openai.svg?url";
import qoderUrl from "@lobehub/icons-static-svg/icons/qoder-color.svg?url";
import xaiUrl from "@lobehub/icons-static-svg/icons/xai.svg?url";
import twemoji from "twemoji";

const TWEMOJI_SVG = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/";

export type LobeSlug = "openai" | "claude" | "xai" | "gemini" | "deepseek" | "kimi" | "qoder";

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
};

const AGENT_SLUG = {
  claude: "claude",
  codex: "openai",
  grok: "xai",
  kimi: "kimi",
  qoder: "qoder",
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

function loadIcon(icon: HexIcon, onLoad: () => void): HTMLImageElement {
  const key = iconKey(icon);
  const cached = images.get(key);
  if (cached) return cached;

  const image = new Image();
  image.onload = onLoad;
  image.src = iconUrl(icon);
  images.set(key, image);
  return image;
}

export function iconReady(icon: HexIcon, onLoad: () => void): boolean {
  return loadIcon(icon, onLoad).naturalWidth > 0;
}

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
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);
  ctx.drawImage(image, -size / 2, -size / 2, size, size);
  ctx.restore();
  return true;
}
