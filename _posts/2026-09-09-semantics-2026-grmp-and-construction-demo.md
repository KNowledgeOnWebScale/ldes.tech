---
description: >-
  LDES at SEMANTiCS 2026: monitoring data feeds with GRMP and sharing construction data through event streams.
title: "LDES at SEMANTiCS 2026: a monitoring platform and a construction-data streaming demo"
authors:
- The ldes.tech editors
tags:
- LDES
- SEMANTiCS
---

Two LDES-related contributions have been accepted for [SEMANTiCS 2026](https://2026-eu.semantics.cc/), the 21st International Conference on Semantic Systems: an industry-track talk about monitoring linked data resources, and a demo about streaming construction data that already comes with a great video.

## Industry track: GRMP, a platform to monitor linked data resources

**GRMP: An open-source platform for automatic monitoring of linked data resources on the web**, by Stijn Denis, Marc Portier, Cedric Decruw and Stijn Deknudt, has been accepted in the [SEMANTiCS 2026 industry track](https://2026-eu.semantics.cc/page/accepted_industry.html).

> When publishing linked data-related resources through the web, it is strongly advised to actively monitor them and ensure they remain accessible, up-to-date and continue to provide data in the intended manner. Public registries and dashboards do exist, but they require active maintenance themselves lest they become outdated and provide incorrect information regarding the status of these resources. In order to support the management of their own LDES servers and SPARQL endpoints and monitor the status of external web resources they consume, the scientific institute VLIZ (Vlaams Instituut voor de Zee &ndash; Flanders Marine Institute) developed GRMP (Graph Resources Monitoring Platform) in cooperation with Flemish IT and software company Sirus. GRMP is an open-source and highly modular platform which allows for the automatic monitoring of linked data resources and web resources in general. GRMP is container-based and primarily consists of an orchestrator which manages and directs test suite containers based on configurations defined in one or more YAML files. Due to its modular nature, users can rapidly develop new test suites in any desired programming language, provided that they have been containerized and adhere to a few guidelines allowing for proper communication with the orchestrator. Additionally, the environment on top of which the system runs can be freely chosen, ranging from local deployments to integration with automation workflows like GitHub Actions. When running within GitHub Actions, additional features are available, such as automatic issue creation resulting from failed tests.

This is directly relevant to everyone running an [LDES feed among our examples]({{ '/examples/' | relative_url }}): keeping a feed reachable, well-formed and up-to-date over time is exactly the kind of maintenance burden that motivated LDES's append-only, cache-friendly design in the first place, and GRMP tackles the operational side of that promise. VLIZ, incidentally, is also the publisher of the [Marine Regions Gazetteer LDES]({{ '/examples/' | relative_url }}), one of the longest-running production feeds among our examples.

## A demo worth watching: streaming construction data with LDES

Also accepted at SEMANTiCS 2026 is a demo on **Streaming Interoperable Construction Data with LDES**, by Carlos Ramonell and Mathias Bonduel, which comes with a genuinely nice explainer video:

<div class="iframe-container">
  <iframe src="https://www.youtube.com/embed/bX0UqZ7oGwI" title="Streaming Interoperable Construction Data with LDES" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>

You can find the full entry, keywords and any accompanying materials on the [conference's demo page](https://2026-eu.semantics.cc/page/p%26d-detail?page=60).

Both contributions are a good reminder that LDES keeps finding new domains &mdash; from marine biodiversity data to construction information management &mdash; united by the same simple idea: publish an append-only, cacheable stream once, and let every consumer replicate and stay in sync at their own pace.

See you at SEMANTiCS 2026!
