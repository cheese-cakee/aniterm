import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  TerminalVideoError,
  DependencyError,
  FileError,
  DecodeError,
} from "../src/errors.js";

describe("errors", () => {
  it("TerminalVideoError is an instance of Error", () => {
    const err = new TerminalVideoError("test");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof TerminalVideoError);
    assert.equal(err.name, "TerminalVideoError");
    assert.equal(err.message, "test");
  });

  it("DependencyError extends TerminalVideoError", () => {
    const err = new DependencyError("ffmpeg");
    assert.ok(err instanceof TerminalVideoError);
    assert.ok(err instanceof DependencyError);
    assert.ok(err.message.includes("ffmpeg"));
    assert.ok(err.message.includes("ffmpeg.org"));
  });

  it("FileError extends TerminalVideoError", () => {
    const err = new FileError("/nonexistent.mp4");
    assert.ok(err instanceof TerminalVideoError);
    assert.ok(err.message.includes("/nonexistent.mp4"));
  });

  it("DecodeError extends TerminalVideoError", () => {
    const err = new DecodeError("bad codec");
    assert.ok(err instanceof TerminalVideoError);
    assert.ok(err.message.includes("bad codec"));
  });

  it("all errors are distinguishable by name", () => {
    const errors = [
      new TerminalVideoError("a"),
      new DependencyError("b"),
      new FileError("c"),
      new DecodeError("d"),
    ];

    const names = errors.map((e) => e.name);
    const unique = new Set(names);
    assert.equal(unique.size, 4, "all error names should be unique");
  });
});
