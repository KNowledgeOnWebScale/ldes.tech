# Website review — 9 September 2026

The replacement is recognisably LDES: the logo, Open Sans, purple (#5252cf) and violet (#7950e6) match the previous site. Its larger navigation makes the expanded content easier to find. The original used a white, compact, typography-led page; the initial replacement’s gradient hero and repeated rounded cards made it feel more like a generic product landing page.

## Changes made

- Retained the identity and “Event sourcing on Web-scale” tagline. Used a pale hero background, the coloured logo, fewer decorative effects, and plainer lists for news, publications, and the registry.
- Separated the tagline from the benefit: “Publish your data and its changes. Let consumers build their own views and keep them up to date.” The homepage now moves from definition to a museum example, then publishing, consumption, and independent views.
- Removed “forever,” “perfectly in sync,” the stale alpha release claim, and the suggestion that every stream must use chronological fragmentation. Explained retention and the distinction between navigation order and chronological order. Removed the unsupported W3C-community attribution from site metadata.
- Turned news into a publication-style page with a masthead, lead story, dated archive rows, bylines, and editorial summaries. Reused those rows on the homepage. Preserved article URLs and RSS.
- Expanded the registry from 9 to 18 unique endpoints: the 8 missing explorer streams and Design Museum Gent exhibitions. Marine Regions was already present. Each entry has source evidence, and explorer observations retain their harvest date and partial-harvest status. The generic “known publishers” section was removed because it mixed deployment claims with discoverable feeds and described Flanders feeds as internal without sufficient evidence.
- Narrowed the bibliography from 14 to 6 entries: the cultural heritage LDES profile, Flanders Smart Data Space deployment, Solid containers, CoGhent collections, base registries, and Marine Regions. Each entry explains its relevance, and the SWIB presentation is labelled as a talk rather than a scholarly article.
- Removed the TREE materializable-interface, prefix-search, reachability-query, and geospatial-partitioning papers. Also excluded SDS vocabulary, the general Linked Connections framework, the railway interoperability paper (LDES appears as a prospective approach), and GRMP monitoring from this deliberately focused bibliography. GRMP remains covered in news.
- Fixed the Specification navigation destination and made the skip link available on all pages, including posts.

## Editorial follow-up

“Event sourcing on Web-scale” is a useful continuity marker, but needs the plain-language explanation beside it. The strongest story is shared publication followed by independent consumer views. Technical details should support that story rather than lead with vocabulary or release history.

The imported 2021 API-versus-dump post discusses events in 2025. Its original publication date may be valid, but an actual revision date and a visible “updated” label would make the history clearer. Do not invent a revision date. It also repeats its opening argument. The copied articles would benefit from a separate technical editorial pass; this change concentrates on the site’s framing and discovery pages.

The registry is a sourced directory, not a conformance or uptime monitor. The explorer snapshot lists 9 of 15 configured streams with successful harvest data; unavailable entries were not promoted as working feeds. MINT’s latest harvest was partial because of its size budget. CoGhent and Rijksmuseum entries are supported by publisher documentation, not a new end-to-end harvest. A future automated check should record reachability and LDES validity separately.

## Sources consulted

- [Previous LDES website](https://ldes.tech/) and its [stylesheet](https://tree.linkeddatafragments.org/styles/main.css).
- [LDES specification](https://w3id.org/ldes/specification), which redirects to the [1.0.0 release](https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/index.html).
- [LDES Explorer](https://ldes-explorer-ec66be.pages.ilabt.imec.be/) and the `data/dataset.json` metadata behind each of its nine listed datasets. Per-dataset links are stored in `_data/feeds.yml`.
- [CoGhent documentation](https://coghent.github.io/LDES/), including its institution, shared-vocabulary, and exhibition pages; [Rijksmuseum LDES documentation](https://data.rijksmuseum.nl/docs/ldes/).
- [Flanders Smart Data Space paper](https://pietercolpaert.be/papers/preprint-iswc2024-vanlancker-vsds.pdf), [railway interoperability paper](https://julianrojas.org/papers/iswc2021-in-use/), and [SWIB talk announcement](https://forum.swib.org/t/the-linked-data-event-streams-ldes-profile-for-cultural-heritage-datasets/1450).

## Validation

Jekyll production output builds successfully. Generated JSON-LD parses, local link destinations exist, and registry endpoint URLs are unique. Browser checks cover the homepage, news, registry, and publications at desktop (1280px) and mobile (390px) widths.


## Follow-up changes — 9 September 2026

The directory is now “LDES examples” at `/examples/`, explicitly presented as a selection. The former `/registry/` URL redirects there. The page introduces catalog and cultural heritage use cases from the SEMIC implementation reports, links individual reports, and includes the Swedish catalog feed, bringing the selection to 19 examples. This supersedes the registry naming and counts above.

Removed the news eyebrow and “Latest story” label, and replaced prose ampersands with “and.” Added LDFetch with instructions for its Hypermedia pane. The scalability article is fully rewritten as “Growing an LDES: more data, faster updates, more consumers,” with a contents navigation, comparison table, backlog example, and an explicit revision date. Its original URL and publication date remain available.

Added launch news dated 25 November 2025 and RDF Messages draft news dated 21 June 2026. The supplied RDF Messages URL returned 404; the working document is at https://w3c-cg.github.io/rsp/spec/messages. The SEMIC date and workshop context are supported by the official conference archive and Pieter’s trip report. New posts contain their source links.
