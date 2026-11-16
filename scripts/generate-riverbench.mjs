#!/usr/bin/env node
/**
 * Generates the LDES 2.0 descriptions of the RiverBench datasets that ldes.tech hosts under /riverbench/:
 *
 *   riverbench/<dataset-id>/root.trig   the LDES 2.0 root page of one dataset
 *   riverbench/catalog.ttl              a DCAT catalog of all RiverBench datasets, with every LDES as a distribution
 *   riverbench/index.html               the human-readable Jekyll page about them
 *
 * The data itself is not copied: the root page links to the Jelly-RDF file that RiverBench hosts.
 *
 * Usage:  cd scripts && npm install && node generate-riverbench.mjs [--out ../riverbench] [--cache <dir>]
 *
 * It fetches https://w3id.org/riverbench/v/dev (the catalog) and the metadata of every dataset in it, downloads the
 * Jelly distribution with 10K elements of every dataset that gets an LDES, and checks the description against that file:
 * the number of messages equals rb:hasStreamElementCount, every message has exactly one member identifier according to
 * the membership rule, the identifiers are unique, and the elements are in ascending order of the timestamp where an
 * ldes:timestampPath is declared. The first and the last timestamp give ldes:timeFrom and ldes:timeUntil.
 * The output is deterministic for the same RiverBench metadata and data. It fails when a check fails.
 *
 * Which datasets get an LDES, and how a member is defined, is decided in DATASETS below, from the stream types that
 * RiverBench states and from reading the files. Datasets that cannot be described faithfully stay in the catalog without LDES.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import N3 from "n3";
import { Parser as JellyParser } from "rdfjs-jelly";

const { DataFactory } = N3;
const { namedNode } = DataFactory;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
};
const OUT = path.resolve(option("--out", path.join(HERE, "..", "riverbench")));
const CACHE = option("--cache", undefined);

const SITE = "https://ldes.tech/riverbench/";
const CATALOG_URL = "https://w3id.org/riverbench/v/dev";
/** A Jelly file bigger than this is not offered as a page of an LDES that a browser has to read */
const MAX_PAGE_BYTES = 10 * 1e6;
const DISTRIBUTION_ID = "jelly-10k";

const NS = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    sh: "http://www.w3.org/ns/shacl#",
    ldes: "https://w3id.org/ldes#",
    dcat: "http://www.w3.org/ns/dcat#",
    dct: "http://purl.org/dc/terms/",
    foaf: "http://xmlns.com/foaf/0.1/",
    prov: "http://www.w3.org/ns/prov#",
    rb: "https://w3id.org/riverbench/schema/metadata#",
    stax: "https://w3id.org/stax/ontology#",
    eurovoc: "http://eurovoc.europa.eu/",
    tl: "http://purl.org/NET/c4dm/timeline.owl#",
    saref: "https://saref.etsi.org/core/",
    sao: "http://iot.ee.surrey.ac.uk/citypulse/resources/ontologies/sao.ttl#",
    np: "http://www.nanopub.org/nschema#",
    lod: "http://lod.openaire.eu/vocab/",
    dc: "http://purl.org/dc/elements/1.1/",
};
const RDF_TYPE = NS.rdf + "type";
const XSD_DATETIME = NS.xsd + "dateTime";

/**
 * How a dataset is described, decided from RiverBench's metadata and from reading the 10K Jelly file.
 *  - member: how the identifier of a member is found in one message (a Jelly frame):
 *      graph  ldes:memberGraph true: the only named graph of the message
 *      type   ldes:memberType: the only subject with this rdf:type
 *      path   ldes:memberPath: the only subject that has this predicate
 *      self   ldes:memberPath [ sh:zeroOrMorePath rdf:type ]: the message describes exactly one subject, which is the
 *             member. No property or class is shared by all messages of such a dataset, but RiverBench states that each
 *             graph is uniquely identified by its subject IRI. A zero-length path leads from every subject to itself.
 *  - timestampPath: only when the elements are in ascending order of a xsd:dateTime in the file. Else the order of the
 *    file (implicit order, ldes:pageNumber) is used.
 *  - shape: what every member conforms to (also checked against the file).
 *  - element / member / order: text for the comments in root.trig and for index.html.
 */
const DATASETS = {
    "assist-iot-weather-graphs": {
        memberShort: "the named graph of a message (with its timestamp).",
        rule: { kind: "graph" },
        timestampPath: NS.prov + "atTime",
        shape: [{ path: NS.prov + "atTime", datatype: XSD_DATETIME, minCount: 1, maxCount: 1 }],
        element:
            "Every stream element is one timestamped named graph with the weather measurements of one moment: a weather " +
            "station of the Systems Research Institute of the Polish Academy of Sciences measured every 10 s.",
        sample: [
            "  <https://assist-iot.eu/pilot2_rdf/graph/ws/ibs_1/2023-01-02T15%3A36%3A37.065535>",
            '      prov:atTime "2023-01-02T15:36:37.065535"^^xsd:dateTime .                       # default graph',
            "  <https://assist-iot.eu/pilot2_rdf/graph/ws/ibs_1/2023-01-02T15%3A36%3A37.065535> {",
            '      pilot:obs/humidity a sosa:Observation ; sosa:resultTime "2023-01-02T15:36:37.065535"^^xsd:dateTime ; ...',
            "  }",
        ],
        memberText:
            "the member is the only named graph of the message. The default graph triple with the timestamp belongs to " +
            "the same member.",
        order:
            "RiverBench states that the elements are split in time on prov:atTime (rb:hasTemporalProperty), and the " +
            "data is in ascending order.",
    },
    "citypulse-traffic-graphs": {
        memberShort: "the named graph of a message (with its timestamp).",
        rule: { kind: "graph" },
        shape: [{ path: NS.tl + "at", datatype: XSD_DATETIME, minCount: 1, maxCount: 1 }],
        element:
            "Every stream element is one named graph with one measurement of a traffic sensor in Aarhus (every 5 minutes), " +
            "annotated with its timestamp (tl:at) in the default graph.",
        memberText:
            "the member is the only named graph of the message. The default graph triple with the timestamp belongs to " +
            "the same member.",
        order:
            "the elements are grouped per sensor and in ascending time within the sensor (RiverBench: TopicStreamElementSplit " +
            "and TimeStreamElementSplit on tl:at), so the timestamps are not in ascending order in the file as a whole: " +
            "in the first 10 000 elements they restart after the element 9 304 (0-based). An ldes:timestampPath requires " +
            "an ascending order, so there is none, and the order of the file is the order of the LDES.",
    },
    "citypulse-traffic": {
        memberShort: "the subject of type sao:FeatureOfInterest of a message.",
        rule: { kind: "type", term: NS.sao + "FeatureOfInterest" },
        shape: [{ path: RDF_TYPE, hasValue: NS.sao + "FeatureOfInterest", minCount: 1 }],
        element:
            "Every stream element is the set of triples (in the default graph) about one measurement of a traffic sensor " +
            "in Aarhus (every 5 minutes).",
        memberText:
            "every message has exactly one subject of type sao:FeatureOfInterest, with an IRI that is unique to the " +
            "message (the context of the measurement). That is the member identifier.",
        order:
            "the elements are grouped per sensor and in ascending time within the sensor (RiverBench: TopicStreamElementSplit " +
            "and TimeStreamElementSplit on tl:at), so the timestamps are not in ascending order in the file as a whole, " +
            "and are not on the member itself either. There is no ldes:timestampPath: the order of the file is the order " +
            "of the LDES.",
    },
    "digital-agenda-indicators": {
        memberShort: "the one subject of a message.",
        rule: { kind: "self" },
        element:
            "Every stream element is the set of triples (in the default graph) about one statistical observation of the " +
            "Digital Agenda Scoreboard.",
        memberText:
            "every message describes exactly one subject, an IRI: RiverBench states that each graph is uniquely identified " +
            "by its subject IRI. That subject is the member identifier. Not all of them have a class or a property that " +
            "all others have (e.g. some only have a value), so ldes:memberPath uses a zero-length path " +
            "(sh:zeroOrMorePath rdf:type), which leads from every subject to itself.",
        order:
            "RiverBench states that the elements are ordered alphabetically, and not by time. There is no ldes:timestampPath: " +
            "the order of the file is the order of the LDES.",
    },
    muziekweb: {
        memberShort: "the one subject of a message.",
        rule: { kind: "self" },
        element:
            "Every stream element is the set of triples (in the default graph) about one item of the Muziekweb knowledge " +
            "base (the size of an element depends on how much is known about the item).",
        memberText:
            "every message describes exactly one subject, an IRI: RiverBench states that each graph is uniquely identified " +
            "by its subject IRI. That subject is the member identifier. RiverBench says that some items have no class, so " +
            "ldes:memberPath uses a zero-length path (sh:zeroOrMorePath rdf:type), which leads from every subject to itself.",
        order:
            "The elements have no timestamp that RiverBench describes. There is no ldes:timestampPath: the order of the " +
            "file is the order of the LDES.",
    },
    nanopubs: {
        memberShort: "the subject of type np:Nanopublication of a message (four named graphs).",
        rule: { kind: "type", term: NS.np + "Nanopublication" },
        shape: [{ path: RDF_TYPE, hasValue: NS.np + "Nanopublication", minCount: 1 }],
        element:
            "Every stream element is one nanopublication: an RDF dataset of four named graphs (head, assertion, " +
            "provenance and publication info) and no default graph.",
        memberText:
            "a message has four named graphs, so ldes:memberGraph does not apply. The nanopublication is the only subject " +
            "of type np:Nanopublication in the head graph, and has an IRI of its own: that is the member identifier. All " +
            "quads of the message, in the four graphs, belong to the member.",
        order:
            "RiverBench does not state a time for the elements. There is no ldes:timestampPath: the order of the file is " +
            "the order of the LDES.",
    },
    officegraph: {
        memberShort: "the subject of type saref:Measurement of a message.",
        rule: { kind: "type", term: NS.saref + "Measurement" },
        timestampPath: NS.saref + "hasTimestamp",
        shape: [
            { path: RDF_TYPE, hasValue: NS.saref + "Measurement", minCount: 1 },
            { path: NS.saref + "hasTimestamp", datatype: XSD_DATETIME, minCount: 1, maxCount: 1 },
        ],
        element:
            "Every stream element is the set of triples (in the default graph) about one measurement of one of the IoT " +
            "devices in a Dutch office building, and the property that it relates to.",
        memberText:
            "every message has exactly one subject of type saref:Measurement, with an IRI of its own: that is the member " +
            "identifier. The other triples of the message (about the measured property) belong to the member.",
        order:
            "RiverBench states that the elements are ordered from oldest to newest by saref:hasTimestamp (its " +
            "rb:hasTemporalProperty says sosa:resultTime, which this data does not use). The values are in ascending " +
            "order in the file.",
    },
    "openaire-lod": {
        memberShort: "the subject of type lod:ResultEntity of a message.",
        rule: { kind: "type", term: NS.lod + "ResultEntity" },
        shape: [{ path: RDF_TYPE, hasValue: NS.lod + "ResultEntity", minCount: 1 }],
        element:
            "Every stream element is the set of triples (in the default graph) about one scientific result in OpenAIRE.",
        memberText:
            "every message has exactly one subject of type lod:ResultEntity, with an IRI of its own: that is the member " +
            "identifier.",
        order:
            "RiverBench states a time of collection for each element (lod:dateofcollection), but the values are xsd:string " +
            "literals with different timezones, and not xsd:dateTime, so they cannot be the ldes:timestampPath. There is no " +
            "ldes:timestampPath: the order of the file is the order of the LDES.",
    },
    "osm2rdf-denmark": {
        memberShort: "the one subject with an rdf:type of a message.",
        rule: { kind: "path", term: RDF_TYPE },
        shape: [{ path: RDF_TYPE, minCount: 1 }],
        element:
            "Every stream element is the set of triples (in the default graph) about one node, way or relation of " +
            "OpenStreetMap in Denmark (an element can be large: up to 8 899 triples in the first 10 000).",
        memberText:
            "every message has exactly one subject with an rdf:type (a node, way or relation), which is the member " +
            "identifier: ldes:memberPath rdf:type.",
        order:
            "The data has an OpenStreetMap timestamp (osmmeta:timestamp), but the elements are not in order of time, and " +
            "RiverBench does not state a time for the elements. There is no ldes:timestampPath: the order of the file is " +
            "the order of the LDES.",
    },
    politiquices: {
        memberShort: "the subject with a dc:title (the news article) of a message.",
        rule: { kind: "path", term: NS.dc + "title" },
        shape: [{ path: NS.dc + "title", minCount: 1 }],
        element:
            "Every stream element is the set of triples (in the default graph) about one news article: the article, and " +
            "a blank node with the relation between two politicians that was found in it.",
        memberText:
            "every message has exactly one subject with a dc:title, the news article, which has an IRI of its own: that is " +
            "the member identifier: ldes:memberPath dc:title. The other subject of the message is a blank node.",
        order:
            "RiverBench does not state a time for the elements (the article has a dc:date, not used here). There is no " +
            "ldes:timestampPath: the order of the file is the order of the LDES.",
    },
};

/** Datasets without an LDES, with the reason that is stated in the catalog page. Decided by reading the 10K files. */
const WITHOUT_LDES = {
    "assist-iot-weather":
        "Every element is a set of triples in the default graph with about 30 subjects: ten observations and their sensor, " +
        "feature of interest and properties. The feature of interest, the sensor and the properties are the same in all " +
        "elements, and no class or property singles out one subject with an IRI that is unique to the element. LDES 2.0 " +
        "cannot identify the members (ldes:memberGraph, ldes:memberType and ldes:memberPath all need one identifier per " +
        "message). The graph variant (assist-iot-weather-graphs) has an LDES.",
    "linked-spending":
        "Every element describes one subject, but 43 of the first 10 000 elements describe a subject that an earlier " +
        "element described already (for example the description of a dataset, split over two elements), so the subject " +
        "cannot be the identifier of the member: two members would have the same identifier.",
    "lod-katrina":
        "Elements have between 1 and 13 subjects (observations with their time instants, and independent annotations) and " +
        "no class or property is shared by exactly one subject of every element, so LDES 2.0 cannot identify the members.",
    "yago-annotated-facts":
        "The Jelly files of this dataset use RDF-star, which the Jelly decoder of the ldes-client (rdfjs-jelly 0.2.0) " +
        "does not support, so the file cannot be read as an LDES page.",
    "dbpedia-live":
        "The smallest Jelly distribution that RiverBench offers (10K elements) is too large to read in a browser.",
};

// ---------------------------------------------------------------------------------------------------------------------
// Fetching and RDF helpers

async function download(url, accept) {
    const response = await fetch(url, { headers: accept ? { accept } : {}, redirect: "follow" });
    if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

async function cached(url, accept, name) {
    if (CACHE) {
        fs.mkdirSync(CACHE, { recursive: true });
        const file = path.join(CACHE, name);
        if (fs.existsSync(file)) return fs.readFileSync(file);
        const body = await download(url, accept);
        fs.writeFileSync(file, body);
        return body;
    }
    return download(url, accept);
}

function parseTurtle(buffer) {
    return new N3.Store(new N3.Parser().parse(buffer.toString("utf8")));
}

const one = (store, subject, predicate) => store.getObjects(subject, predicate, null)[0];
const all = (store, subject, predicate) => store.getObjects(subject, predicate, null);
const byValue = (a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

/** Reads what the catalog needs of one RiverBench dataset */
function readDataset(store, iri, id) {
    const subject = namedNode(iri);
    const dct = (name) => NS.dct + name;
    const dataset = {
        id,
        iri,
        title: one(store, subject, dct("title")),
        description: one(store, subject, dct("description")),
        issued: one(store, subject, dct("issued")),
        language: one(store, subject, dct("language")),
        license: one(store, subject, dct("license")),
        landingPage: one(store, subject, NS.dcat + "landingPage"),
        temporalResolution: one(store, subject, NS.dcat + "temporalResolution"),
        themes: all(store, subject, NS.dcat + "theme").sort(byValue),
        elementCount: one(store, subject, NS.rb + "hasStreamElementCount"),
        creators: all(store, subject, dct("creator"))
            .map((creator) => ({
                name: one(store, creator, NS.foaf + "name"),
                homepages: all(store, creator, NS.foaf + "homepage").sort(byValue),
            }))
            .sort((a, b) => byValue(a.name ?? { value: "" }, b.name ?? { value: "" })),
        streamTypes: all(store, subject, NS.stax + "hasStreamTypeUsage")
            .flatMap((usage) => all(store, usage, NS.stax + "hasStreamType"))
            .map((term) => term.value.replace(NS.stax, "stax:"))
            .sort(),
        split: all(store, subject, NS.rb + "hasStreamElementSplit")
            .map((split) => one(store, split, NS.rdfs + "comment")?.value)
            .filter(Boolean)
            .sort(),
    };
    for (const required of ["title", "description", "license", "elementCount"]) {
        if (!dataset[required]) throw new Error(`${iri} has no ${required}`);
    }
    dataset.distribution = readDistribution(store, subject, DISTRIBUTION_ID);
    return dataset;
}

/** Reads the RiverBench distribution of a dataset with this dct:identifier, if there is one */
function readDistribution(store, subject, identifier) {
    const distribution = all(store, subject, NS.dcat + "distribution").find(
        (d) => one(store, d, NS.dct + "identifier")?.value === identifier,
    );
    if (!distribution) return undefined;
    return {
        iri: distribution.value,
        downloadURL: one(store, distribution, NS.dcat + "downloadURL").value,
        byteSize: Number(one(store, distribution, NS.dcat + "byteSize").value),
        elementCount: Number(one(store, distribution, NS.rb + "hasStreamElementCount").value),
        streamTypes: all(store, distribution, NS.stax + "hasStreamTypeUsage")
            .flatMap((usage) => all(store, usage, NS.stax + "hasStreamType"))
            .map((term) => term.value.replace(NS.stax, "stax:"))
            .sort(),
        fileName: one(store, distribution, NS.rb + "hasFileName")?.value,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Verification against the Jelly file

const ONLY_IRI = (terms, what, index) => {
    const unique = [...new Map(terms.map((term) => [term.termType + term.value, term])).values()];
    if (unique.length !== 1 || unique[0].termType !== "NamedNode") {
        throw new Error(`message ${index}: expected exactly one IRI as ${what}, found ${unique.length}`);
    }
    return unique[0].value;
};

function memberId(member, quads, index) {
    switch (member.kind) {
        case "graph":
            return ONLY_IRI(
                quads.map((q) => q.graph).filter((graph) => graph.termType !== "DefaultGraph"),
                "named graph",
                index,
            );
        case "type":
            return ONLY_IRI(
                quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === member.term).map((q) => q.subject),
                `subject of type ${member.term}`,
                index,
            );
        case "path":
            return ONLY_IRI(
                quads.filter((q) => q.predicate.value === member.term).map((q) => q.subject),
                `subject with ${member.term}`,
                index,
            );
        case "self":
            return ONLY_IRI(
                quads.map((q) => q.subject),
                "subject",
                index,
            );
    }
}

/** Nanoseconds since the epoch of an xsd:dateTime without timezone (read as UTC: only used to compare them) */
function dateTimeToNanos(value) {
    const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?$/.exec(value);
    if (!match) throw new Error(`Only timestamps without timezone are supported here, found ${value}`);
    const seconds = BigInt(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]) / 1000);
    const fraction = (match[7] ?? "").padEnd(9, "0").slice(0, 9);
    return { nanos: seconds * 1_000_000_000n + BigInt(fraction), digits: (match[7] ?? "").length };
}

/** The first moment after a timestamp that is one unit of its last digit later: an exclusive upper bound */
function nextTimestamp(value) {
    const { nanos, digits } = dateTimeToNanos(value);
    const next = nanos + 10n ** BigInt(9 - Math.min(digits, 9));
    const iso = new Date(Number(next / 1_000_000_000n) * 1000).toISOString().slice(0, 19);
    const fraction = (next % 1_000_000_000n).toString().padStart(9, "0").slice(0, digits);
    return iso + (digits ? "." + fraction : "");
}

function checkShape(shape, id, quads, index) {
    for (const property of shape ?? []) {
        const values = quads.filter((q) => q.subject.value === id && q.predicate.value === property.path).map((q) => q.object);
        const distinct = new Set(values.map((term) => term.termType + term.value));
        if (property.minCount !== undefined && distinct.size < property.minCount) {
            throw new Error(`message ${index}: ${id} has too few values for ${property.path}`);
        }
        if (property.maxCount !== undefined && distinct.size > property.maxCount) {
            throw new Error(`message ${index}: ${id} has too many values for ${property.path}`);
        }
        if (property.datatype && values.some((term) => term.termType !== "Literal" || term.datatype.value !== property.datatype)) {
            throw new Error(`message ${index}: ${property.path} of ${id} is not an ${property.datatype}`);
        }
        if (property.hasValue && !values.some((term) => term.value === property.hasValue)) {
            throw new Error(`message ${index}: ${id} lacks the value ${property.hasValue} for ${property.path}`);
        }
    }
}

/** Reads the whole Jelly file as a log of messages (one Jelly frame is one message) and checks the description */
async function verify(dataset, config) {
    const { distribution } = dataset;
    const body = await cached(distribution.downloadURL, undefined, `${dataset.id}.${distribution.fileName}`);
    if (body.length !== distribution.byteSize) {
        throw new Error(`${dataset.id}: ${body.length} bytes downloaded, RiverBench states ${distribution.byteSize}`);
    }
    const bytes = body[0] === 0x1f && body[1] === 0x8b ? zlib.gunzipSync(body) : body;
    const messages = new JellyParser().parseMessages(bytes);
    if (messages.length !== distribution.elementCount) {
        throw new Error(`${dataset.id}: ${messages.length} messages, RiverBench states ${distribution.elementCount} elements`);
    }
    const ids = new Set();
    let first, last;
    messages.forEach((quads, index) => {
        if (quads.length === 0) throw new Error(`message ${index} is empty`);
        const id = memberId(config.rule, quads, index);
        if (ids.has(id)) throw new Error(`${dataset.id}: the member identifier ${id} occurs twice (message ${index})`);
        ids.add(id);
        checkShape(config.shape, id, quads, index);
        if (config.timestampPath) {
            const [timestamp] = quads.filter((q) => q.subject.value === id && q.predicate.value === config.timestampPath);
            const value = timestamp.object.value;
            if (first === undefined) first = value;
            else if (dateTimeToNanos(value).nanos < dateTimeToNanos(last).nanos) {
                throw new Error(`${dataset.id}: message ${index} has timestamp ${value} before ${last}`);
            }
            last = value;
        }
    });
    return { count: messages.length, ids: ids.size, timeFrom: first, timeUntil: last && nextTimestamp(last) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing

const PREFIX_ORDER = Object.keys(NS);
const turtleString = (value) => JSON.stringify(value);
const number = (n) => n.toLocaleString("en-US").replace(/,/g, " ");
const megabytes = (bytes) => (bytes < 1e6 ? `${Math.round(bytes / 1e3)} KB` : `${(bytes / 1e6).toFixed(1)} MB`);
const rootUrl = (id) => `${SITE}${id}/root.trig`;
const ldesIri = (id) => `${rootUrl(id)}#EventStream`;

class Turtle {
    constructor(...prefixes) {
        this.used = new Set(prefixes);
    }
    iri(iri) {
        for (const prefix of PREFIX_ORDER) {
            const base = NS[prefix];
            if (iri.startsWith(base) && /^[A-Za-z0-9_]+$/.test(iri.slice(base.length))) {
                this.used.add(prefix);
                return prefix + ":" + iri.slice(base.length);
            }
        }
        return `<${iri}>`;
    }
    term(term) {
        if (term.termType === "NamedNode") return this.iri(term.value);
        if (term.termType === "Literal") {
            if (term.language) return `${turtleString(term.value)}@${term.language}`;
            if (term.datatype.value === NS.xsd + "string") return turtleString(term.value);
            return `${turtleString(term.value)}^^${this.iri(term.datatype.value)}`;
        }
        throw new Error("unexpected term " + term.termType);
    }
    typed(value, datatype) {
        return `${turtleString(value)}^^${this.iri(NS.xsd + datatype)}`;
    }
    prefixes() {
        return [...this.used].sort()
            .map((prefix) => `@prefix ${prefix}: <${NS[prefix]}> .`)
            .join("\n");
    }
}

/** Wraps a text as comment lines: the first line starts with `first`, the other lines with `rest` */
function wrap(text, first, rest = first, width = 118) {
    const lines = [];
    let line = first;
    let empty = true;
    for (const word of text.split(/\s+/)) {
        if (!empty && line.length + word.length + 1 > width) {
            lines.push(line);
            line = rest;
            empty = true;
        }
        line += (empty && line.endsWith(" ") ? "" : " ") + word;
        empty = false;
    }
    lines.push(line);
    return lines.join("\n");
}

function memberTriple(t, member) {
    switch (member.kind) {
        case "graph":
            return "ldes:memberGraph true";
        case "type":
            return `ldes:memberType ${t.iri(member.term)}`;
        case "path":
            return `ldes:memberPath ${t.iri(member.term)}`;
        case "self":
            return `ldes:memberPath [ sh:zeroOrMorePath ${t.iri(RDF_TYPE)} ]`;
    }
}

/** The blocks that describe the event stream and its member shape, the same in every root page of a dataset */
function streamBlocks(t, config) {
    const body = [];
    const streamProperties = [memberTriple(t, config.rule)];
    if (config.timestampPath) streamProperties.push(`ldes:timestampPath ${t.iri(config.timestampPath)}`);
    if (config.shape) streamProperties.push("ldes:shape <#MemberShape>");
    body.push(`# The LDES: the IRI of this event stream is the root page, with a different fragment identifier
<#EventStream> a ldes:EventStream ;
    ${streamProperties.join(" ;\n    ")} .`);
    if (config.shape) {
        const properties = config.shape.map((property) => {
            const parts = [`sh:path ${t.iri(property.path)}`];
            if (property.datatype) parts.push(`sh:datatype ${t.iri(property.datatype)}`);
            if (property.hasValue) parts.push(`sh:hasValue ${t.iri(property.hasValue)}`);
            if (property.minCount !== undefined) parts.push(`sh:minCount ${property.minCount}`);
            if (property.maxCount !== undefined) parts.push(`sh:maxCount ${property.maxCount}`);
            return `    sh:property [\n        ${parts.join(" ;\n        ")}\n    ]`;
        });
        body.push(`# The focus node of this shape is the member identifier
<#MemberShape> a sh:NodeShape ;
${properties.join(" ;\n")} .`);
    }
    return body;
}

function rootPage(dataset, config, checked) {
    const { distribution } = dataset;
    const page = `<${distribution.downloadURL}>`;
    const t = new Turtle("ldes", "sh");
    const body = streamBlocks(t, config);
    if (config.timestampPath) {
        body.push(`# The root page itself. It has a relation to the page with all the members of this LDES.
# The interval is that of the first and last timestamp in the file (the upper bound is exclusive).
<> ldes:relation [
    ldes:page ${page} ;
    ldes:timeFrom ${t.typed(checked.timeFrom, "dateTime")} ;
    ldes:timeUntil ${t.typed(checked.timeUntil, "dateTime")}
] .`);
    } else {
        body.push(`# The root page itself. It has a relation to the page with all the members of this LDES.
# The elements have no timestamp to order on, so the order is that of the pages and of the members in them (implicit order):
# this is page number 0, and its members are in the order of the file.
<> ldes:relation [
    ldes:page ${page} ;
    ldes:pageNumber 0
] .`);
    }
    body.push(`# A page can be marked immutable by the page that links to it, before it is fetched.
# This is stated about the linked page, not about the relation.
${page} ldes:immutable true .`);

    const title = dataset.title.value;
    const header = [
        `# The root page of a sample LDES 2.0: the first ${number(distribution.elementCount)} elements of the RiverBench dataset "${title}"`,
        `# (${dataset.iri}).`,
        "#",
        wrap(
            "RiverBench (https://w3id.org/riverbench) publishes benchmark datasets of RDF streams, in Jelly-RDF among others. " +
                config.element +
                ` The Jelly file that RiverBench hosts (${megabytes(distribution.byteSize)}, ${number(distribution.elementCount)} stream elements, ` +
                `stream types ${distribution.streamTypes.join(", ")}) is the one page of this LDES. It has no description message, so ` +
                "every message in the file is a member message: one Jelly frame is one member.",
            "#",
        ),
        ...(config.sample ? ["#", "# A message looks like this (here in TriG):", "#", ...config.sample.map((line) => "#" + line)] : []),
        "#",
        "# How this maps to LDES (everything RiverBench says about the dataset itself is in ../catalog.ttl):",
        wrap(`* membership: ${config.memberText}`, "#  ", "#    "),
        wrap(`* ordering: ${config.order}`, "#  ", "#    "),
        ...(config.timestampPath || config.timestampNote
            ? [
                  wrap(
                      "These xsd:dateTime values have no timezone. A client then compares them as if they were in the same, unknown, " +
                          "timezone, which is exact within this LDES. The timezone is not stated by RiverBench, so no ldes:defaultTimezone " +
                          'is claimed here. If it is known, e.g. "+01:00", add it to the LDES for clients that mix these timestamps with ' +
                          "timestamps that have a timezone.",
                      "#    ",
                  ),
              ]
            : []),
        ...(config.shape ? [wrap("* ldes:shape: the shape that every member conforms to (checked on all members by the generator).", "#  ", "#    ")] : []),
        wrap("* ldes:immutable: the Jelly file never changes, so a client that has read it does not fetch it again.", "#  ", "#    "),
        wrap(
            `* the file has ${number(checked.count)} messages and ${number(checked.ids)} distinct member identifiers, as RiverBench states ` +
                "(rb:hasStreamElementCount). This was checked when this file was generated.",
            "#  ",
            "#    ",
        ),
        "#",
        `# Try it:  npx ldes-client ${rootUrl(dataset.id)}`,
        "# Generated by scripts/generate-riverbench.mjs of the ldes.tech repository; do not edit by hand.",
        "#",
    ].join("\n");
    return `${header}\n${t.prefixes()}\n\n${body.join("\n\n")}\n`;
}

function datasetTriples(t, dataset, ldes) {
    const lines = [];
    const add = (predicate, object) => lines.push(`    ${predicate} ${object}`);
    add("a", "dcat:Dataset");
    add("dct:title", t.term(dataset.title));
    add("dct:description", t.term(dataset.description));
    for (const creator of dataset.creators) {
        const parts = [];
        if (creator.name) parts.push(`foaf:name ${t.term(creator.name)}`);
        if (creator.homepages.length) parts.push(`foaf:homepage ${creator.homepages.map((h) => t.term(h)).join(", ")}`);
        add("dct:creator", `[ ${parts.join(" ; ")} ]`);
    }
    add("dct:license", t.term(dataset.license));
    if (dataset.issued) add("dct:issued", t.term(dataset.issued));
    if (dataset.language) add("dct:language", t.term(dataset.language));
    if (dataset.landingPage) add("dcat:landingPage", t.term(dataset.landingPage));
    if (dataset.themes.length) add("dcat:theme", dataset.themes.map((theme) => t.term(theme)).join(" , "));
    if (dataset.temporalResolution) add("dcat:temporalResolution", t.term(dataset.temporalResolution));
    add("rb:hasStreamElementCount", t.term(dataset.elementCount));
    const distributions = [];
    if (ldes) distributions.push(`<${ldesIri(dataset.id)}>`);
    if (distributions.length) add("dcat:distribution", distributions.join(" , "));
    return `<${dataset.iri}>\n${lines.join(" ;\n")} .`;
}

function catalogTurtle(datasets, rootCatalog) {
    const t = new Turtle("dcat", "dct", "foaf", "ldes", "prov", "rb");
    const blocks = [];
    const included = datasets.filter((d) => d.ldes);
    blocks.push(`<${SITE}> a dcat:Catalog ;
    dct:title "RiverBench datasets as LDES 2.0"@en ;
    dct:description ${turtleString(
        "A catalog of the datasets of RiverBench (https://w3id.org/riverbench), an open RDF streaming benchmark suite. " +
            `${included.length} of its ${datasets.length} datasets are described as an LDES 2.0 (a distribution of the dataset) ` +
            "that links to the Jelly-RDF file that RiverBench hosts.",
    )}@en ;
    dct:license <https://spdx.org/licenses/CC-BY-4.0> ;
    dct:rights "The metadata of the datasets is derived from the metadata of RiverBench, which is licensed under CC BY 4.0. The datasets are licensed under their own license."@en ;
    prov:wasDerivedFrom <${rootCatalog}> ;
    foaf:homepage <${SITE}> ;
    dcat:dataset ${datasets.map((d) => `<${d.iri}>`).join(" ,\n                 ")} .`);
    for (const dataset of datasets) {
        const comment = dataset.ldes ? "" : wrap(`No LDES for this dataset: ${dataset.withoutReason}`, "#") + "\n";
        blocks.push(comment + datasetTriples(t, dataset, dataset.ldes));
        if (dataset.ldes) {
            const { distribution } = dataset;
            const stream = ldesIri(dataset.id);
            blocks.push(`# The IRI of the LDES is the entry point that a client is given
<${stream}> a ldes:EventStream ;
    dct:title ${turtleString(`${dataset.title.value} as an LDES: the first ${number(distribution.elementCount)} elements, in Jelly-RDF`)}@en ;
    dct:license ${t.term(dataset.license)} ;
    dcat:accessURL <${rootUrl(dataset.id)}> ;
    # This LDES is a view on the RiverBench Jelly distribution with 10K elements (${megabytes(distribution.byteSize)})
    prov:wasDerivedFrom <${distribution.iri}> ;
    rb:hasStreamElementCount ${distribution.elementCount} .`);
        }
    }
    const header = `# A DCAT catalog of the datasets of RiverBench (${rootCatalog}), with the LDES 2.0 that ldes.tech hosts for most of them.
# An ldes:EventStream is a dcat:Distribution of a dcat:Dataset. This description is only used in the catalog:
# the pages of an LDES only use LDES terms, as the IRI of the LDES dereferences to the root page.
# Generated by scripts/generate-riverbench.mjs; do not edit by hand.`;
    return `${header}\n${t.prefixes()}\n\n${blocks.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The human-readable page

const escapeHtml = (text) =>
    text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/\{/g, "&#123;")
        .replace(/\}/g, "&#125;");

/** The first paragraph of a RiverBench description, with its Markdown links as HTML */
function firstParagraphHtml(markdown) {
    const paragraph = markdown.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ");
    return escapeHtml(paragraph).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

const licenseName = (license) => license.value.replace(/^https?:\/\/spdx\.org\/licenses\//, "");

function datasetHtml(dataset) {
    const rb = dataset.iri;
    const license = `<a href="${escapeHtml(dataset.license.value)}" property="dct:license" resource="${escapeHtml(dataset.license.value)}">${escapeHtml(licenseName(dataset.license))}</a>`;
    const head = `        <h3 property="dct:title"><a href="${rb}">${escapeHtml(dataset.title.value)}</a></h3>
        <p property="dct:description" content="${escapeHtml(dataset.description.value.replace(/\s+/g, " ").trim())}">${firstParagraphHtml(dataset.description.value)}</p>`;
    if (!dataset.ldes) {
        return `      <li property="dcat:dataset" typeof="dcat:Dataset" resource="${rb}">
${head}
        <p class="meta">License: ${license}. ${escapeHtml(number(Number(dataset.elementCount.value)))} stream elements in the full dataset.</p>
        <p class="example-evidence"><strong>No LDES:</strong> ${escapeHtml(dataset.withoutReason)}
          <a href="${rb}">RiverBench dataset page</a>.</p>
      </li>`;
    }
    const { distribution } = dataset;
    const url = rootUrl(dataset.id);
    const order = dataset.ldes.timestampPath
        ? `ordered on the timestamp <code>${escapeHtml(dataset.ldes.timestampPath.replace(NS.prov, "prov:").replace(NS.saref, "saref:"))}</code>, from <code>${escapeHtml(dataset.checked.timeFrom)}</code> until <code>${escapeHtml(dataset.checked.timeUntil)}</code> (exclusive)`
        : "in the order of the file (implicit order: there is no timestamp to order on)";
    return `      <li property="dcat:dataset" typeof="dcat:Dataset" resource="${rb}">
${head}
        <p class="meta">License: ${license}.
          ${escapeHtml(number(distribution.elementCount))} of ${escapeHtml(number(Number(dataset.elementCount.value)))} stream elements
          (${escapeHtml(megabytes(distribution.byteSize))} Jelly file, <code>${escapeHtml(distribution.fileName)}</code>),
          members ${order}.</p>
        <p property="dcat:distribution" typeof="dcat:Distribution" resource="${url}#EventStream">
          <code class="feed-url" property="dcat:accessURL" resource="${url}">${url}</code>
          <meta property="dct:title" content="${escapeHtml(dataset.title.value)} as an LDES"/>
        </p>
        <p class="example-evidence">Member: ${escapeHtml(dataset.ldes.memberShort)}
          <a href="${url}">root.trig</a> &middot; <a href="${rb}">RiverBench dataset page</a>.</p>
      </li>`;
}

function indexHtml(datasets) {
    const withLdes = datasets.filter((d) => d.ldes);
    const without = datasets.filter((d) => !d.ldes);
    const byTitle = (a, b) => a.title.value.localeCompare(b.title.value, "en");
    withLdes.sort(byTitle);
    without.sort(byTitle);
    return `---
title: RiverBench as LDES
description: >-
  LDES 2.0 descriptions of the datasets of RiverBench, the RDF streaming benchmark suite, hosted as static files
  on GitHub Pages.
permalink: /riverbench/
---
{% include header.html %}
{% include nav.html %}

{% comment %} Generated by scripts/generate-riverbench.mjs: do not edit by hand. {% endcomment %}
<main id="main-content" class="container">
  <section>
    <h1>RiverBench as LDES</h1>
    <p class="section-intro">
      <a href="https://w3id.org/riverbench/">RiverBench</a> is an open, community-driven benchmark suite of RDF streams.
      Here, ${withLdes.length} of its ${datasets.length} datasets are described as a Linked Data Event Stream (LDES) 2.0, so that you can replicate
      them with an LDES client.
    </p>
    <p>
      Every LDES is a small static root page (<code>root.trig</code>) on this website, hosted on GitHub Pages.
      Its one page is the <a href="https://jelly-rdf.github.io/">Jelly-RDF</a> file with the first 10 000 elements of the dataset, which
      RiverBench itself hosts: this website does not copy any data. In every Jelly file, one message is one member of the LDES.
      The <a href="{{ '/riverbench/catalog.ttl' | relative_url }}">catalog</a> (<code>catalog.ttl</code>, DCAT) lists the datasets with their
      metadata from RiverBench, and every LDES as a distribution of its dataset.
      The files are generated by <code>scripts/generate-riverbench.mjs</code>, which also checks every description against the data.
    </p>
  </section>

  <section aria-labelledby="riverbench-ldes">
    <h2 id="riverbench-ldes">Datasets with an LDES</h2>
    <ul class="example-list" typeof="dcat:Catalog" resource="${SITE}">
      <meta property="dct:title" content="RiverBench datasets as LDES 2.0"/>
${withLdes.map(datasetHtml).join("\n")}
    </ul>
  </section>

  <section aria-labelledby="riverbench-without">
    <h2 id="riverbench-without">Datasets without an LDES</h2>
    <p>These datasets are in the catalog, but could not be described faithfully as an LDES 2.0.</p>
    <ul class="example-list" typeof="dcat:Catalog" resource="${SITE}">
${without.map(datasetHtml).join("\n")}
    </ul>
  </section>

  <section aria-labelledby="riverbench-consume">
    <h2 id="riverbench-consume">Consume them</h2>
    <p>With the <a href="https://github.com/KNowledgeOnWebScale/ldes-client">ldes-client</a>, give it the URL of a root page:</p>
    <pre><code>npx ldes-client ${SITE}assist-iot-weather-graphs/root.trig</code></pre>
    <p>
      The client prints one RDF message per member. Add <code>--comment</code> to see what the LDES says about every member.
      Support for LDES 2.0 in the client is <strong>experimental</strong>: it follows the evolving
      <a href="https://github.com/SEMICeu/LinkedDataEventStreams/pull/116">LDES 2.0 proposal</a>, and the terms and behavior used here may change.
      The descriptions on this page change with it.
    </p>
  </section>

</main>

{% include footer.html %}
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Main

async function main() {
    const catalogStore = parseTurtle(await cached(CATALOG_URL, "text/turtle", "catalog.ttl"));
    const rootCatalog = catalogStore.getSubjects(RDF_TYPE, NS.dcat + "Catalog", null)[0].value;
    const iris = catalogStore.getObjects(rootCatalog, NS.dcat + "dataset", null).map((term) => term.value).sort();
    if (iris.length === 0) throw new Error("The catalog of RiverBench lists no datasets");

    const datasets = [];
    for (const iri of iris) {
        const id = /\/datasets\/([^/]+)\//.exec(iri)?.[1];
        if (!id) throw new Error("Unexpected dataset IRI " + iri);
        const store = parseTurtle(await cached(iri, "text/turtle", `${id}.ttl`));
        const dataset = readDataset(store, iri, id);
        const config = DATASETS[id];
        if (config && !WITHOUT_LDES[id]) {
            if (!dataset.distribution) throw new Error(`${id} has no distribution ${DISTRIBUTION_ID}`);
            if (dataset.distribution.byteSize > MAX_PAGE_BYTES) {
                dataset.withoutReason = `The Jelly file with 10K elements is ${megabytes(dataset.distribution.byteSize)}: too large to read in a browser.`;
            } else {
                dataset.ldes = config;
                dataset.checked = await verify(dataset, config);
                console.log(`${id}: ${dataset.checked.count} members verified`);
            }
        } else if (WITHOUT_LDES[id]) {
            dataset.withoutReason = WITHOUT_LDES[id];
            if (id === "dbpedia-live" && dataset.distribution) {
                dataset.withoutReason = `The smallest Jelly distribution that RiverBench offers for this dataset (10K elements) is ${megabytes(dataset.distribution.byteSize)}: too large to read in a browser.`;
            }
        } else {
            throw new Error(`${id} is new in RiverBench: decide in DATASETS or WITHOUT_LDES how to describe it`);
        }
        datasets.push(dataset);
    }

    for (const dataset of datasets.filter((d) => d.ldes)) {
        const dir = path.join(OUT, dataset.id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "root.trig"), rootPage(dataset, dataset.ldes, dataset.checked));
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "catalog.ttl"), catalogTurtle(datasets, rootCatalog));
    fs.writeFileSync(path.join(OUT, "index.html"), indexHtml(datasets));
    console.log(`Written to ${OUT}`);
}

await main();
