import { describe, it, before, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { extractAudio, cleanupAudio } from "../src/audio.js";
import { createTestVideo, createSilentVideo } from "./helpers.js";

describe("audio", () => {
  let testVideoPath: string;
  let silentVideoPath: string;
  let extractedPath: string | null = null;

  before(async () => {
    testVideoPath = await createTestVideo();
    silentVideoPath = await createSilentVideo();
  });

  afterEach(async () => {
    if (extractedPath) {
      await cleanupAudio(extractedPath);
      extractedPath = null;
    }
  });

  describe("extractAudio", () => {
    it("extracts audio from a video with audio track", async () => {
      extractedPath = await extractAudio(testVideoPath);

      assert.ok(extractedPath !== null, "should return a path");
      assert.ok(existsSync(extractedPath), "extracted file should exist");
      assert.ok(extractedPath.endsWith(".wav"), "should be WAV format");
    });

    it("returns null for video without audio", async () => {
      const result = await extractAudio(silentVideoPath);
      assert.equal(result, null, "should return null for silent video");
    });

    it("extracted audio file is non-empty", async () => {
      extractedPath = await extractAudio(testVideoPath);

      if (extractedPath) {
        const { statSync } = await import("node:fs");
        const stat = statSync(extractedPath);
        assert.ok(stat.size > 0, "extracted audio should be non-empty");
      }
    });
  });

  describe("cleanupAudio", () => {
    it("removes the audio file", async () => {
      extractedPath = await extractAudio(testVideoPath);

      if (extractedPath) {
        assert.ok(existsSync(extractedPath));
        await cleanupAudio(extractedPath);
        assert.ok(!existsSync(extractedPath), "file should be removed");
        extractedPath = null; // prevent double cleanup
      }
    });

    it("does not throw for non-existent file", async () => {
      await assert.doesNotReject(() => cleanupAudio("/tmp/does-not-exist.wav"));
    });
  });
});
