---
description: Data dumps drift out of date, while custom query APIs take work to maintain. Event streams let consumers build and update their own views.
title: "Escaping the false dichotomy of API vs. data dump with Linked Data Event Streams"
authors:
- Pieter Colpaert
tags:
- LDES
---

Data publishers often face a familiar but painful choice: should they provide a full data dump or a querying API?
Each option comes with a hidden cost.
The data dump leads to replication hell — multiple copies scattered across consumers, each potentially outdated.
A querying API leads to maintenance hell — constant effort to keep endpoints up-to-date, scalable, and reliable.
With Linked Data Event Streams (LDES), we provide a way out.

Data publishers are too often asked to pick between two unsatisfying options.
The data dump looks harmless: publish a full export and let consumers do their thing.
In practice it creates a **replication hell**: multiple uncoordinated copies drift out of sync; consumers juggle deltas and snapshots; provenance cannot be traced; history gets lost in overwrites; and every "fresh" download quietly rebuilds the same indexes in a hundred places.

Take for example the address registry in Flanders for which [data dumps are available](https://basisregisters.vlaanderen.be/producten/grar#downloadbestandgrar).
Probably every municipality in Flanders takes a copy of this file for use cases such as autocompleting the street names for the forms they use everywhere.
When developers make such integrations, synchronization is an afterthought: this dataset doesn't change that often anyway, right?
Think again: there are minor changes every day, with new addresses coming into play and old ones becoming "historized".
When in [2016, 2019 and 2025, cities in Belgium decided to fuse](https://en.wikipedia.org/wiki/Fusion_of_the_Belgian_municipalities), a lot of street names also needed to be renamed to avoid duplicate names.
Instead of [this base registry](https://interoperable-europe.ec.europa.eu/collection/semic-support-centre/base-registries) being updated from the source, services started making the changes they needed manually in their local copies, leading to a replication hell.

On the other side sits the querying API.
It promises precision — ask only for what you need — while quietly enrolling the publisher in **maintenance hell**.
New use case? New endpoint.
New query language that became popular? Again yet another API to be provided.
The provider becomes an involuntary platform operator, while consumers still only have a limited processing possibility of the dataset as they can only query the API in the ways the data provider managed to set up.
Each endpoint that has been set up comes with its own maintenance cost.
After a while, when priorities shift or budgets shrink, it will have become impossible to turn off any of the existing APIs as there may still be an application that relies on it.
The budget that once was used for innovation and creating a better public service, is now being used for maintaining legacy APIs.

Take again the example of the address registry in Flanders for which, next to data dumps, [also a plethora of API products are available](https://web.archive.org/web/20250823085609/https://vlaamseoverheid.atlassian.net/wiki/spaces/AGB/pages/6099766021/Raadpleegdiensten).
Specific functionalities that were once brought online need to remain maintained: there may always be that one service that is still relying on this API.
Certainly for address registries, multiple functionalities of the dataset are expected, such as: finding the geolocation of an (or multiple) address(es), a geospatial interface to visualize the data, a historic view of what addresses existed in the past until today, an autocompletion interface for streetnames, municipalities and addresses, a SPARQL, GQL and GraphQL API for graph-based access, a specific service that allows calculating what addresses will be impacted by a road closure, etc.
It doesn't matter how many APIs you have: it will never be sufficient — there's always going to be that other person who needs a functionality that does not yet exist.

There are, however, other paths. Let's start from the idea of taking full copies, i.e. "dumps", but let's change the intent and the name. Let's call it a stream. This way, it sets the expectation that developers of consumption pipelines will code for history and future: they will re-interpret what happened and, with exactly the same code, stay in sync with what will happen.
This is the mindset behind [Linked Data Event Streams (LDES)](https://ldes.tech).
The ambition level is to introduce semantic interoperability through Linked Data, and combine this idea with how developers interact with streams.
LDES publishes the dataset as an append-only sequence of immutable members with stable identifiers, so any party can replicate once and then follow updates.
Hence the straightforward name: the combination of having this ambition towards interoperability, and the ambition to always keep every copy up to date, becomes Linked Data + Event Streams: LDES in short.

![The LDES logo](https://tree.linkeddatafragments.org/img/logo-ldes.svg)

This shift unlocks governance opportunities.
With an authoritative event source online, the publisher can decide which higher-level interfaces to keep maintaining, and which to let the ecosystem carry.
A SPARQL endpoint, an OGC API, or a GraphQL service may be useful today and optional tomorrow.
If a GraphQL API stops aligning with the publisher's priorities, the publisher can bring it offline, while the consumer that still needs it can spin up their own GraphQL server that replicates and synchronises from the event source, preserving functionality without forcing the publisher to keep every interface alive forever.
If you maintain a base registry or any dataset that changes over time, start by publishing the LDES at the event source. Everything else can — and should — derive from there.

For the technical details, see the LDES specification at [https://w3id.org/ldes/specification](https://w3id.org/ldes/specification).
Various implementations of clients and servers are available. In order to interact with the community, visit [https://ldes.tech](https://ldes.tech).

### The talk at ENDORSE 2021

At ENDORSE 2021 there was a talk in which I explain the contents of this blog post:

<div class="iframe-container">
  <iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/89UVTahjCvo?start=1096" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>

### P.S.

This post was planned to be published in 2021, but remained in draft until 2025. It was only in 2025 that there was time to finalize it, keeping the initial planned publication date.
