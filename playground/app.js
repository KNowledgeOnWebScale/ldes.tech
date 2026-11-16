// The LDES playground: keep a view in sync, with the whole setup in a shareable URL.
import { L, $, debounce, decodeState, readHash, writeHash } from './common.js';
import { createSyncChapter } from './sync.js';

let restoring = false;

for (const id of ['pg-version', 'pg-version-2']) { const el = document.getElementById(id); if (el) el.textContent = L.ldesClientVersion; }

// The hash keeps the shape { c: 'sync', s: state } of the links that were shared when the page had more demos.
const save = debounce(async () => {
  if (!restoring) await writeHash({ c: 'sync', s: sync.collect() });
}, 400);

const sync = createSyncChapter($('#sync-app'), { onChange: save });

$('#pg-share').addEventListener('click', async () => {
  await writeHash({ c: 'sync', s: sync.collect() });
  const status = $('#pg-share-status');
  try { await navigator.clipboard.writeText(window.location.href); status.textContent = 'Link copied. It contains your configuration.'; }
  catch { status.textContent = 'Copy the address from your browser: it contains your configuration.'; }
  setTimeout(() => { status.textContent = ''; }, 5000);
});

// #state=… restores a shared setup; #example=<preset> (used by the examples page) selects an example and syncs it.
async function restore() {
  const { example, state } = readHash();
  restoring = true;
  try {
    if (state) {
      const decoded = await decodeState(state);
      if (decoded?.c === 'sync') { sync.apply(decoded.s ?? {}, { autostart: true }); return; }
    }
    if (example && sync.presets.includes(example) && example !== 'custom') { sync.applyPreset(example); sync.start(); }
  } finally { restoring = false; }
}

await restore();
