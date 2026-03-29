import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { ensureDependencies, hasFfplay } from "../src/deps.js";
import { DependencyError } from "../src/errors.js";

describe("deps", () => {
  describe("ensureDependencies", () => {
    it("resolves when ffmpeg and ffprobe are installed", async () => {
      await assert.doesNotReject(() => ensureDependencies());
    });
  });

  describe("hasFfplay", () => {
    it("returns boolean without throwing", async () => {
      const result = await hasFfplay();
      assert.equal(typeof result, "boolean");
    });
  });
});
