import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  rgbToAnsi256,
  rgbToTrueColorBg,
  rgbToBg256,
  renderRow,
  ansi,
} from "../src/ansi.js";

describe("ansi", () => {
  describe("rgbToAnsi256", () => {
    it("maps black to code 16", () => {
      assert.equal(rgbToAnsi256(0, 0, 0), 16);
    });

    it("maps white to code 231", () => {
      assert.equal(rgbToAnsi256(255, 255, 255), 231);
    });

    it("maps pure red to the red corner of the cube", () => {
      const code = rgbToAnsi256(255, 0, 0);
      // Red corner of 6x6x6 cube is index 16 + 36*5 = 196
      assert.equal(code, 196);
    });

    it("maps pure green to the green corner", () => {
      const code = rgbToAnsi256(0, 255, 0);
      assert.equal(code, 16 + 6 * 5); // 16 + 30 = 46
    });

    it("maps pure blue to the blue corner", () => {
      const code = rgbToAnsi256(0, 0, 255);
      assert.equal(code, 16 + 5); // 16 + 5 = 21
    });

    it("maps grayscale values to the grayscale ramp (232-255)", () => {
      const dark = rgbToAnsi256(50, 50, 50);
      const mid = rgbToAnsi256(128, 128, 128);
      const bright = rgbToAnsi256(200, 200, 200);

      assert.ok(dark >= 232 && dark <= 255, `dark gray ${dark} should be in 232-255`);
      assert.ok(mid >= 232 && mid <= 255, `mid gray ${mid} should be in 232-255`);
      assert.ok(bright >= 232 && bright <= 255, `bright gray ${bright} should be in 232-255`);
      assert.ok(dark < mid && mid < bright, "should be monotonic");
    });

    it("handles boundary values", () => {
      // Near-black (below 8 should be 16)
      assert.equal(rgbToAnsi256(3, 3, 3), 16);
      // Near-white (above 248 should be 231)
      assert.equal(rgbToAnsi256(250, 250, 250), 231);
    });
  });

  describe("rgbToTrueColorBg", () => {
    it("produces correct 24-bit escape sequence", () => {
      assert.equal(rgbToTrueColorBg(255, 0, 128), "\x1b[48;2;255;0;128m");
    });

    it("handles zero values", () => {
      assert.equal(rgbToTrueColorBg(0, 0, 0), "\x1b[48;2;0;0;0m");
    });
  });

  describe("rgbToBg256", () => {
    it("produces correct 256-color escape sequence", () => {
      assert.equal(rgbToBg256(0, 0, 0), "\x1b[48;5;16m");
      assert.equal(rgbToBg256(255, 255, 255), "\x1b[48;5;231m");
    });
  });

  describe("renderRow", () => {
    it("renders a row of pixels into ANSI colored string", () => {
      // 3 pixels: red, green, blue
      const row = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
      const result = renderRow(row, 3, true);

      assert.ok(result.includes("\x1b[48;2;255;0;0m"), "should contain red");
      assert.ok(result.includes("\x1b[48;2;0;255;0m"), "should contain green");
      assert.ok(result.includes("\x1b[48;2;0;0;255m"), "should contain blue");
      assert.ok(result.endsWith("\x1b[0m"), "should end with reset");
    });

    it("renders each pixel as two spaces", () => {
      const row = Buffer.from([0, 0, 0]); // 1 pixel
      const result = renderRow(row, 1, true);

      // Should contain "  " (two spaces) for the pixel
      assert.ok(result.includes("  "), "each pixel should be two spaces");
    });

    it("handles 256-color mode", () => {
      const row = Buffer.from([255, 0, 0]);
      const result = renderRow(row, 1, false);

      assert.ok(result.includes("\x1b[48;5;"), "should use 256-color codes");
    });

    it("handles empty row", () => {
      const row = Buffer.alloc(0);
      const result = renderRow(row, 0);
      assert.equal(result, "\x1b[0m");
    });
  });

  describe("ansi constants", () => {
    it("exports valid escape sequences", () => {
      assert.ok(ansi.hideCursor.startsWith("\x1b["));
      assert.ok(ansi.showCursor.startsWith("\x1b["));
      assert.ok(ansi.clearScreen.startsWith("\x1b["));
      assert.ok(ansi.home.startsWith("\x1b["));
      assert.ok(ansi.reset.startsWith("\x1b["));
    });
  });
});
