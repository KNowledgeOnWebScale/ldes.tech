---
title: "Growing an LDES: more data, faster updates, more consumers"
description: Scale an LDES by understanding four different pressures and choosing where to spend storage, bandwidth, and processing time.
layout: post
feature: true
last_modified_at: 2026-09-09
authors:
- Pieter Colpaert
tags:
- LDES
toc:
- title: A shared source, independent views
  id: shared-source
- title: More data
  id: more-data
- title: Faster updates
  id: faster-updates
- title: More consumers
  id: more-consumers
- title: More datasets
  id: more-datasets
- title: What to measure
  id: what-to-measure
---

A museum collection grows over decades. A sensor produces observations every minute. A public dataset suddenly attracts thousands of consumers. Each puts a different kind of pressure on a data publisher.

“Does LDES scale?” becomes more useful when we ask what is growing and what consumers need. The answer guides decisions about pages, caching, retention, and processing capacity.

## A shared source, independent views
{: #shared-source }

LDES lets a publisher expose data and its changes through a common interface. Consumers can copy the available members, follow updates, and maintain their own databases, search indexes, or APIs. Query work can then happen on those consumer views.

A typical publication splits the stream into linked pages. A time-based view might lead from years to months and then to pages of members. A new consumer traverses the available history; a returning consumer follows the part relevant to its next updates. The [LDES specification](https://w3id.org/ldes/specification) defines the contract between those publishers and consumers.

That design gives us several ways to manage growth. Each comes with a tradeoff.

<div class="article-table" markdown="1">

| What is growing? | What helps? | What to watch |
| --- | --- | --- |
| Stored history | Compression, page sizing, retention | How much history a new or returning client can recover |
| Update rate | Processing capacity, sensible polling | End-to-end delay and a growing backlog |
| Consumer numbers | Shared HTTP caches and reusable pages | Requests reaching the origin server |
| Dataset numbers | Shared vocabularies and application profiles | Mapping and validation work per source |

</div>

## More data: make history affordable
{: #more-data }

Start with the bytes you actually transfer. HTTP compression can reduce the cost of textual RDF, but the saving depends on the data and format. Measure compressed transfer size alongside parsing time: smaller responses do not automatically mean faster processing.

Page size is another balancing act. Small pages can make following recent changes efficient, but require more requests during a full copy. Large pages can reduce request overhead while making clients download more data than they need. Try both a first-time harvest and an incremental update when choosing a size.

Retention is a separate decision. A sensor publisher might keep recent observations available and publish daily aggregates for longer-term analysis. A collection publisher might retain only a subset of record versions in one view. An archive can preserve more history for consumers that need it.

Document that choice. A client that returns after a long pause can only catch up from a view if the necessary data is still available. If it has missed the retention window, it may need to rebuild its view from an appropriate snapshot or another source. Aggregates also answer different questions from raw observations; they should be described as such.

## Faster updates: keep the backlog under control
{: #faster-updates }

There are three different measurements here: how quickly members arrive, how quickly a consumer processes them, and how long a change takes to reach an application.

A consumer needs enough sustained throughput to keep up, with spare capacity to recover after interruptions. Count the whole pipeline: downloading, parsing RDF, extracting members, applying transformations, and writing to the destination. A fast parser does not compensate for a slow database write.

For example, suppose a source publishes 100 members per second and a consumer can process 150. After an hour offline, it has 360,000 members to catch up on. While new members keep arriving, only 50 members per second of capacity remains for that backlog. Under those simplified, constant-rate assumptions, catching up takes another two hours.

Polling affects freshness too. A two-minute polling interval alone cannot promise a two-minute end-to-end delay: publication, caching, network time, and downstream processing all contribute. Choose a polling strategy that respects the publisher’s HTTP cache information and leaves room for processing. Conditional requests can avoid retransmitting unchanged responses. See the [HTTP caching specification](https://www.rfc-editor.org/rfc/rfc9111).

A throughput figure from one implementation is a benchmark for that setup, not a limit imposed by LDES. Record the dataset, hardware, page layout, network conditions, and destination alongside any number you publish.

## More consumers: reuse the same responses
{: #more-consumers }

If many clients need the same pages, a shared HTTP cache or CDN can serve them without every request reaching the publisher. Consumers still maintain and query their own views; the publisher concentrates on making a reusable source available.

Distinguish immutable members from immutable pages. A page may acquire new members or links even though existing members never change. Only give a response a long cache lifetime when its contents support that promise.

For a finished page, the HTTP `immutable` directive tells a cache that the response will not change during its freshness lifetime. It does not mean “never request this URL again.” Mutable pages need cache lifetimes that fit the desired update delay. [RFC 8246](https://www.rfc-editor.org/rfc/rfc8246) explains that distinction.

Check the cache hit rate and the requests that still reach your origin. Authentication, personalised responses, and frequently changing pages can reduce the opportunity for shared caching. More subscribers will still use bandwidth somewhere; caching helps distribute that work.

## More datasets: reduce integration work
{: #more-datasets }

A common stream interface makes fetching data reusable. Understanding the data remains part of the job.

Shared vocabularies and application profiles let a consumer recognise familiar structures across publishers. SHACL shapes can help express and validate those expectations. A catalog harvester built around a shared profile has less source-specific work to do than one built around every publisher’s individual response format.

The [SEMIC implementation reports](https://github.com/SEMICeu/LDES-implementation-reports) show this approach for catalog metadata and cultural heritage. They are useful starting points for deciding what your publishers and consumers should agree on.

## What to measure before you grow
{: #what-to-measure }

Run three realistic scenarios: a consumer starting from nothing, a consumer following current updates, and a consumer returning after an outage. Measure transferred bytes, request counts, processing throughput, destination write time, and the delay until a member becomes useful in the application.

Then increase the pressure you expect to face: more history, a burst of updates, more clients, or another dataset. Watch where the work accumulates and adjust that part of the system.

LDES gives publishers and consumers a shared basis for this work. Good scaling comes from matching that design to the data, the available infrastructure, and the freshness consumers actually need.
