import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { createTestVideo, createSilentVideo } from "./helpers.js";
import { getVideoInfo, extractFrames } from "../src/decoder.js";
import { renderFrame, fitToTerminal } from "../src/renderer.js";
import { extractAudio } from "../src/audio.js";

/**
 * End-to-end integration tests that exercise the full pipeline:
 * video file -> decode -> render -> output string
 * (skips actual terminal write since we're not in a TTY)
 */
describe("player integration", () => {
  let testVideoPath: string;
  let silentVideoPath: string;

  before(async () => {
    testVideoPath = await createTestVideo();
    silentVideoPath = await createSilentVideo();
  });

  it("full pipeline: decode -> render produces valid ANSI output", async () => {
    const info = await getVideoInfo(testVideoPath);
    const aspect = info.width / info.height;
    const { width, height } = fitToTerminal(aspect, { rows: 24, cols: 80 });

    const frames = extractFrames(testVideoPath, width, height, 5);
    let renderedCount = 0;

    for await (const frame of frames) {
      const output = renderFrame(frame);

      assert.ok(typeof output === "string", "rendered output should be a string");
      assert.ok(output.includes("\x1b["), "should contain ANSI escape codes");
      assert.ok(output.includes("  "), "should contain block characters (2 spaces)");

      const lines = output.split("\n");
      assert.equal(lines.length, height, `should have ${height} lines`);

      renderedCount++;
      if (renderedCount >= 3) break; // test 3 frames
    }

    assert.ok(renderedCount >= 1, "should render at least 1 frame");
  });

  it("pipeline with audio extraction", async () => {
    const audioPath = await extractAudio(testVideoPath);
    assert.ok(audioPath !== null, "should extract audio");

    // Verify we can also decode frames simultaneously
    const frames = extractFrames(testVideoPath, 16, 12, 2);
    const first = await frames.next();
    assert.ok(!first.done, "should decode frames alongside audio");

    // Cleanup
    if (audioPath) {
      const { unlink } = await import("node:fs/promises");
      await unlink(audioPath).catch(() => {});
    }
    for await (const _ of frames) { break; }
  });

  it("silent video pipeline works without audio", async () => {
    const info = await getVideoInfo(silentVideoPath);
    assert.equal(info.hasAudio, false);

    const audioPath = await extractAudio(silentVideoPath);
    assert.equal(audioPath, null, "should not extract audio from silent video");

    // Video frames should still work
    const frames = extractFrames(silentVideoPath, 20, 15, 5);
    const first = await frames.next();
    assert.ok(!first.done);

    for await (const _ of frames) { break; }
  });

  it("handles different resolution targets without crashing", async () => {
    const resolutions = [
      { w: 1, h: 1 },
      { w: 10, h: 10 },
      { w: 80, h: 24 },
      { w: 160, h: 90 },
    ];

    for (const { w, h } of resolutions) {
      const frames = extractFrames(testVideoPath, w, h, 1);
      const first = await frames.next();
      assert.ok(!first.done, `should work at ${w}x${h}`);
      assert.equal(first.value.data.length, w * h * 3);

      for await (const _ of frames) { break; }
    }
  });
});
