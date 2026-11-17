// Keep a view in sync.
// ldes-client replicates an LDES in the browser. The page keeps its own view (a substring search and a map) up to date
// from it while the members stream in, and remembers where it stopped, so the next visit only fetches what changed.
import { h, debounce, escapeHtml, formatDuration, loadScript, loadStyle, throttle } from './common.js';
import { normalize } from './members.js';

const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet';
const DEFAULT_LIMIT = 1000;
const MAX_MARKERS = 5000;
const COGHENT = 'https://apidg.gent.be/opendata/adlib2eventstream/v1/';
const coghent = (path, label, note) => ({ group: 'Cultural heritage', label: `Collections of Ghent: ${label}`, url: COGHENT + path, note });

export const SYNC_PRESETS = {
  'marine-regions': {
    group: 'Places on a map', label: 'Marine Regions gazetteer',
    url: 'https://www.marineregions.org/feed.ttl', days: 30, query: 'canyon',
    note: 'VLIZ publishes its gazetteer of marine places as an LDES with hourly pages. Every member is a new version of a place with a WKT centroid. The example reads the changes of the last 30 days.',
  },
  'aphia': {
    group: 'Species and vocabularies', label: 'WoRMS / Aphia: marine species',
    url: 'https://aphia.org/feed',
    note: 'Taxonomic records from the World Register of Marine Species (WoRMS).',
  },
  'dcat-sweden': {
    group: 'Data catalogues', label: 'Swedish DCAT catalogue', query: 'luft',
    url: 'https://www.pieter.pm/dcat/sweden/feed.ttl',
    note: 'A harvester publishes the changes to Sweden’s national DCAT catalogue as ActivityStreams-typed members. The view is a local dataset search.',
  },
  'dcat-bosa': {
    group: 'Data catalogues', label: 'BOSA DCAT-AP feed (Belgian federal catalogue)',
    url: 'https://rdf-connect.github.io/belgium-dcat-ap-feed/index.trig',
    note: 'The Belgian federal data portal as a static LDES on GitHub Pages, as described in the SEMIC BOSA implementation report.',
  },
  'dcat-era': {
    group: 'Data catalogues', label: 'ERA DCAT-AP feed (European Union Agency for Railways)',
    url: 'https://era-europa-eu.gitlab.io/public/interoperable-data-programme/era-ontology/era-dcat-ap-feed/index.trig',
    note: 'Changes to the catalogue of the European Union Agency for Railways, published as static DCAT-AP pages.',
  },
  'coghent-dmg': coghent('dmg/objecten', 'Design Museum Gent', 'Object records from Design Museum Gent’s collection management system.'),
  'coghent-dmg-exhibitions': coghent('dmg/tentoonstellingen', 'Design Museum Gent exhibitions', 'Exhibition records from Design Museum Gent.'),
  'coghent-archiefgent': coghent('archiefgent/objecten', 'Archief Gent', 'Archival records held by the City Archive of Ghent.'),
  'coghent-hva': coghent('hva/objecten', 'Huis van Alijn', 'Object records from folk-culture museum Huis van Alijn.'),
  'coghent-industriemuseum': coghent('industriemuseum/objecten', 'Industriemuseum', 'Object records from the Museum of Industry, Labour and Textile.'),
  'coghent-stam': coghent('stam/objecten', 'STAM', 'Object records from STAM, the city museum of Ghent.'),
  'coghent-agents': coghent('adlib/personen', 'shared agents', 'Person and organisation records shared by the five CoGhent heritage institutions.'),
  'coghent-thesaurus': coghent('adlib/thesaurus', 'shared thesaurus', 'Thesaurus terms shared by the five CoGhent heritage institutions.'),
  'mint-euscreen': {
    group: 'Cultural heritage', label: 'MINT: EUscreenXL audiovisual heritage',
    url: 'https://mint-ldes.ails.ece.ntua.gr/euscreenxl/1008/ldes',
    note: 'An audiovisual heritage metadata stream used in MINT demonstrators.',
  },
  'waterkwaliteit-brugge': {
    group: 'Observations', label: 'Waterkwaliteit Brugge (water quality)',
    url: 'https://waterkwaliteit-brugge-ldes.kindflower-25e41809.westeurope.azurecontainerapps.io/Waterkwaliteit',
    note: 'Water quality measurements for Bruges.',
  },
  custom: {
    group: '', label: 'Your own LDES…', url: '',
    note: 'Paste the entry point of any LDES that allows cross-origin reads (CORS).',
  },
};

const stateName = (url) => `ldes-tech-pg-${[...url].reduce((hash, c) => (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0, 7)}`;

// -- tiny IndexedDB key-value store for the replicated view -------------------------------------------------------
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ldes-tech-playground', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('views');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbCall(mode, fn) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = fn(db.transaction('views', mode).objectStore('views'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined; // private mode etc.: the playground works without persistence
  }
}
const dbGet = (key) => dbCall('readonly', (store) => store.get(key));
const dbSet = (key, value) => dbCall('readwrite', (store) => store.put(value, key));
const dbDelete = (key) => dbCall('readwrite', (store) => store.delete(key));

function deleteIndexedDb(name) {
  return Promise.all([name, `level-js-${name}`].map((db) => new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(db);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch { resolve(); }
  })));
}

// -- the chapter ----------------------------------------------------------------------------------------------------
export function createSyncChapter(root, { onChange, onVersion }) {
  const field = (label, control, hint, attrs = {}) => h('label', { class: 'pg-field', ...attrs }, h('span', {}, label), control, hint && h('small', {}, hint));
  const presetSelect = h('select', { id: 'sync-preset', class: 'pg-wide', 'aria-label': 'Example LDES to replicate' });
  const urlInput = h('input', { type: 'url', id: 'sync-url', placeholder: 'https://example.org/ldes', required: true });
  const urlField = field('LDES entry point', urlInput, 'The URL of the event stream, a view or a page.', { class: 'pg-field pg-wide' });
  const limitInput = h('input', { type: 'number', id: 'sync-limit', min: 1, max: 1000000, value: DEFAULT_LIMIT });
  const daysInput = h('input', { type: 'number', id: 'sync-days', min: 0, placeholder: 'everything' });
  const followInput = h('input', { type: 'checkbox', id: 'sync-follow' });
  const resumeInput = h('input', { type: 'checkbox', id: 'sync-resume', checked: true });
  const startButton = h('button', { class: 'pg-btn primary', type: 'button' }, 'Sync');
  const moreButton = h('button', { class: 'pg-btn', type: 'button', disabled: true }, 'Fetch more members');
  const stopButton = h('button', { class: 'pg-btn', type: 'button', disabled: true }, 'Stop');
  const clearButton = h('button', { class: 'pg-btn', type: 'button' }, 'Forget saved view');
  const advancedSummary = h('summary', {});
  const statusText = h('span', { class: 'pg-status-text' }, 'Ready.');
  const requestCount = h('span', { class: 'pg-requests' });
  const status = h('p', { class: 'pg-status', role: 'status' }, h('span', { class: 'pg-spinner', 'aria-hidden': 'true' }), statusText, requestCount);
  const note = h('p', { class: 'pg-note' });
  const stats = Object.fromEntries(['members', 'pages', 'entities', 'placed', 'fresh', 'changed', 'removed'].map((k) => [k, h('strong', {}, '0')]));
  const about = h('section', { class: 'pg-about', hidden: true, 'aria-label': 'About this LDES' });
  const searchInput = h('input', { type: 'search', id: 'sync-search', placeholder: 'Substring search over the replicated view…', autocomplete: 'off' });
  const results = h('ul', { class: 'pg-results' });
  const resultCount = h('p', { class: 'pg-note' });
  const mapBox = h('div', { class: 'pg-map', id: 'sync-map', 'aria-label': 'Map of the replicated entities with a geometry' });
  const mapNote = h('p', { class: 'pg-note' });
  const memberPanel = h('section', { class: 'pg-member', hidden: true, 'aria-live': 'polite', 'aria-label': 'The selected member' });
  const log = h('ol', { class: 'pg-log', 'aria-live': 'off' });

  const statCell = (label, node) => h('div', { class: 'pg-stat' }, node, h('span', {}, label));
  root.append(
    h('div', { class: 'pg-controls' },
      presetSelect,
      urlField,
      note,
      h('details', { class: 'pg-advanced' }, advancedSummary,
        h('div', { class: 'pg-advanced-grid' },
          field('Stop after (members)', limitInput, '“Fetch more members” continues with as many again.'),
          field('Look back (days)', daysInput, 'Only members of the last N days before your first sync (LDES time filter). Empty: everything.'),
          h('div', { class: 'pg-checks' },
            h('label', {}, followInput, ' Keep following: poll for new members once caught up'),
            h('label', {}, resumeInput, ' Remember the view and where I stopped (in this browser)'),
          ),
        ),
      ),
      h('div', { class: 'pg-buttons' }, startButton, moreButton, stopButton, clearButton),
    ),
    status,
    h('div', { class: 'pg-stats' },
      statCell('members read', stats.members), statCell('pages fetched', stats.pages), statCell('entities in view', stats.entities),
      statCell('on the map', stats.placed), statCell('new', stats.fresh), statCell('updated', stats.changed), statCell('removed', stats.removed)),
    about,
    h('div', { class: 'pg-split' },
      h('div', {}, h('h3', {}, 'Your view: substring search'), searchInput, resultCount, results),
      h('div', {}, h('h3', {}, 'Your view: map'), mapBox, mapNote),
    ),
    memberPanel,
    h('details', { class: 'pg-details' }, h('summary', {}, 'Replication log'), log),
  );

  // presets and settings ------------------------------------------------------------------------------------------
  const groups = new Map();
  for (const [id, preset] of Object.entries(SYNC_PRESETS)) {
    if (!preset.group) continue;
    if (!groups.has(preset.group)) groups.set(preset.group, h('optgroup', { label: preset.group }));
    groups.get(preset.group).append(h('option', { value: id }, preset.label));
  }
  presetSelect.append(...groups.values(), h('option', { value: 'custom' }, SYNC_PRESETS.custom.label));

  function describeAdvanced() {
    const parts = [`stop after ${Number(limitInput.value || DEFAULT_LIMIT).toLocaleString('en')} members`];
    if (Number(daysInput.value)) parts.push(`last ${daysInput.value} days`);
    if (followInput.checked) parts.push('keep following');
    parts.push(resumeInput.checked ? 'remember where I stopped' : 'start from scratch every time');
    advancedSummary.textContent = `Advanced: ${parts.join(', ')}`;
  }

  function showUrlField() { urlField.hidden = presetSelect.value !== 'custom'; }

  function applyPreset(id, { keepQuery = false } = {}) {
    const preset = SYNC_PRESETS[id] ?? SYNC_PRESETS.custom;
    presetSelect.value = SYNC_PRESETS[id] ? id : 'custom';
    if (preset.url || presetSelect.value !== 'custom') urlInput.value = preset.url;
    daysInput.value = preset.days ?? '';
    limitInput.value = preset.limit ?? DEFAULT_LIMIT;
    followInput.checked = Boolean(preset.follow);
    resumeInput.checked = preset.resume ?? true;
    note.textContent = preset.note;
    if (!keepQuery) searchInput.value = preset.query ?? '';
    showUrlField(); describeAdvanced();
  }

  // view state ---------------------------------------------------------------------------------------------------
  let view = new Map();
  let counters = { members: 0, pages: 0, fresh: 0, changed: 0, removed: 0 };
  let run = 0;
  let map = null; let layer = null; let leafletReady = null;
  let fittedFor = null;
  let selectedId = null; let shownEntity = null;
  const markers = new Map(); // entity id -> { marker, entity }

  const ensureMap = async () => {
    leafletReady ??= (async () => {
      loadStyle(`${LEAFLET}.min.css`);
      await loadScript(`${LEAFLET}.min.js`);
      map = window.L.map(mapBox, { worldCopyJump: true, preferCanvas: true }).setView([30, 10], 2);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      layer = window.L.layerGroup().addTo(map);
    })().catch(() => { mapNote.textContent = 'The map library could not be loaded; the search view still works.'; });
    await leafletReady;
  };

  // Throttled, not debounced: while members stream in without a pause, the view still follows them
  const render = throttle(async () => {
    const all = [...view.values()];
    const placedAll = all.filter((e) => e.lat != null);
    for (const [key, node] of Object.entries(stats)) {
      node.textContent = (key === 'entities' ? view.size : key === 'placed' ? placedAll.length : counters[key]).toLocaleString('en');
    }
    const rawQuery = searchInput.value.trim();
    const query = normalize(rawQuery);
    // entity.search is normalised in the worker; views saved by an earlier version of this page do not have it
    const matching = query ? all.filter((e) => (e.search ?? normalize(`${e.label} ${e.id}`)).includes(query)) : all;
    resultCount.textContent = `${matching.length.toLocaleString('en')} of ${all.length.toLocaleString('en')} entities${query ? ` contain “${rawQuery}”` : ''}. Searched in your browser: no request left it.`;
    results.textContent = '';
    for (const entity of matching.slice(0, 80)) {
      const selected = entity.id === selectedId;
      results.append(h('li', { class: selected ? 'selected' : null },
        h('button', { type: 'button', class: 'pg-link', title: `Show the triples of ${entity.id}`, 'aria-pressed': String(selected), onclick: () => select(entity, { fly: true }) }, entity.label),
        entity.lat != null && h('span', { class: 'pg-pin', title: 'On the map', 'aria-label': 'on the map' }, '●')));
    }
    // The selected entity can have been updated by a newer member, or removed
    if (selectedId) {
      const current = view.get(selectedId);
      if (!current) closeMember();
      else if (current !== shownEntity) showMember(current);
    }
    if (matching.length > 80) results.append(h('li', { class: 'pg-note' }, `… and ${(matching.length - 80).toLocaleString('en')} more`));

    const placed = matching.filter((e) => e.lat != null);
    mapBox.hidden = !placedAll.length;
    mapNote.textContent = placedAll.length
      ? `${placed.length.toLocaleString('en')} of ${matching.length.toLocaleString('en')} matching entities have a geometry${placed.length > MAX_MARKERS ? ` (the first ${MAX_MARKERS.toLocaleString('en')} are drawn)` : ''}.`
      : 'Nothing in this view has a geometry yet (a WKT or GML literal, or a latitude and longitude): the search is the view.';
    if (!placedAll.length) return;
    await ensureMap();
    if (!map) return;
    // Only the markers that changed: removing and drawing thousands of them on every update would block the page
    const wanted = new Map(placed.slice(0, MAX_MARKERS).map((e) => [e.id, e]));
    for (const [id, { marker }] of markers) if (!wanted.has(id)) { marker.remove(); markers.delete(id); }
    for (const [id, entity] of wanted) {
      const shown = markers.get(id);
      if (shown?.entity === entity) continue;
      if (shown) {
        shown.marker.setLatLng([entity.lat, entity.lon]).setPopupContent(`<strong>${escapeHtml(entity.label)}</strong>`);
        shown.entity = entity;
        continue;
      }
      const marker = window.L.circleMarker([entity.lat, entity.lon], { radius: 5, color: '#5252cf', weight: 1, fillColor: '#7950e6', fillOpacity: 0.7 })
        .bindPopup(`<strong>${escapeHtml(entity.label)}</strong>`)
        .on('click', () => { const current = view.get(id); if (current) select(current); });
      marker.addTo(layer); markers.set(id, { marker, entity });
    }
    map.invalidateSize();
    // Fit the map once per search, and once when the first places arrive: not on every member, so that it can be panned
    if (fittedFor !== query) {
      const bounds = window.L.latLngBounds(placed.slice(0, MAX_MARKERS).map((e) => [e.lat, e.lon]));
      if (bounds.isValid()) { map.fitBounds(bounds.pad(0.2), { maxZoom: 9 }); fittedFor = query; }
    }
  }, 250);

  function focusOn(entity) {
    const marker = markers.get(entity.id)?.marker;
    if (marker && map) { map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 8)); marker.openPopup(); }
  }

  // the selected entity: the triples of the member that was read last for it ------------------------------------------
  function select(entity, { fly = false } = {}) {
    selectedId = entity.id;
    showMember(entity);
    if (fly) focusOn(entity);
    for (const button of results.querySelectorAll('button[aria-pressed]')) {
      const on = button.title === `Show the triples of ${entity.id}`;
      button.setAttribute('aria-pressed', String(on));
      button.closest('li').classList.toggle('selected', on);
    }
    memberPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function showMember(entity) {
    shownEntity = entity;
    const row = (label, ...value) => [h('dt', {}, label), h('dd', {}, ...value)];
    memberPanel.textContent = '';
    memberPanel.append(
      h('div', { class: 'pg-member-head' },
        h('h3', {}, entity.label),
        h('button', { type: 'button', class: 'pg-btn', onclick: closeMember }, 'Close')),
      h('dl', {},
        row('Entity', h('code', {}, entity.id)),
        entity.member && entity.member !== entity.id && row('Latest member', h('code', {}, entity.member)),
        entity.ts && row('Timestamp', entity.ts),
        entity.size != null && row('Triples', entity.size.toLocaleString('en'))),
      entity.turtle
        ? h('pre', { class: 'pg-turtle', tabindex: '0', 'aria-label': 'The triples of the member, in Turtle' }, h('code', {}, entity.turtle))
        : h('p', { class: 'pg-note' }, 'This entity was restored from a view that an earlier version of this page saved, without its triples. Forget the saved view and sync again to see them.'),
    );
    memberPanel.hidden = false;
  }

  function closeMember() {
    selectedId = null; shownEntity = null;
    memberPanel.hidden = true; memberPanel.textContent = '';
    for (const li of results.querySelectorAll('li.selected')) li.classList.remove('selected');
    for (const button of results.querySelectorAll('button[aria-pressed="true"]')) button.setAttribute('aria-pressed', 'false');
  }

  const addLog = (text) => {
    log.prepend(h('li', {}, `${new Date().toLocaleTimeString()}  ${text}`));
    while (log.children.length > 80) log.lastChild.remove();
  };

  function showAbout({ title, description, rows, statements }) {
    const value = (item) => [item.iri ? h('a', { href: item.iri, target: '_blank', rel: 'noopener', title: item.iri }, item.text) : item.text, item.suffix ?? ''];
    about.textContent = '';
    about.append(...[
      h('h3', {}, title ?? 'About this LDES'),
      description && h('p', { class: 'pg-about-description' }, description),
      h('dl', {}, rows.flatMap(([label, values]) => [h('dt', {}, label), h('dd', {}, values.flatMap((item, i) => [i ? ', ' : '', ...value(item)]))])),
      statements.length > 0 && h('details', {}, h('summary', {}, `All ${statements.length} statements about the event stream`),
        h('ul', { class: 'pg-statements' }, statements.map(([p, o]) => h('li', {}, h('code', {}, p), ' ', o)))),
    ].filter(Boolean));
    about.hidden = false;
  }

  // the replication worker ---------------------------------------------------------------------------------------------
  // ldes-client runs in a Web Worker (replicator.js): parsing a large page can take seconds, which would freeze this page.
  const worker = new Worker(new URL('./replicator.js', import.meta.url), { type: 'module' });
  const acks = new Map(); let seq = 0;
  let sync = null; // the sync that runs: { id, cfg, name, after, started, restored, retried, paused, idle }
  let requests = 0;
  worker.addEventListener('message', ({ data }) => {
    if (data.type === 'ready') { onVersion?.(data.version); return; }
    if (data.type === 'stopped') { acks.get(data.seq)?.(); acks.delete(data.seq); return; }
    if (data.type === 'requests') { requests = data.inFlight; showBusy(); return; }
    if (!sync || data.id !== sync.id) return; // a message of a sync that was stopped
    handle(sync, data);
  });
  worker.addEventListener('error', (event) => {
    event.preventDefault?.();
    if (sync) fail(new Error(`the replication worker failed: ${event.message ?? 'it could not be loaded'}`));
  });
  const stopWorker = () => new Promise((resolve) => { const n = ++seq; acks.set(n, resolve); worker.postMessage({ type: 'stop', seq: n }); });

  // busy: a spinner while requests are on their way, or while the client is working and not waiting at its limit
  function showBusy() {
    const working = Boolean(sync && !sync.paused && !sync.idle);
    status.classList.toggle('busy', working || requests > 0);
    requestCount.textContent = requests > 0 ? `${requests} ${requests === 1 ? 'request' : 'requests'} in progress` : working ? 'working' : '';
  }

  // sync -------------------------------------------------------------------------------------------------------------
  // The client saves its bookmark together with the time filter it ran with, and refuses to resume under another
  // filter ("The running conditions have changed"): the bookmark is only valid for that filter. "Look back N days"
  // is therefore fixed at the first sync and stored with the saved view, so that every later sync uses the same
  // `after`. When the number of days changes, the saved view and bookmark are discarded and the sync starts over.
  //
  // At its limit, the sync waits with the client open, instead of closing it: "Fetch more members" reads on from the
  // same stream. Nothing is fetched twice, and no member is skipped.
  async function start({ retried = false } = {}) {
    if (!urlInput.reportValidity()) { urlField.hidden = false; return; }
    const closing = stop();
    startButton.disabled = true; stopButton.disabled = false; moreButton.disabled = true;
    setStatus('Connecting to the LDES…');
    await closing;
    const mine = ++run;
    const cfg = read();
    const name = stateName(cfg.url);
    startButton.disabled = true; stopButton.disabled = false; moreButton.disabled = true;
    counters = { members: 0, pages: 0, fresh: 0, changed: 0, removed: 0 };
    view = new Map(); log.textContent = ''; about.hidden = true; fittedFor = null;
    closeMember();

    let restored = 0;
    let after = cfg.days ? new Date(Date.now() - cfg.days * 864e5) : undefined;
    if (cfg.resume) {
      const saved = await dbGet(name);
      if (saved?.entries && saved.days === cfg.days) {
        view = new Map(saved.entries); restored = view.size;
        after = saved.after ? new Date(saved.after) : undefined;
      } else if (saved) {
        addLog(saved.entries ? `“Look back” changed from ${saved.days || 'everything'} to ${cfg.days || 'everything'}: starting over.` : 'The saved view has an older format: starting over.');
        await forgetState(name);
      }
      if (mine !== run) return;
      // Saved before the client starts, so that a sync that is stopped early resumes with the same filter too.
      if (!restored) await dbSet(name, { days: cfg.days, after: after?.toISOString() ?? null, entries: [] });
    }
    if (mine !== run) return;
    if (restored) addLog(`Restored ${restored} entities from the previous visit; the client continues from its bookmark.`);
    if (after) addLog(`Reading members changed after ${after.toISOString()}${restored ? ' (fixed at the first sync)' : ''}.`);
    render();
    setStatus(restored ? `Restored ${restored.toLocaleString('en')} entities. Asking the LDES what changed…` : 'Connecting to the LDES…');

    sync = { id: mine, cfg, name, after, started: performance.now(), restored, retried, paused: false, idle: false };
    sync.save = () => dbSet(name, { days: cfg.days, after: after?.toISOString() ?? null, entries: [...view.entries()] });
    sync.persist = debounce(() => { if (cfg.resume && sync?.id === mine) sync.save(); }, 1000);
    showBusy();
    worker.postMessage({
      type: 'start', id: mine, url: cfg.url, after: after?.toISOString(), follow: cfg.follow,
      statePath: cfg.resume ? name : undefined, limit: cfg.limit,
    });
  }

  const elapsed = (s) => formatDuration(performance.now() - s.started);

  async function handle(s, message) {
    switch (message.type) {
      case 'description':
        addLog(`LDES ${message.version === 2 ? '2.0' : '1.0'} description received${message.orderedBy ? `, ordered by ${message.orderedBy}` : ''}.`);
        showAbout(message.about);
        break;
      case 'fragment':
        counters.pages++; s.idle = false; showBusy(); render();
        if (counters.members === 0 && !s.restored) setStatus(`${counters.pages.toLocaleString('en')} ${counters.pages === 1 ? 'page' : 'pages'} fetched, looking for the first members…`);
        break;
      case 'members':
        s.idle = false;
        for (const { key, deleted, entity } of message.batch) {
          counters.members++;
          if (deleted) { if (view.delete(key)) counters.removed++; }
          else { if (view.has(key)) counters.changed++; else counters.fresh++; view.set(key, entity); }
          if (counters.members <= 5 || counters.members % 100 === 0) addLog(`${deleted ? 'deleted' : 'received'} ${entity.label}`);
        }
        setStatus(`${counters.members.toLocaleString('en')} members read in ${elapsed(s)}…`);
        showBusy(); render(); s.persist();
        break;
      case 'paused':
        s.paused = true; showBusy();
        if (s.cfg.resume) s.save();
        addLog(`Paused after ${counters.members.toLocaleString('en')} members.`);
        setStatus(`Paused after ${counters.members.toLocaleString('en')} members (${elapsed(s)}): ${view.size.toLocaleString('en')} entities in the view. Press “Fetch more members” to read the next ${s.cfg.limit.toLocaleString('en')}.`);
        moreButton.disabled = false;
        break;
      case 'resumed':
        s.paused = false; showBusy();
        limitInput.value = message.limit; describeAdvanced(); onChange();
        addLog(`Fetching up to ${message.limit.toLocaleString('en')} members.`);
        break;
      case 'idle':
        s.idle = true; showBusy();
        if (s.cfg.resume) s.save();
        setStatus(`Following: ${counters.members.toLocaleString('en')} members read, ${view.size.toLocaleString('en')} entities in the view. New members appear as the LDES publishes them.`);
        break;
      case 'log':
        addLog(message.text);
        break;
      case 'error':
        sync = null; showBusy();
        // A bookmark saved under another filter (for example by an older version of this page): start over, once.
        if (s.cfg.resume && !s.retried && /Different conditions/.test(message.message)) {
          await forgetState(s.name);
          start({ retried: true });
          return;
        }
        fail(new Error(message.message));
        break;
      case 'done': {
        sync = null; showBusy();
        if (s.cfg.resume) await s.save();
        startButton.disabled = false; stopButton.disabled = true; moreButton.disabled = true;
        const fresh = counters.fresh + counters.changed;
        setStatus(`Caught up in ${elapsed(s)}: ${counters.members.toLocaleString('en')} members read from ${counters.pages.toLocaleString('en')} pages, ${view.size.toLocaleString('en')} entities in the view.${s.restored ? ` ${fresh.toLocaleString('en')} of them were changes since the last visit.` : ''}`);
        render();
        break;
      }
    }
  }

  function fail(error) {
    sync = null; showBusy();
    addLog(`Error: ${error?.message ?? error}`);
    setStatus(`Could not read this LDES: ${error?.message ?? error}. It must be reachable from a browser (CORS) and expose a view.`, true);
    startButton.disabled = false; stopButton.disabled = true; moreButton.disabled = true;
  }

  /** Stops the sync, and resolves when the worker has closed its client (and saved its bookmark) */
  async function stop() {
    run++;
    const s = sync;
    sync = null; showBusy();
    startButton.disabled = false; stopButton.disabled = true; moreButton.disabled = true;
    if (s?.cfg.resume) s.save();
    await stopWorker();
  }

  const setStatus = (text, isError = false) => { statusText.textContent = text; status.classList.toggle('error', isError); };

  const forgetState = (name) => Promise.all([dbDelete(name), deleteIndexedDb(name)]);

  async function forget() {
    await stop();
    await forgetState(stateName(urlInput.value.trim()));
    view = new Map(); counters = { members: 0, pages: 0, fresh: 0, changed: 0, removed: 0 };
    about.hidden = true;
    closeMember();
    render(); setStatus('Saved view and client bookmark removed: the next sync replicates from scratch.');
  }

  function read() {
    return {
      url: urlInput.value.trim(), days: Number(daysInput.value) || 0, limit: Number(limitInput.value) || DEFAULT_LIMIT,
      follow: followInput.checked, resume: resumeInput.checked,
    };
  }

  presetSelect.addEventListener('change', () => {
    stop();
    applyPreset(presetSelect.value);
    if (presetSelect.value === 'custom') { urlInput.value = ''; urlInput.focus(); }
    onChange();
  });
  for (const control of [urlInput, daysInput, limitInput, followInput, resumeInput]) {
    control.addEventListener('input', () => { describeAdvanced(); onChange(); });
  }
  searchInput.addEventListener('input', () => { render(); onChange(); });
  startButton.addEventListener('click', () => { start(); onChange(); });
  moreButton.addEventListener('click', () => { if (sync?.paused) { moreButton.disabled = true; worker.postMessage({ type: 'more', id: sync.id }); } });
  stopButton.addEventListener('click', async () => { await stop(); setStatus('Stopped. The view keeps what it has; Sync continues from where it stopped.'); });
  clearButton.addEventListener('click', forget);
  urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); start(); } });

  applyPreset('marine-regions');
  render();

  return {
    id: 'sync',
    presets: Object.keys(SYNC_PRESETS),
    collect: () => ({ preset: presetSelect.value, ...read(), query: searchInput.value }),
    apply(state, { autostart = false } = {}) {
      applyPreset(state.preset ?? 'custom');
      if (state.url != null) urlInput.value = state.url;
      if (state.days != null) daysInput.value = state.days || '';
      if (state.limit != null) limitInput.value = state.limit;
      if (state.follow != null) followInput.checked = state.follow;
      if (state.resume != null) resumeInput.checked = state.resume;
      searchInput.value = state.query ?? '';
      showUrlField(); describeAdvanced();
      if (autostart) start();
    },
    applyPreset: (id) => { applyPreset(id); },
    start,
    stop,
  };
}
