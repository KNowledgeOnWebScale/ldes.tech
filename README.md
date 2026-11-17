# ldes.tech

Source of the [ldes.tech](https://ldes.tech) website: a Jekyll site built and deployed to GitHub Pages via
GitHub Actions (see `.github/workflows/jekyll-build.yml`).

## Local development

```sh
bundle install
bundle exec jekyll serve
```

## Structure

- `_data/feeds.yml` — a selection of LDES examples (`/examples/`). Set `playground` to the id of a preset in
  `playground/sync.js` (`SYNC_PRESETS`) when the playground offers the feed: its card then links to `/playground/#example=<id>`.
  `category` (`catalogues`, `heritage` or `environment`) puts the feed in a section of the page; feeds with the same
  `collection` share one card, described in `_data/feed_collections.yml`.
- `_data/publications.yml` — the publications list (`/publications/`)
- `_posts/` — news and blog posts (`/news/`), also exposed as an RSS feed at `/news/feed.xml`
- `community/`, `tools/` — static pages

The site embeds RDFa (schema.org, DCAT) and JSON-LD structured data throughout.

## Contextual paper citations

Research papers remain at `/publications/` and are discovered from relevant content rather than the main menu.
To add a paper box to an HTML page or Markdown post, reference its stable `id` in `_data/publications.yml`:

```liquid
{% include paper-citation.html paper="base-registries" context="Why this paper is relevant here." %}
```

The box uses the publication's first link to read the paper and its authors, publication year, venue, pages,
and DOI (when available) to display a citation. Keep a paper or preprint as the first link for cited papers.
For a feed example, set `paper` to the publication id and add a `paper_context` explanation in `_data/feeds.yml`.

## RiverBench LDESs

`/riverbench/` publishes LDES 2.0 descriptions of the datasets of [RiverBench](https://w3id.org/riverbench/): one root page
`riverbench/<dataset-id>/root.trig` per dataset (it links to the Jelly-RDF file that RiverBench hosts, no data is copied),
`riverbench/catalog.ttl` (a DCAT catalog of all datasets, with every LDES as a distribution) and `riverbench/index.html`
(the human-readable page). These files are generated, do not edit them by hand:

```sh
cd scripts
npm install
node generate-riverbench.mjs            # writes ../riverbench/; add --cache <dir> to keep the downloads
```

The script fetches the RiverBench metadata, downloads the Jelly distribution with 10K elements of every dataset that gets an LDES
(about 17 MB), and checks the description against it (number of elements equals `rb:hasStreamElementCount`, one unique member
identifier per message, ascending timestamps where an `ldes:timestampPath` is declared; it fails otherwise). `ldes:timeFrom` and
`ldes:timeUntil` come from that file. How a member is defined per dataset, and why a dataset gets no LDES, is in the `DATASETS` and
`WITHOUT_LDES` tables at the top of the script. Try a result with `npx ldes-client https://ldes.tech/riverbench/officegraph/root.trig`
(LDES 2.0 support in the client is experimental).

## Playground

`/playground/` runs [ldes-client](https://github.com/rdf-connect/ldes-client) (pinned in `playground-src/package.json`) in the
browser to keep a view in sync: it replicates an LDES, builds a local search and map view on it while the members stream
in, pauses after 1 000 members (“Fetch more members” reads on from the same stream) and continues from its bookmark on the
next sync. ldes-client runs in a module Web Worker (`playground/replicator.js`), so that parsing a large page does not
freeze the page; `playground/members.js` turns members into what the page shows (names, geometry, Turtle) and runs in
the worker too. The examples are `SYNC_PRESETS` in `playground/sync.js`; every one must be readable from a browser (CORS). The
whole configuration is stored, compressed, in the URL hash, so a setup can be shared; `#example=<preset>` opens an example.

The browser bundle `playground/ldes-tech.min.js` is committed. To rebuild it, for example after bumping ldes-client:

```sh
cd playground-src && npm install && npm run build
```

Publishers must allow cross-origin reads (CORS).
