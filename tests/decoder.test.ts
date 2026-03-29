import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { getVideoInfo, extractFrames } from "../src/decoder.js";
import { createTestVideo, createSilentVideo } from "./helpers.js";
import { FileError, DecodeError } from "../src/errors.js";

describe("decoder", () => {
  let testVideoPath: string;
  let silentVideoPath: string;

  before(async () => {
    testVideoPath = await createTestVideo();
    silentVideoPath = await createSilentVideo();
  });

  describe("getVideoInfo", () => {
    it("returns correct metadata for test video", async () => {
      const info = await getVideoInfo(testVideoPath);

      assert.equal(info.width, 320);
      assert.equal(info.height, 240);
      assert.ok(info.fps >= 9 && info.fps <= 11, `fps should be ~10, got ${info.fps}`);
      assert.ok(info.duration >= 1.5 && info.duration <= 3, `duration should be ~2s, got ${info.duration}`);
      assert.ok(info.totalFrames >= 15, `should have ~20 frames, got ${info.totalFrames}`);
      assert.equal(info.hasAudio, true, "test video should have audio");
    });

    it("detects silent video has no audio", async () => {
      const info = await getVideoInfo(silentVideoPath);
      assert.equal(info.hasAudio, false, "silent video should not have audio");
    });

    it("throws FileError for non-existent file", async () => {
      await assert.rejects(
        () => getVideoInfo("/does/not/exist.mp4"),
        (err: unknown) => err instanceof FileError
      );
    });

    it("returns positive values for all numeric fields", async () => {
      const info = await getVideoInfo(testVideoPath);

      assert.ok(info.width > 0);
      assert.ok(info.height > 0);
      assert.ok(info.fps > 0);
      assert.ok(info.duration > 0);
      assert.ok(info.totalFrames > 0);
    });
  });

  describe("extractFrames", () => {
    it("yields frames with correct dimensions", async () => {
      const targetW = 80;
      const targetH = 60;
      const frames = extractFrames(testVideoPath, targetW, targetH, 5);

      const first = await frames.next();
      assert.ok(!first.done, "should yield at least one frame");

      const frame = first.value;
      assert.equal(frame.width, targetW);
      assert.equal(frame.height, targetH);
      assert.equal(frame.data.length, targetW * targetH * 3);

      // Cleanup: consume remaining frames
      for await (const _ of frames) { break; }
    });

    it("yields the expected number of frames at target FPS", async () => {
      const targetFps = 5;
      const frames = extractFrames(testVideoPath, 40, 30, targetFps);

      let count = 0;
      for await (const _ of frames) {
        count++;
        if (count > 20) break; // safety limit
      }

      // 2 seconds at 5fps = ~10 frames, allow some tolerance
      assert.ok(count >= 5 && count <= 15,
        `expected 5-15 frames at ${targetFps}fps, got ${count}`);
    });

    it("frame data contains non-zero pixel values", async () => {
      const frames = extractFrames(testVideoPath, 16, 12, 1);

      const first = await frames.next();
      assert.ok(!first.done);

      const data = first.value.data;
      let hasNonZero = false;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) {
          hasNonZero = true;
          break;
        }
      }
      assert.ok(hasNonZero, "frame should contain non-zero pixel data");

      // Cleanup
      for await (const _ of frames) { break; }
    });

    it("frame timestamps are monotonically increasing", async () => {
      const frames = extractFrames(testVideoPath, 32, 24, 5);
      let prevTimestamp = -1;
      let checked = 0;

      for await (const frame of frames) {
        assert.ok(frame.timestamp > prevTimestamp,
          `timestamp ${frame.timestamp} should be > ${prevTimestamp}`);
        prevTimestamp = frame.timestamp;
        checked++;
        if (checked >= 5) break;
      }

      assert.ok(checked >= 2, "should have checked multiple frames");
    });

    it("handles small resolution (1x1)", async () => {
      const frames = extractFrames(testVideoPath, 1, 1, 1);

      const first = await frames.next();
      assert.ok(!first.done);
      assert.equal(first.value.data.length, 3); // 1 pixel * 3 bytes (RGB)

      for await (const _ of frames) { break; }
    });
  });
});
