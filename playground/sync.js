// Keep a view in sync.
// ldes-client replicates an LDES in the browser. The page keeps its own view (a substring search and a map) up to date
// from it while the members stream in, and remembers where it stopped, so the next visit only fetches what changed.
import { L, NS, h, browserFetch, debounce, escapeHtml, formatDuration, loadScript, loadStyle } from './common.js';

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

// -- names and labels -----------------------------------------------------------------------------------------------
const PREFIXES = {
  ...NS,
  dc: 'http://purl.org/dc/elements/1.1/',
  sh: 'http://www.w3.org/ns/shacl#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  vcard: 'http://www.w3.org/2006/vcard/ns#',
  wgs84: 'http://www.w3.org/2003/01/geo/wgs84_pos#',
  gml: 'http://www.opengis.net/ont/gml#',
  sosa: 'http://www.w3.org/ns/sosa/',
  cidoc: 'http://www.cidoc-crm.org/cidoc-crm/',
  edm: 'http://www.europeana.eu/schemas/edm/',
  osm: 'https://www.openstreetmap.org/',
  osmkey: 'https://www.openstreetmap.org/wiki/Key:',
  osmmeta: 'https://www.openstreetmap.org/meta/',
};
const PREFIX_ENTRIES = Object.entries(PREFIXES).sort((a, b) => b[1].length - a[1].length);

/** A readable form of an IRI: the last path segments or the fragment, decoded. */
export function prettyIri(iri) {
  try {
    const url = new URL(iri);
    const decode = (text) => { try { return decodeURIComponent(text); } catch { return text; } };
    if (url.hash.length > 1) return decode(url.hash.slice(1));
    const host = url.hostname.replace(/^www\./, '');
    const segments = url.pathname.split('/').filter(Boolean).map(decode);
    const tail = segments.slice(-2).join('/');
    return segments.length > 2 ? `${host} › …/${tail}` : `${host}${tail ? `/${tail}` : ''}`;
  } catch {
    return iri;
  }
}

/** A prefixed name when the namespace is known, else a readable IRI. */
function compact(iri) {
  for (const [prefix, ns] of PREFIX_ENTRIES) if (iri.startsWith(ns) && iri.length > ns.length) return `${prefix}:${iri.slice(ns.length)}`;
  return prettyIri(iri);
}

// The predicates that give an entity its name, most specific first.
const LABEL_PREDICATES = [
  'https://schema.org/name', 'http://schema.org/name', NS.dct + 'title', PREFIXES.dc + 'title', NS.skos + 'prefLabel',
  NS.rdfs + 'label', PREFIXES.foaf + 'name', NS.as + 'name', PREFIXES.vcard + 'fn', PREFIXES.osmkey + 'name',
  PREFIXES.cidoc + 'P102_has_title', NS.skos + 'altLabel', NS.dct + 'alternative',
];
const LANGUAGES = [...new Set([...(navigator.languages ?? []), 'en'].map((tag) => tag.toLowerCase().split('-')[0]))];
const languageRank = (language) => {
  if (!language) return LANGUAGES.length + 1;
  const index = LANGUAGES.indexOf(language.toLowerCase().split('-')[0]);
  return index < 0 ? 0 : LANGUAGES.length + 1 - index + 1;
};

// -- geometry: every WKT or GML literal and every latitude/longitude pair ----------------------------------------------
const WKT_DATATYPES = new Set([NS.geo + 'wktLiteral', 'http://www.openlinksw.com/schemas/virtrdf#Geometry']);
const GML_DATATYPES = new Set([NS.geo + 'gmlLiteral']);
const WKT_TEXT = /^\s*(<[^>]+>\s*)?(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION|TRIANGLE|TIN|POLYHEDRALSURFACE)\b/i;
const GML_TEXT = /^\s*<([\w-]+:)?(Point|LineString|Polygon|Envelope|MultiPoint|MultiCurve|MultiSurface|MultiPolygon|Surface|Curve)\b/;
const LATITUDE = /^(lat|latitude)$/i;
const LONGITUDE = /^(long|lon|lng|longitude)$/i;
const NUMBERS = /[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;
// CRSs with latitude first: EPSG:4326 as an IRI, URN or code. CRS84 (the WKT default) has longitude first.
const LAT_FIRST_CRS = /EPSG(\/0\/|::?|:)4326\b/i;

/** The centre of the bounding box of [x, y] points, as latitude and longitude, or null when it is not on Earth. */
function centre(numbers, latFirst) {
  const points = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push(latFirst ? [numbers[i + 1], numbers[i]] : [numbers[i], numbers[i + 1]]);
  if (!points.length) return null;
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  const lon = (Math.min(...xs) + Math.max(...xs)) / 2;
  const lat = (Math.min(...ys) + Math.max(...ys)) / 2;
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

function parseWkt(text) {
  const crs = /^\s*<([^>]+)>/.exec(text)?.[1] ?? '';
  const body = text.replace(/^\s*<[^>]*>\s*/, '');
  // Z and M coordinates are not used: only take the first two numbers of every coordinate tuple.
  const dimensions = /\b(ZM)\b/i.test(body) ? 4 : /\b(Z|M)\s*\(/i.test(body) ? 3 : 2;
  const numbers = [];
  for (const tuple of body.split(/[,()]/)) {
    const values = (tuple.match(NUMBERS) || []).map(Number);
    for (let i = 0; i + 1 < values.length; i += dimensions) numbers.push(values[i], values[i + 1]);
  }
  return centre(numbers, LAT_FIRST_CRS.test(crs));
}

function parseGml(text) {
  const latFirst = LAT_FIRST_CRS.test(/srsName="([^"]*)"/.exec(text)?.[1] ?? '');
  const numbers = [];
  for (const [, content] of text.matchAll(/<(?:[\w-]+:)?(?:pos|posList|lowerCorner|upperCorner)\b[^>]*>([^<]*)</g)) {
    numbers.push(...(content.match(NUMBERS) || []).map(Number));
  }
  // gml:coordinates: "x,y x,y", in the axis order of the CRS
  for (const [, content] of text.matchAll(/<(?:[\w-]+:)?coordinates\b[^>]*>([^<]*)</g)) {
    for (const tuple of content.trim().split(/\s+/)) {
      const [a, b] = tuple.split(',').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) numbers.push(a, b);
    }
  }
  return centre(numbers, latFirst);
}

function geometryOf(quads) {
  const latitudes = new Map(); const longitudes = new Map();
  for (const q of quads) {
    if (q.object.termType !== 'Literal') continue;
    const { value, datatype } = q.object;
    if (WKT_DATATYPES.has(datatype.value) || WKT_TEXT.test(value)) { const point = parseWkt(value); if (point) return point; }
    if (GML_DATATYPES.has(datatype.value) || GML_TEXT.test(value)) { const point = parseGml(value); if (point) return point; }
    const name = q.predicate.value.split(/[#/:]/).pop();
    const number = Number(value);
    if (value.trim() === '' || !Number.isFinite(number)) continue;
    if (LATITUDE.test(name)) latitudes.set(q.subject.value, number);
    else if (LONGITUDE.test(name)) longitudes.set(q.subject.value, number);
  }
  for (const [subject, lat] of latitudes) {
    const lon = longitudes.get(subject);
    if (lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  return null;
}

// -- reading an entity out of a member ----------------------------------------------------------------------------
const timestampText = (value) => (value == null ? '' : value instanceof Date ? value.toISOString() : String(value));

function toEntity(member) {
  const memberId = member.id.value;
  let itemId = member.isVersionOf || memberId;
  let deleted = false;
  for (const q of member.quads) {
    if (q.subject.value !== memberId || q.object.termType !== 'NamedNode') continue;
    if (q.predicate.value === NS.as + 'object') itemId = q.object.value.replace(/\?_profile=.*$/, '');
    // A version without ldes:versionOfPath: the usual dct:isVersionOf still says which entity it is a version of
    if (q.predicate.value === NS.dct + 'isVersionOf' && !member.isVersionOf) itemId = q.object.value;
    if (q.predicate.value === NS.rdf + 'type' && q.object.value === NS.as + 'Delete') deleted = true;
  }
  // Only the name of the entity itself: a member also describes related things (a collection, a concept), with names of their own
  const subjects = new Set([memberId, itemId, member.isVersionOf].filter(Boolean));
  let label = ''; let labelRank = -1;
  for (const q of member.quads) {
    if (q.object.termType !== 'Literal' || !subjects.has(q.subject.value)) continue;
    const index = LABEL_PREDICATES.indexOf(q.predicate.value);
    if (index < 0) continue;
    // the language of the reader first, then the order of LABEL_PREDICATES
    const rank = languageRank(q.object.language) * 100 + (LABEL_PREDICATES.length - index);
    if (rank > labelRank) { label = q.object.value; labelRank = rank; }
  }
  return {
    key: itemId,
    deleted,
    entity: { id: itemId, label: label || prettyIri(itemId), hasLabel: Boolean(label), ...geometryOf(member.quads), ts: timestampText(member.timestamp) },
  };
}

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// -- what the client found out about the LDES ---------------------------------------------------------------------
function duration(ms) {
  const units = [['day', 864e5], ['hour', 36e5], ['minute', 6e4], ['second', 1e3]];
  for (const [unit, size] of units) {
    if (ms >= size && ms % size === 0) return `${ms / size} ${unit}${ms / size === 1 ? '' : 's'}`;
  }
  return `${ms} ms`;
}

function describeLdes(info, entryPoint) {
  const quads = info?.contextQuads ?? [];
  const objects = (subject, predicate) => quads.filter((q) => q.subject.equals(subject) && q.predicate.value === predicate).map((q) => q.object);
  const literal = (subject, predicates) => {
    let best = null; let bestRank = -1;
    for (const [i, predicate] of predicates.entries()) {
      for (const object of objects(subject, predicate)) {
        if (object.termType !== 'Literal') continue;
        const rank = languageRank(object.language) * 100 + (predicates.length - i);
        if (rank > bestRank) { best = object.value; bestRank = rank; }
      }
    }
    return best;
  };
  const stream = quads.find((q) => q.predicate.value === NS.rdf + 'type' && q.object.value === NS.ldes + 'EventStream')?.subject
    ?? (info?.rootNode && quads.find((q) => q.object.equals(info.rootNode) && q.predicate.value === NS.tree + 'view')?.subject);
  const about = [stream, info?.rootNode].filter(Boolean);
  const first = (fn) => { for (const subject of about) { const value = fn(subject); if (value) return value; } return null; };
  const named = (term) => (term.termType === 'Literal' ? term.value : literal(term, LABEL_PREDICATES) ?? compact(term.value));
  const term = (t, inline = 'described in the LDES') => t && (t.termType === 'NamedNode' ? { iri: t.value, text: compact(t.value) } : { text: t.termType === 'Literal' ? t.value : inline });
  // A retention policy by its type and its parameters, e.g. "ldes:LatestVersionSubset (ldes:amount 1)"
  const policy = (t) => {
    const types = objects(t, NS.rdf + 'type').map((o) => compact(o.value));
    const parameters = quads.filter((q) => q.subject.equals(t) && q.predicate.value !== NS.rdf + 'type' && q.object.termType === 'Literal')
      .map((q) => `${compact(q.predicate.value)} ${q.object.value}`);
    const text = `${types.join(', ') || (t.termType === 'NamedNode' ? compact(t.value) : 'a policy')}${parameters.length ? ` (${parameters.join(', ')})` : ''}`;
    return t.termType === 'NamedNode' ? { iri: t.value, text } : { text };
  };
  const paths = info?.shapeQuads?.filter((q) => q.predicate.value === PREFIXES.sh + 'path').length ?? 0;

  const title = first((s) => literal(s, [NS.dct + 'title', 'https://schema.org/name', 'http://schema.org/name', NS.rdfs + 'label', PREFIXES.dc + 'title', NS.skos + 'prefLabel']));
  const description = first((s) => literal(s, [NS.dct + 'description', NS.rdfs + 'comment', 'https://schema.org/description', PREFIXES.dc + 'description']));
  const publisher = first((s) => objects(s, NS.dct + 'publisher')[0] ?? objects(s, PREFIXES.dc + 'publisher')[0]);
  const license = first((s) => objects(s, NS.dct + 'license')[0] ?? objects(s, NS.dct + 'rights')[0]);
  const ldes2Membership = stream ? ['memberType', 'memberPath', 'memberGraph', 'member'].flatMap((name) => objects(stream, NS.ldes + name).map((o) => `ldes:${name} ${o.termType === 'NamedNode' ? compact(o.value) : o.termType === 'Literal' ? o.value : '(a SHACL path)'}`)) : [];

  const rows = [
    ['Specification', [{ text: info?.ldesVersion === 2 ? 'LDES 2.0 (experimental support)' : 'LDES 1.0' }]],
    ['Event stream', stream ? [term(stream)] : []],
    ['Entry point', [{ iri: entryPoint, text: entryPoint }]],
    ['View', info?.rootNode && info.rootNode.value !== entryPoint && !info.rootNode.equals(stream) ? [term(info.rootNode)] : []],
    ['Publisher', publisher ? [publisher.termType === 'NamedNode' ? { iri: publisher.value, text: named(publisher) } : { text: named(publisher) }] : []],
    ['License', license ? [term(license)] : []],
    ['Ordered by', info?.timestampPath ? [term(info.timestampPath)] : info?.sequencePath ? [term(info.sequencePath)] : [{ text: info?.ldesVersion === 2 ? 'the order of the pages and their members' : 'no ldes:timestampPath: in any order' }]],
    ['Versions of', info?.versionOfPath ? [term(info.versionOfPath)] : []],
    ['Members', ldes2Membership.map((text) => ({ text }))],
    ['Member shape', info?.shape ? [{ ...term(info.shape, 'a SHACL shape in the LDES'), suffix: paths ? ` (${paths} property ${paths === 1 ? 'path' : 'paths'})` : '' }] : [{ text: 'none declared: members are extracted with a Concise Bounded Description' }]],
    ['Retention', info?.retentionPolicies?.length ? info.retentionPolicies.map(policy) : [{ text: 'none declared: the full history is kept' }]],
    // ldes:pollingInterval is in seconds
    ['Polling interval', info?.pollingInterval ? [{ text: duration(info.pollingInterval * 1000) }] : []],
  ].filter(([, values]) => values.length);

  const statements = stream ? quads.filter((q) => q.subject.equals(stream)).map((q) => [compact(q.predicate.value), q.object.termType === 'NamedNode' ? compact(q.object.value) : q.object.termType === 'Literal' ? q.object.value : '[ … ]']) : [];
  return { title, description, rows, statements };
}

// -- the chapter ----------------------------------------------------------------------------------------------------
export function createSyncChapter(root, { onChange }) {
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
  const status = h('p', { class: 'pg-status', role: 'status' }, 'Ready.');
  const note = h('p', { class: 'pg-note' });
  const stats = Object.fromEntries(['members', 'pages', 'entities', 'placed', 'fresh', 'changed', 'removed'].map((k) => [k, h('strong', {}, '0')]));
  const about = h('section', { class: 'pg-about', hidden: true, 'aria-label': 'About this LDES' });
  const searchInput = h('input', { type: 'search', id: 'sync-search', placeholder: 'Substring search over the replicated view…', autocomplete: 'off' });
  const results = h('ul', { class: 'pg-results' });
  const resultCount = h('p', { class: 'pg-note' });
  const mapBox = h('div', { class: 'pg-map', id: 'sync-map', 'aria-label': 'Map of the replicated entities with a geometry' });
  const mapNote = h('p', { class: 'pg-note' });
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
  let activeClient = null;
  let limit = DEFAULT_LIMIT;
  let resumeReading = null; // set while the sync waits at its limit: call it with true to read on, with false to stop
  let map = null; let layer = null; let leafletReady = null;
  let fittedFor = null;
  const markers = new Map();

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

  const render = debounce(async () => {
    const all = [...view.values()];
    const placedAll = all.filter((e) => e.lat != null);
    for (const [key, node] of Object.entries(stats)) {
      node.textContent = (key === 'entities' ? view.size : key === 'placed' ? placedAll.length : counters[key]).toLocaleString('en');
    }
    const rawQuery = searchInput.value.trim();
    const query = normalize(rawQuery);
    const matching = query ? all.filter((e) => normalize(e.label).includes(query) || normalize(e.id).includes(query)) : all;
    resultCount.textContent = `${matching.length.toLocaleString('en')} of ${all.length.toLocaleString('en')} entities${query ? ` contain “${rawQuery}”` : ''}. Searched in your browser: no request left it.`;
    results.textContent = '';
    for (const entity of matching.slice(0, 80)) {
      const name = entity.lat != null
        ? h('button', { type: 'button', class: 'pg-link', title: entity.id, onclick: () => focusOn(entity) }, entity.label)
        : h('span', { title: entity.id }, entity.label);
      results.append(h('li', {}, name, h('a', { href: entity.id, class: 'pg-ext', target: '_blank', rel: 'noopener', 'aria-label': `Open ${entity.label}` }, '↗')));
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
    layer.clearLayers(); markers.clear();
    for (const entity of placed.slice(0, MAX_MARKERS)) {
      const marker = window.L.circleMarker([entity.lat, entity.lon], { radius: 5, color: '#5252cf', weight: 1, fillColor: '#7950e6', fillOpacity: 0.7 })
        .bindPopup(`<strong>${escapeHtml(entity.label)}</strong><br><a href="${escapeHtml(entity.id)}" target="_blank" rel="noopener">${escapeHtml(prettyIri(entity.id))}</a>`);
      marker.addTo(layer); markers.set(entity.id, marker);
    }
    map.invalidateSize();
    // Fit the map once per search, and once when the first places arrive: not on every member, so that it can be panned
    if (fittedFor !== query) {
      const bounds = window.L.latLngBounds(placed.slice(0, MAX_MARKERS).map((e) => [e.lat, e.lon]));
      if (bounds.isValid()) { map.fitBounds(bounds.pad(0.2), { maxZoom: 9 }); fittedFor = query; }
    }
  }, 200);

  function focusOn(entity) {
    const marker = markers.get(entity.id);
    if (marker && map) { map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 8)); marker.openPopup(); }
  }

  const addLog = (text) => {
    log.prepend(h('li', {}, `${new Date().toLocaleTimeString()}  ${text}`));
    while (log.children.length > 80) log.lastChild.remove();
  };

  function showAbout(info, entryPoint) {
    const { title, description, rows, statements } = describeLdes(info, entryPoint);
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
    const started = performance.now();
    limit = cfg.limit;
    startButton.disabled = true; stopButton.disabled = false; moreButton.disabled = true;
    counters = { members: 0, pages: 0, fresh: 0, changed: 0, removed: 0 };
    view = new Map(); log.textContent = ''; about.hidden = true; fittedFor = null;

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
    if (restored) addLog(`Restored ${restored} entities from the previous visit; the client continues from its bookmark.`);
    if (after) addLog(`Reading members changed after ${after.toISOString()}${restored ? ' (fixed at the first sync)' : ''}.`);
    render();
    setStatus(restored ? `Restored ${restored.toLocaleString('en')} entities. Asking the LDES what changed…` : 'Connecting to the LDES…');

    let client;
    try {
      client = L.replicateLDES({
        url: cfg.url, fetch: browserFetch(), polling: cfg.follow, pollInterval: 3000, after,
        statePath: cfg.resume ? name : undefined,
      });
    } catch (error) { return fail(error); }
    activeClient = client;
    client.on('fragment', () => { counters.pages++; render(); });
    client.on('description', (info) => {
      if (mine !== run) return;
      addLog(`LDES ${info?.ldesVersion === 2 ? '2.0' : '1.0'} description received${info?.timestampPath ? `, ordered by ${compact(info.timestampPath.value)}` : ''}.`);
      showAbout(info, cfg.url);
    });
    client.on('error', (error) => { addLog(`Error: ${error?.message ?? error}`); });

    const save = () => dbSet(name, { days: cfg.days, after: after?.toISOString() ?? null, entries: [...view.entries()] });
    const persist = debounce(() => { if (cfg.resume && mine === run) save(); }, 500);
    try {
      for await (const member of client.stream({ highWaterMark: 10 })) {
        if (mine !== run) break;
        counters.members++;
        const { key, deleted, entity } = toEntity(member);
        if (deleted) { if (view.delete(key)) counters.removed++; }
        else { if (view.has(key)) counters.changed++; else counters.fresh++; view.set(key, entity); }
        if (counters.members <= 5 || counters.members % 100 === 0) addLog(`${deleted ? 'deleted' : 'received'} ${entity.label}`);
        setStatus(`${counters.members.toLocaleString('en')} members read in ${formatDuration(performance.now() - started)}…`);
        render(); persist();
        if (counters.members >= limit) {
          if (cfg.resume) save();
          addLog(`Paused after ${counters.members.toLocaleString('en')} members.`);
          setStatus(`Paused after ${counters.members.toLocaleString('en')} members (${formatDuration(performance.now() - started)}): ${view.size.toLocaleString('en')} entities in the view. Press “Fetch more members” to read the next ${cfg.limit.toLocaleString('en')}.`);
          moreButton.disabled = false;
          const more = await new Promise((resolve) => { resumeReading = resolve; });
          resumeReading = null; moreButton.disabled = true;
          if (!more || mine !== run) break;
          limit += cfg.limit;
          limitInput.value = limit; describeAdvanced(); onChange();
          addLog(`Fetching up to ${limit.toLocaleString('en')} members.`);
        }
      }
    } catch (error) {
      if (mine !== run) return;
      await closeClient(client);
      // A bookmark saved under another filter (for example by an older version of this page): start over, once.
      if (cfg.resume && !retried && /Different conditions/.test(error?.message ?? '')) {
        await forgetState(name);
        return start({ retried: true });
      }
      return fail(error);
    }
    if (mine !== run) return;
    // close() saves the bookmark: wait for it, so that the next sync finds it.
    await closeClient(client);
    if (activeClient === client) activeClient = null;
    if (mine !== run) return;
    if (cfg.resume) await save();
    startButton.disabled = false; stopButton.disabled = true; moreButton.disabled = true;
    const fresh = counters.fresh + counters.changed;
    setStatus(`Caught up in ${formatDuration(performance.now() - started)}: ${counters.members.toLocaleString('en')} members read from ${counters.pages.toLocaleString('en')} pages, ${view.size.toLocaleString('en')} entities in the view.${restored ? ` ${fresh.toLocaleString('en')} of them were changes since the last visit.` : ''}`);
    render();
  }

  function fail(error) {
    addLog(`Error: ${error?.message ?? error}`);
    setStatus(`Could not read this LDES: ${error?.message ?? error}. It must be reachable from a browser (CORS) and expose a view.`, true);
    startButton.disabled = false; stopButton.disabled = true; moreButton.disabled = true;
    activeClient = null;
  }

  async function closeClient(client) {
    try { await client?.close(); } catch (error) { addLog(`Closing the client: ${error?.message ?? error}`); }
  }

  async function stop() {
    run++;
    resumeReading?.(false);
    const client = activeClient;
    activeClient = null;
    startButton.disabled = false; stopButton.disabled = true; moreButton.disabled = true;
    await closeClient(client);
  }

  const setStatus = (text, isError = false) => { status.textContent = text; status.classList.toggle('error', isError); };

  const forgetState = (name) => Promise.all([dbDelete(name), deleteIndexedDb(name)]);

  async function forget() {
    await stop();
    await forgetState(stateName(urlInput.value.trim()));
    view = new Map(); counters = { members: 0, pages: 0, fresh: 0, changed: 0, removed: 0 };
    about.hidden = true;
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
  moreButton.addEventListener('click', () => resumeReading?.(true));
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
