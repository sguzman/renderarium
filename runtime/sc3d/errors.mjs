export class Sc3dError extends Error {
  constructor(code, message, path = "$") {
    super(`${code} ${path}: ${message}`);
    this.name = "Sc3dError";
    this.code = code;
    this.path = path;
  }
}

export function fail(code, message, path) {
  throw new Sc3dError(code, message, path);
}
