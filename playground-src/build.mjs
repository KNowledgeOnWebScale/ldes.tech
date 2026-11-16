// Bundles ldes-client (pinned in package.json) for the browser.
// Output: ../playground/ldes-tech.min.js, an ES module.
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
await mkdir('../playground', { recursive: true });

// ldfetch's parsers expect Node.js streams: use the same polyfills as ldes-client's own browser tests.
const alias = {
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer/'),
  events: require.resolve('events/'),
};
const { version } = JSON.parse(await readFile('node_modules/ldes-client/package.json', 'utf8'));

await build({
  entryPoints: ['entry.js'],
  outfile: '../playground/ldes-tech.min.js',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  alias,
  define: { global: 'globalThis', __LDES_CLIENT_VERSION__: JSON.stringify(version) },
  inject: ['globals.js'],
  legalComments: 'none',
  // Node-only modules that ldes-client loads lazily (state in Node, winston logging) are irrelevant in the browser.
  external: ['winston', 'winston/*'],
  logLevel: 'info',
});
