import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import {
  getVideoInfo,
  ensureDependencies,
  hasFfplay,
  createFrameRenderer,
  resolvePlayOptions,
  detectTerminalCapabilities,
  resolveEffectiveRenderMode,
} from "../src/index.js";
import { TerminalVideoError, DependencyError, FileError, DecodeError } from "../src/index.js";
import { createTestVideo } from "./helpers.js";

/**
 * Tests for the public programmatic API (importable from "terminal-video").
 */
describe("programmatic API", () => {
  let testVideoPath: string;

  before(async () => {
    testVideoPath = await createTestVideo();
  });

  describe("exports", () => {
    it("exports play function", async () => {
      const mod = await import("../src/index.js");
      assert.equal(typeof mod.play, "function");
    });

    it("exports getVideoInfo function", async () => {
      const mod = await import("../src/index.js");
      assert.equal(typeof mod.getVideoInfo, "function");
    });

    it("exports ensureDependencies function", async () => {
      const mod = await import("../src/index.js");
      assert.equal(typeof mod.ensureDependencies, "function");
    });

    it("exports hasFfplay function", async () => {
      const mod = await import("../src/index.js");
      assert.equal(typeof mod.hasFfplay, "function");
    });

    it("exports createFrameRenderer function", async () => {
      const mod = await import("../src/index.js");
      assert.equal(typeof mod.createFrameRenderer, "function");
    });

    it("exports resolvePlayOptions function", async () => {
      const mod = await import("../src/index.js");
      assert.equal(typeof mod.resolvePlayOptions, "function");
    });

    it("exports terminal capability helpers", async () => {
      const mod = await import("../src/index.js");
      assert.equal(typeof mod.detectTerminalCapabilities, "function");
      assert.equal(typeof mod.resolveEffectiveRenderMode, "function");
    });

    it("exports error classes", async () => {
      const mod = await import("../src/index.js");
      assert.equal(typeof mod.TerminalVideoError, "function");
      assert.equal(typeof mod.DependencyError, "function");
      assert.equal(typeof mod.FileError, "function");
      assert.equal(typeof mod.DecodeError, "function");
    });
  });

  describe("getVideoInfo via public API", () => {
    it("returns typed video info", async () => {
      const info = await getVideoInfo(testVideoPath);

      assert.equal(typeof info.width, "number");
      assert.equal(typeof info.height, "number");
      assert.equal(typeof info.fps, "number");
      assert.equal(typeof info.duration, "number");
      assert.equal(typeof info.totalFrames, "number");
      assert.equal(typeof info.hasAudio, "boolean");
    });
  });

  describe("error classes via public API", () => {
    it("DependencyError has installation instructions", () => {
      const err = new DependencyError("ffmpeg");
      assert.ok(err.message.includes("ffmpeg.org"));
    });

    it("errors are catchable as TerminalVideoError", () => {
      const errors = [
        new DependencyError("x"),
        new FileError("x"),
        new DecodeError("x"),
      ];

      for (const err of errors) {
        assert.ok(err instanceof TerminalVideoError);
        assert.ok(err instanceof Error);
      }
    });
  });

  describe("resolved options via public API", () => {
    it("returns normalized resolved options for profile", () => {
      const options = resolvePlayOptions({ profile: "potato", fps: 30 });
      assert.equal(options.profile, "potato");
      assert.ok(options.fps <= options.maxFps, "fps should be clamped to profile max");
      assert.ok(options.fps >= options.minFps, "fps should be above profile min");
    });

    it("auto profile resolves to a concrete active profile", () => {
      const options = resolvePlayOptions({ profile: "auto", scale: 0.5 });
      assert.equal(options.profile, "auto");
      assert.equal(options.activeProfile, "potato");
    });

    it("detects capabilities and resolves auto render mode", () => {
      const caps = detectTerminalCapabilities();
      assert.equal(typeof caps.trueColor, "boolean");
      const mode = resolveEffectiveRenderMode("auto", caps);
      assert.ok(["ascii", "halfblock", "block"].includes(mode));
    });
  });
});
