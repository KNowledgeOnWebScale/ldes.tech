// The replication worker of the playground (a module Web Worker).
// ldes-client runs here, off the main thread: parsing a large page and extracting its members can take seconds, which
// would freeze the page. The page sends `start`, `more` and `stop`; this worker sends back what the client found out,
// and the members as entities that the page can show as they are (see members.js). Every message about a sync carries
// the id of that sync, so that the page can ignore the messages of a sync that it stopped.
import './worker-env.js'; // first: see there
import * as L from './ldes-tech.min.js';
import { compact, describeLdes, toEntity } from './members.js';

// ldes-client advertises a long Accept header (and may send If-None-Match). Browsers treat both as non-simple requests
// and send a CORS preflight, which many data providers do not answer. A short Accept header keeps requests "simple",
// so any server that sends Access-Control-Allow-Origin works.
const SHORT_ACCEPT = 'application/trig, text/turtle;q=0.9, application/ld+json;q=0.8';
const BATCH_SIZE = 50;
const BATCH_MS = 100;

let current = null; // the sync that runs: { id, client, limit, step, members, wake, loop }
let inFlight = 0;

const post = (message) => self.postMessage(message);

/** fetch for the client: simple CORS requests, and a count of the requests that are waiting for a response */
async function countingFetch(input, init = {}) {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set('Accept', SHORT_ACCEPT);
  headers.delete('If-None-Match');
  headers.delete('If-Modified-Since');
  inFlight++; post({ type: 'requests', inFlight });
  try {
    return await fetch(new Request(request, { headers }));
  } finally {
    inFlight--; post({ type: 'requests', inFlight });
  }
}

function start({ id, url, follow, statePath, limit }) {
  const run = { id, limit, step: limit, members: 0, wake: null, client: null };
  current = run;
  const send = (message) => post({ ...message, id });

  let batch = []; let timer = null;
  const flush = () => {
    clearTimeout(timer); timer = null;
    if (batch.length) { send({ type: 'members', batch }); batch = []; }
  };

  try {
    run.client = L.replicateLDES({ url, fetch: countingFetch, polling: follow, pollInterval: 3000, statePath });
  } catch (error) {
    send({ type: 'error', message: error?.message ?? String(error) });
    current = null;
    return;
  }
  const { client } = run;
  client.on('fragment', () => send({ type: 'fragment' }));
  client.on('poll', () => { flush(); send({ type: 'idle' }); });
  client.on('description', (info) => send({
    type: 'description',
    version: info?.ldesVersion === 2 ? 2 : 1,
    orderedBy: info?.timestampPath ? compact(info.timestampPath.value) : null,
    about: describeLdes(info, url),
  }));
  client.on('error', (error) => send({ type: 'log', text: `Error: ${error?.message ?? error}` }));

  run.loop = (async () => {
    try {
      for await (const member of client.stream({ highWaterMark: 10 })) {
        if (current !== run) break;
        run.members++;
        batch.push(toEntity(member));
        if (batch.length >= BATCH_SIZE) flush();
        else timer ??= setTimeout(flush, BATCH_MS);
        if (run.members >= run.limit) {
          // Wait at the limit with the client open: "more" reads on from the same stream
          flush();
          send({ type: 'paused', members: run.members });
          const more = await new Promise((resolve) => { run.wake = resolve; });
          run.wake = null;
          if (!more || current !== run) break;
          run.limit += run.step;
          send({ type: 'resumed', limit: run.limit });
        }
      }
      flush();
    } catch (error) {
      flush();
      await close(run);
      if (current === run) { current = null; send({ type: 'error', message: error?.message ?? String(error) }); }
      return;
    }
    // close() saves the bookmark: the sync is only done when it is saved
    await close(run);
    if (current === run) { current = null; send({ type: 'done', members: run.members }); }
  })();
}

async function close(run) {
  try { await run.client?.close(); } catch (error) { post({ type: 'log', id: run.id, text: `Closing the client: ${error?.message ?? error}` }); }
}

/** Stops the sync that runs, and resolves when its client is closed and its bookmark saved */
async function stop() {
  const run = current;
  current = null;
  if (!run) return;
  run.wake?.(false);
  await close(run);
  await run.loop?.catch(() => {});
}

self.onmessage = async ({ data }) => {
  switch (data.type) {
    case 'start':
      await stop();
      start(data);
      break;
    case 'more':
      if (current?.id === data.id) current.wake?.(true);
      break;
    case 'stop':
      await stop();
      post({ type: 'stopped', seq: data.seq });
      break;
  }
};

post({ type: 'ready', version: L.ldesClientVersion });
