// Imported first by replicator.js, before ldes-client.
// ldes-client 0.6.1 tells a browser from Node.js with `typeof window` (in its LevelStorage): a Web Worker has no
// window, so it would take the Node.js path (os.tmpdir(), the file system) and fail with "(void 0) is not a function".
// In a worker, `self` has what that path needs in a browser: IndexedDB, fetch.
globalThis.window ??= globalThis;
