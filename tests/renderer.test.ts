import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  renderFrame,
  createFrameRenderer,
  fitToTerminal,
  renderProgressBar,
  renderInputLine,
} from "../src/renderer.js";
import type { FrameData } from "../src/types.js";

describe("renderer", () => {
  describe("renderFrame", () => {
    it("converts a frame buffer to ANSI string with correct line count", () => {
      // 4x2 frame (4 wide, 2 tall), RGB24
      const width = 4;
      const height = 2;
      const data = Buffer.alloc(width * height * 3, 128); // mid-gray

      const frame: FrameData = { data, width, height, timestamp: 0 };
      const result = renderFrame(frame);

      const lines = result.split("\n");
      assert.equal(lines.length, height, `should have ${height} lines`);
    });

    it("renders black frame without crashing", () => {
      const width = 2;
      const height = 2;
      const data = Buffer.alloc(width * height * 3, 0);

      const frame: FrameData = { data, width, height, timestamp: 0 };
      const result = renderFrame(frame);

      assert.ok(typeof result === "string");
      assert.ok(result.length > 0);
    });

    it("handles 1x1 frame", () => {
      const data = Buffer.from([255, 128, 64]);
      const frame: FrameData = { data, width: 1, height: 1, timestamp: 0 };

      const result = renderFrame(frame);
      const lines = result.split("\n");
      assert.equal(lines.length, 1);
    });
  });

  describe("createFrameRenderer", () => {
    it("supports 256-color rendering mode", () => {
      const renderer = createFrameRenderer({ colorMode: "256" });
      const frame: FrameData = {
        data: Buffer.from([255, 0, 0]),
        width: 1,
        height: 1,
        timestamp: 0,
      };

      const output = renderer.render(frame);
      assert.ok(output.includes("\x1b[48;5;"), "should use 256-color escape code");
    });

    it("supports mono rendering mode", () => {
      const renderer = createFrameRenderer({ colorMode: "mono" });
      const frame: FrameData = {
        data: Buffer.from([255, 255, 255]),
        width: 1,
        height: 1,
        timestamp: 0,
      };

      const output = renderer.render(frame);
      assert.ok(
        output.includes("\x1b[47m") || output.includes("\x1b[40m"),
        "block mode should use monochrome background code"
      );
    });

    it("supports ASCII render mode with glyph output", () => {
      const renderer = createFrameRenderer({ renderMode: "ascii", colorMode: "256" });
      const frame: FrameData = {
        data: Buffer.from([0, 0, 0, 255, 255, 255]),
        width: 2,
        height: 1,
        timestamp: 0,
      };

      const output = renderer.render(frame);
      assert.ok(output.includes("\x1b[38;5;"), "should emit ANSI foreground color");
      assert.ok(!output.includes("  "), "ascii mode should emit glyphs, not double-space blocks");
    });

    it("supports halfblock render mode", () => {
      const renderer = createFrameRenderer({ renderMode: "halfblock", colorMode: "truecolor" });
      const frame: FrameData = {
        data: Buffer.from([
          255, 0, 0,
          0, 255, 0,
          0, 0, 255,
          255, 255, 255,
        ]),
        width: 2,
        height: 2,
        timestamp: 0,
      };

      const output = renderer.render(frame);
      assert.ok(output.includes("▀"), "halfblock mode should emit upper-half block glyphs");
      assert.ok(output.includes("\x1b[38;2;"), "should emit ANSI foreground truecolor");
      assert.ok(output.includes("\x1b[48;2;"), "should emit ANSI background truecolor");
      assert.equal(output.split("\n").length, 1, "2 input rows should collapse into 1 terminal row");
    });

    it("supports braille render mode", () => {
      const renderer = createFrameRenderer({ renderMode: "braille", colorMode: "truecolor" });
      const frame: FrameData = {
        data: Buffer.from([
          255, 255, 255, 0, 0, 0,
          255, 255, 255, 0, 0, 0,
          255, 255, 255, 0, 0, 0,
          255, 255, 255, 0, 0, 0,
        ]),
        width: 2,
        height: 4,
        timestamp: 0,
      };

      const output = renderer.render(frame);
      assert.ok(output.includes("\x1b[38;2;"), "should emit ANSI foreground truecolor");
      assert.equal(output.split("\n").length, 1, "4 input rows should collapse into 1 braille row");
    });

    it("supports floyd dithering in ASCII mode", () => {
      const renderer = createFrameRenderer({
        renderMode: "ascii",
        colorMode: "mono",
        ditherMode: "floyd",
        gamma: 1.1,
        contrast: 1.2,
      });
      const frame: FrameData = {
        data: Buffer.from([
          20, 20, 20,
          120, 120, 120,
          200, 200, 200,
          250, 250, 250,
        ]),
        width: 4,
        height: 1,
        timestamp: 0,
      };

      const output = renderer.render(frame);
      assert.ok(output.length > 0, "floyd mode should render output");
      assert.ok(!output.includes("  "), "should remain glyph-based in ascii mode");
    });
  });

  describe("fitToTerminal", () => {
    it("fits a 16:9 video to an 80x24 terminal", () => {
      const result = fitToTerminal(16 / 9, { rows: 24, cols: 80 });

      // maxWidth=80, maxHeight=22 (rows-2)
      // height=80/(16/9)=45 > 22, capped at 22, width=22*(16/9)=39
      assert.equal(result.width, 39);
      assert.equal(result.height, 22);
    });

    it("fits a 4:3 video to a wide terminal", () => {
      const result = fitToTerminal(4 / 3, { rows: 50, cols: 200 });

      // maxWidth=200, maxHeight=48
      // height=200/(4/3)=150 > 48, capped at 48, width=48*(4/3)=64
      assert.equal(result.width, 64);
      assert.equal(result.height, 48);
    });

    it("fits a portrait video to landscape terminal", () => {
      const result = fitToTerminal(9 / 16, { rows: 24, cols: 80 });

      // maxWidth=80, maxHeight=22
      // height=80/(9/16)=142 > 22, capped at 22, width=22*(9/16)=12
      assert.equal(result.width, 12);
      assert.equal(result.height, 22);
    });

    it("never returns zero or negative dimensions", () => {
      const result = fitToTerminal(16 / 9, { rows: 2, cols: 4 });

      assert.ok(result.width >= 1);
      assert.ok(result.height >= 1);
    });

    it("handles square video (1:1)", () => {
      const result = fitToTerminal(1, { rows: 30, cols: 80 });

      // maxWidth=80, maxHeight=28
      // height=80/1=80 > 28, capped at 28, width=28*1=28
      assert.equal(result.width, 28);
      assert.equal(result.height, 28);
    });

    it("fits braille mode with denser sampling", () => {
      const result = fitToTerminal(16 / 9, { rows: 24, cols: 80 }, "braille");
      assert.ok(result.width > 39, "braille should target denser horizontal sampling");
      assert.ok(result.height > 22, "braille should target denser vertical sampling");
    });
  });

  describe("renderProgressBar", () => {
    it("renders progress bar with elapsed and duration", () => {
      const bar = renderProgressBar(45, 120, 80, false);

      assert.ok(bar.includes("0:45"), "should show elapsed time");
      assert.ok(bar.includes("2:00"), "should show duration");
      assert.ok(bar.includes("█"), "should have filled characters");
      assert.ok(bar.includes("░"), "should have empty characters");
      assert.equal(bar.length, 80, "should fill exactly cols width");
    });

    it("shows paused state", () => {
      const bar = renderProgressBar(10, 60, 80, true);
      assert.ok(bar.includes("paused"), "should show paused indicator");
    });

    it("shows control hints when not paused", () => {
      const bar = renderProgressBar(10, 60, 80, false);
      assert.ok(bar.includes("/p"), "should show pause hint");
      assert.ok(bar.includes("/q"), "should show quit hint");
    });

    it("truncates to terminal width", () => {
      const bar = renderProgressBar(1.1, 2.2, 20, false);
      assert.equal(bar.length, 20);
    });
  });

  describe("renderInputLine", () => {
    it("renders input with prompt prefix", () => {
      const line = renderInputLine("/p", 80);
      assert.ok(line.includes(" > /p"));
      assert.equal(line.length, 80);
    });

    it("renders empty buffer", () => {
      const line = renderInputLine("", 80);
      assert.ok(line.includes(" > "));
      assert.equal(line.length, 80);
    });
  });
});
