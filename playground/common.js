// Shared helpers of the LDES playground: shareable URL state, small DOM utilities and RDF namespaces.
// Nothing here runs DOM code when it is imported: the replication worker imports it too (through members.js).
export const $ = (selector, root = document) => root.querySelector(selector);

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Runs fn at most once every ms, and once more after the last call: it keeps up with a stream that never pauses. */
export function throttle(fn, ms) {
  let timer = null; let last = 0;
  return (...args) => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; last = performance.now(); fn(...args); }, Math.max(0, ms - (performance.now() - last)));
  };
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Shareable state in the URL hash: #state=<base64url(deflate(JSON))> or #example=<preset>
// ---------------------------------------------------------------------------------------------------------------
const toBase64Url = (bytes) => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const fromBase64Url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};
async function pipeThrough(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export async function encodeState(state) {
  const json = new TextEncoder().encode(JSON.stringify(state));
  if (typeof CompressionStream === 'function') {
    return 'z.' + toBase64Url(await pipeThrough(json, new CompressionStream('deflate-raw')));
  }
  return toBase64Url(json);
}

export async function decodeState(value) {
  try {
    if (value.startsWith('z.')) {
      const bytes = await pipeThrough(fromBase64Url(value.slice(2)), new DecompressionStream('deflate-raw'));
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    return JSON.parse(new TextDecoder().decode(fromBase64Url(value)));
  } catch {
    return null;
  }
}

export function readHash() {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  return { example: params.get('example'), state: params.get('state') };
}

export async function writeHash(state) {
  const encoded = state ? await encodeState(state) : '';
  const url = `${window.location.pathname}${window.location.search}${encoded ? `#state=${encoded}` : ''}`;
  window.history.replaceState(null, '', url);
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded) return resolve();
    const script = existing ?? h('script', { src });
    script.addEventListener('load', () => { script.dataset.loaded = '1'; resolve(); });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)));
    if (!existing) document.head.append(script);
  });
}

export function loadStyle(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h('link', { rel: 'stylesheet', href }));
}

// ---------------------------------------------------------------------------------------------------------------
// RDF helpers
// ---------------------------------------------------------------------------------------------------------------
export const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  dct: 'http://purl.org/dc/terms/',
  dcat: 'http://www.w3.org/ns/dcat#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  schema: 'https://schema.org/',
  as: 'https://www.w3.org/ns/activitystreams#',
  ldes: 'https://w3id.org/ldes#',
  tree: 'https://w3id.org/tree#',
  prov: 'http://www.w3.org/ns/prov#',
  locn: 'http://www.w3.org/ns/locn#',
  geo: 'http://www.opengis.net/ont/geosparql#',
};

/** Short label for an IRI, for display. */
export function shortIri(iri) {
  const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'));
  return cut >= 0 && cut < iri.length - 1 ? iri.slice(cut + 1) : iri;
}

/** Keep the page honest about what is running. */
export function formatDuration(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
