// Apple-style icon keylines: logos come in different shapes (round glyphs, filled rounded tiles,
// wide wordmarks), and drawing them all in the same box makes tiles look heavier than glyphs. Like
// the keyline shapes in Apple's icon grid, each icon is classified by the shape of its ink and scaled
// so every shape carries the same visual weight: a circle spans the keyline diameter D, a square has
// the circle's area (side D·√π/2), and wide or tall shapes span D along their long side with the
// circle's area (short side D·π/4). The ink, not the file's padding, is centred.

export type Keyline = "circle" | "square" | "landscape" | "portrait";

// Where the ink sits inside the source image, as fractions of its width and height.
export type Ink = {
  x: number;
  y: number;
  width: number;
  height: number;
  // Whether the ink reaches into the bounding box's corners (rounded tiles do, circles don't).
  cornersInked: boolean;
};

// Beyond this aspect ratio an icon is laid out as a wide or tall rectangle.
const RECTANGLE_ASPECT = 1.2;

export function classifyInk(ink: Ink): Keyline {
  const aspect = ink.width / ink.height;
  if (aspect >= RECTANGLE_ASPECT) return "landscape";
  if (aspect <= 1 / RECTANGLE_ASPECT) return "portrait";
  return ink.cornersInked ? "square" : "circle";
}

// The keyline box for a shape, for a keyline circle of diameter `diameter`.
export function keylineBox(shape: Keyline, diameter: number): { width: number; height: number } {
  const equalAreaSide = (diameter * Math.sqrt(Math.PI)) / 2;
  const equalAreaShort = (diameter * Math.PI) / 4;
  switch (shape) {
    case "circle":
      return { width: diameter, height: diameter };
    case "square":
      return { width: equalAreaSide, height: equalAreaSide };
    case "landscape":
      return { width: diameter, height: equalAreaShort };
    case "portrait":
      return { width: equalAreaShort, height: diameter };
  }
}

// Where to draw the whole (square) source image so its ink fills its keyline box, centred on
// (cx, cy). Returns the image's top-left corner and side length.
export function placeOnKeyline(ink: Ink, diameter: number, cx: number, cy: number): { x: number; y: number; size: number } {
  const box = keylineBox(classifyInk(ink), diameter);
  const size = Math.min(box.width / ink.width, box.height / ink.height);
  return {
    x: cx - (ink.x + ink.width / 2) * size,
    y: cy - (ink.y + ink.height / 2) * size,
    size,
  };
}
