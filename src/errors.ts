export class TerminalVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalVideoError";
  }
}

export class DependencyError extends TerminalVideoError {
  constructor(command: string) {
    super(
      `'${command}' not found. Install ffmpeg: https://ffmpeg.org/download.html`
    );
    this.name = "DependencyError";
  }
}

export class FileError extends TerminalVideoError {
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = "FileError";
  }
}

export class DecodeError extends TerminalVideoError {
  constructor(message: string) {
    super(`Video decode error: ${message}`);
    this.name = "DecodeError";
  }
}
