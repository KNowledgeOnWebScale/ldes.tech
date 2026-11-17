// What the playground reads out of the members of an LDES and out of its description: names, geometry, Turtle.
// No DOM: it runs in the replication worker (replicator.js), and the page uses a few of its helpers.
import { NS } from './common.js';

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
export function compact(iri) {
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

// -- the triples of a member, as Turtle (TriG for named graphs) ----------------------------------------------------
const MAX_SHOWN_QUADS = 400;
const MAX_LITERAL = 300;
const LOCAL_NAME = /^[A-Za-z0-9_][A-Za-z0-9_\-.]*$/;
const namespaceOf = (iri) => iri.slice(0, Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);

/**
 * The prefixes for a member: the known ones, and one for every other namespace that occurs more than once in it,
 * named after the last segment of its path (http://marineregions.org/ns/placetypes# becomes placetypes:).
 */
function prefixesFor(quads) {
  const counts = new Map();
  const count = (term) => { if (term?.termType === 'NamedNode') { const ns = namespaceOf(term.value); counts.set(ns, (counts.get(ns) ?? 0) + 1); } };
  for (const q of quads) { count(q.subject); count(q.predicate); count(q.object); count(q.graph); if (q.object.termType === 'Literal') count(q.object.datatype); }
  const prefixes = new Map(Object.entries(PREFIXES));
  const known = new Set(prefixes.values());
  for (const [ns, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (n < 2 || known.has(ns) || !/^https?:\/\/[^/]+\/./.test(ns)) continue;
    const base = (ns.replace(/[#/]+$/, '').split('/').pop() || 'ns').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[0-9]+/, '').slice(0, 16) || 'ns';
    let name = base; let suffix = 2;
    while (prefixes.has(name)) name = `${base}${suffix++}`;
    prefixes.set(name, ns); known.add(ns);
  }
  return [...prefixes].sort((a, b) => b[1].length - a[1].length);
}

function termTurtle(term, prefixes, used, notes) {
  switch (term.termType) {
    case 'NamedNode': {
      for (const [prefix, ns] of prefixes) {
        const local = term.value.slice(ns.length);
        if (term.value.startsWith(ns) && LOCAL_NAME.test(local) && !local.endsWith('.')) { used.set(prefix, ns); return `${prefix}:${local}`; }
      }
      return `<${term.value}>`;
    }
    case 'BlankNode': return `_:${term.value}`;
    case 'Literal': {
      let value = term.value;
      if (value.length > MAX_LITERAL) { notes.push(`a literal of ${value.length.toLocaleString('en')} characters is shortened`); value = `${value.slice(0, MAX_LITERAL)}…`; }
      const text = `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
      if (term.language) return `${text}@${term.language}`;
      const datatype = term.datatype?.value;
      return !datatype || datatype === NS.xsd + 'string' ? text : `${text}^^${termTurtle(term.datatype, prefixes, used, notes)}`;
    }
    default: return '';
  }
}

/** Turtle of the quads, grouped by graph and subject, with the member as the first subject. */
export function toTurtle(quads, focus) {
  const used = new Map(); const notes = [];
  const shown = quads.slice(0, MAX_SHOWN_QUADS);
  const prefixes = prefixesFor(shown);
  const turtle = (term) => termTurtle(term, prefixes, used, notes);
  const graphs = new Map();
  for (const q of shown) {
    const graph = q.graph.termType === 'DefaultGraph' ? '' : turtle(q.graph);
    if (!graphs.has(graph)) graphs.set(graph, new Map());
    const subjects = graphs.get(graph);
    const subject = turtle(q.subject);
    if (!subjects.has(subject)) subjects.set(subject, { first: q.subject.value === focus, predicates: new Map() });
    const predicates = subjects.get(subject).predicates;
    const predicate = q.predicate.value === NS.rdf + 'type' ? 'a' : turtle(q.predicate);
    if (!predicates.has(predicate)) predicates.set(predicate, []);
    predicates.get(predicate).push(turtle(q.object));
  }
  const blocks = [];
  for (const [graph, subjects] of [...graphs].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : 0))) {
    const indent = graph ? '    ' : '';
    const ordered = [...subjects].sort(([, a], [, b]) => Number(b.first) - Number(a.first));
    const text = ordered.map(([subject, { predicates }]) => `${indent}${subject} ${[...predicates]
      .map(([predicate, objects]) => {
        // more than two values, or a long line: one value per line
        const oneLine = objects.join(' , ');
        return objects.length > 2 || oneLine.length > 90
          ? `${predicate}\n${indent}        ${objects.join(` ,\n${indent}        `)}`
          : `${predicate} ${oneLine}`;
      })
      .join(` ;\n${indent}    `)} .`).join('\n\n');
    blocks.push(graph ? `${graph} {\n${text}\n}` : text);
  }
  const header = [...used].sort(([a], [b]) => a.localeCompare(b)).map(([prefix, ns]) => `@prefix ${prefix}: <${ns}> .`).join('\n');
  const tail = [
    quads.length > shown.length ? `# … and ${(quads.length - shown.length).toLocaleString('en')} more triples` : '',
    notes.length ? `# ${notes.length === 1 ? notes[0] : `${notes.length} long literals are shortened`} here` : '',
  ].filter(Boolean).join('\n');
  return [header, blocks.join('\n\n'), tail].filter(Boolean).join('\n\n');
}

// -- reading an entity out of a member ----------------------------------------------------------------------------
const timestampText = (value) => (value == null ? '' : value instanceof Date ? value.toISOString() : String(value));

export function toEntity(member) {
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
    entity: {
      id: itemId, member: memberId, label: label || prettyIri(itemId), hasLabel: Boolean(label), ...geometryOf(member.quads),
      ts: timestampText(member.timestamp), size: member.quads.length, turtle: toTurtle(member.quads, memberId),
      // what the substring search looks in, normalised once here instead of on every keystroke
      search: normalize(`${label || prettyIri(itemId)} ${itemId}`),
    },
  };
}

export const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// -- what the client found out about the LDES ---------------------------------------------------------------------
function duration(ms) {
  const units = [['day', 864e5], ['hour', 36e5], ['minute', 6e4], ['second', 1e3]];
  for (const [unit, size] of units) {
    if (ms >= size && ms % size === 0) return `${ms / size} ${unit}${ms / size === 1 ? '' : 's'}`;
  }
  return `${ms} ms`;
}

export function describeLdes(info, entryPoint) {
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
