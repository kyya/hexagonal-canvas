// Locks the Apple-style keyline sizing of agent icons (src/cells/keyline.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classifyInk, keylineBox, placeOnKeyline, type Ink } from "./keyline.ts";

const D = 42;
const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: expected ${expected}, got ${actual}`);

const ink = (width: number, height: number, cornersInked: boolean, x = (1 - width) / 2, y = (1 - height) / 2): Ink => ({ x, y, width, height, cornersInked });

describe("keyline classification", () => {
  test("round glyphs, filled tiles, wide and tall marks", () => {
    assert.equal(classifyInk(ink(0.9, 0.9, false)), "circle");
    assert.equal(classifyInk(ink(0.8, 0.8, true)), "square");
    assert.equal(classifyInk(ink(0.95, 0.6, false)), "landscape");
    assert.equal(classifyInk(ink(0.5, 0.9, true)), "portrait");
  });
});

describe("keyline boxes carry equal visual weight", () => {
  const circleArea = (Math.PI * D * D) / 4;
  test("the circle spans the keyline diameter", () => {
    assert.deepEqual(keylineBox("circle", D), { width: D, height: D });
  });
  test("the square has the circle's area, so it is drawn smaller than the circle", () => {
    const { width, height } = keylineBox("square", D);
    close(width * height, circleArea, "square area");
    assert.ok(width < D);
  });
  test("wide and tall rectangles span the diameter along their long side with the circle's area", () => {
    const wide = keylineBox("landscape", D);
    close(wide.width, D, "landscape width");
    close(wide.width * wide.height, circleArea, "landscape area");
    const tall = keylineBox("portrait", D);
    close(tall.height, D, "portrait height");
    close(tall.width * tall.height, circleArea, "portrait area");
  });
});

describe("placing an icon on its keyline", () => {
  test("a filled tile's ink is scaled to the square keyline and centred", () => {
    const tile = ink(0.8, 0.8, true, 0.1, 0.12);
    const placed = placeOnKeyline(tile, D, 100, 50);
    const side = keylineBox("square", D).width;
    close(tile.width * placed.size, side, "ink width");
    close(placed.x + (tile.x + tile.width / 2) * placed.size, 100, "ink centred horizontally");
    close(placed.y + (tile.y + tile.height / 2) * placed.size, 50, "ink centred vertically");
  });
  test("uneven file padding does not shift the ink off centre", () => {
    const offset = ink(0.6, 0.6, false, 0.3, 0.05);
    const placed = placeOnKeyline(offset, D, 0, 0);
    close(placed.x + (offset.x + offset.width / 2) * placed.size, 0, "x");
    close(placed.y + (offset.y + offset.height / 2) * placed.size, 0, "y");
    close(offset.width * placed.size, D, "circle ink spans the diameter");
  });
  test("a wide mark fills the keyline width, not the square", () => {
    const wide = ink(0.9, 0.5, false);
    const placed = placeOnKeyline(wide, D, 0, 0);
    close(wide.width * placed.size, D, "wide ink spans D");
    assert.ok(wide.height * placed.size <= keylineBox("landscape", D).height + 1e-9);
  });
});
