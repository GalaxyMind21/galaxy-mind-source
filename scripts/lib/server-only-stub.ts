// Test-only: lets plain-Node tsx tests import modules marked `import "server-only"` (that marker throws outside a
// React Server Components build). Import this FIRST in a test file. Never imported by src/.
import Module from "node:module";

type Resolve = (request: string, ...rest: unknown[]) => string;
const M = Module as unknown as { _resolveFilename: Resolve };
const original = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return __filename;
  return original.call(this, request, ...rest);
};
export {};
