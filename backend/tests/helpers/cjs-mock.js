/**
 * Module stubbing for CommonJS sources.
 *
 * `vi.mock` hooks into Vite's module graph, which only sees ESM `import`
 * statements. This codebase is CommonJS, so a `require('../utils/prisma')`
 * inside a service resolves through Node's own loader and never reaches the
 * mock — the test would silently hit a real database instead.
 *
 * Priming Node's require cache before the module under test is loaded works at
 * the same layer the source actually uses.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Paths under src/ are resolved from the backend root; anything else (a
// package name) is resolved the way Node would.
const toSpecifier = (id) => (id.startsWith('src/') ? path.join(BACKEND_ROOT, id) : id);

/** Replace a module's exports for every subsequent require() of it. */
export function mockModule(id, exports) {
  const filename = nodeRequire.resolve(toSpecifier(id));
  nodeRequire.cache[filename] = {
    id: filename,
    filename,
    path: path.dirname(filename),
    exports,
    loaded: true,
    children: [],
    paths: [],
  };
  return exports;
}

/** Load a CommonJS module through Node, honouring any mocks primed above. */
export function loadModule(id) {
  return nodeRequire(toSpecifier(id));
}
