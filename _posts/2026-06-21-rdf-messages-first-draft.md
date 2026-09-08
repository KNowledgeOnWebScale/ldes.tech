---
title: RDF Messages reaches its first draft
description: A first draft dated 21 June 2026 explores a common foundation for exchanging RDF messages, with promising possibilities for future LDES work.
authors:
- The ldes.tech editors
tags:
- RDF Messages
- LDES
---

**RDF Messages reached a first draft on 21 June 2026.** The [living document](https://w3c-cg.github.io/rsp/spec/messages), edited by Pieter Colpaert and Piotr Sowiński, describes how RDF data can be exchanged as distinct messages, streams of messages, and stored message logs.

An RDF message can contain several triples or quads that belong together and should be interpreted as one unit. Making those boundaries explicit helps software preserve the intended meaning as data moves between systems.

The work draws inspiration from Piotr Sowiński’s keynote at the LDES workshop during SEMIC 2025, where Jelly and LDES were discussed as technologies that could share a common foundation. [Pieter’s conference report](https://pietercolpaert.be/conferences/2025/11/28/semic-trip-report.html) captures that conversation.

For LDES, this is a promising avenue for future work: a shared message model could help connect event streams with other RDF processing and transport tools. These are possibilities to explore, not requirements introduced into LDES by this draft.

Read the [RDF Messages draft](https://w3c-cg.github.io/rsp/spec/messages) and join the discussion in the [RDF Stream Processing Community Group repository](https://github.com/w3c-cg/rsp).
