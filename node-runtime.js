// node-runtime.js — single source of truth for the Node-side bootstrap.
//
// Stamps `global.window` / `global.document` shims, then loads the same
// dual-mode and IIFE-style files the browser does (sel-key, graph,
// engine, graph-io, nodes, optionally flow-propagation), and returns
// every resulting global object the callers consume.
//
// Replaces the ~25-line shim block previously copy-pasted across
// validate.js, the precompute scripts, and the tests/. Knobs:
//
//   flowPropagation   load flow-propagation.js (default true; some
//                     module-audit tests don't need it).
//   richDocument      give `document` createElement + body stubs that
//                     `nodes.js` exercises on a few code paths
//                     (currently only tests/evaluate.js).
//   strictTruncation  call GraphIO.setStrictTruncation(true) (used by
//                     validate.js; off by default).
//   withOutcomes      read data/outcomes.json and register templates
//                     with GraphIO (default true).
//
// Returns: { Graph, Engine, GraphIO, Nodes, FlowPropagation,
//            NODES, NODE_MAP, FLOW_DAG, TEMPLATES, ROOT }.
// Callers can ignore fields they don't use; nothing is lazy.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function _ensureShim(richDocument) {
    if (!global.window) {
        global.window = {
            requestAnimationFrame: () => 0,
            addEventListener: () => {},
            location: { search: '', hash: '' },
        };
    }
    if (!global.document) {
        const doc = {
            addEventListener: () => {},
            readyState: 'complete',
            getElementById: () => null,
            querySelector: () => null,
        };
        if (richDocument) {
            doc.createElement = () => ({
                style: {},
                classList: { add: () => {}, remove: () => {} },
                appendChild: () => {},
            });
            doc.body = { appendChild: () => {} };
        }
        global.document = doc;
    } else if (richDocument && !global.document.createElement) {
        global.document.createElement = () => ({
            style: {},
            classList: { add: () => {}, remove: () => {} },
            appendChild: () => {},
        });
        global.document.body = global.document.body || { appendChild: () => {} };
    }
}

function loadNodeRuntime(opts = {}) {
    const {
        flowPropagation = true,
        richDocument = false,
        strictTruncation = false,
        withOutcomes = true,
    } = opts;

    _ensureShim(richDocument);

    require('./sel-key');
    const Graph = require('./graph.js');
    global.window.Graph = Graph;
    const Engine = require('./engine.js');
    global.window.Engine = Engine;
    new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
    new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
    if (flowPropagation) {
        new Function('window', fs.readFileSync(path.join(ROOT, 'flow-propagation.js'), 'utf8'))(global.window);
    }

    const GraphIO = global.window.GraphIO;
    if (strictTruncation && GraphIO && GraphIO.setStrictTruncation) {
        GraphIO.setStrictTruncation(true);
    }

    const Nodes = global.window.Nodes;
    const FlowPropagation = global.window.FlowPropagation;

    const NODES = (Engine && Engine.NODES) || (Graph && Graph.NODES) || [];
    const NODE_MAP = {};
    for (const n of NODES) NODE_MAP[n.id] = n;
    const FLOW_DAG = Nodes && Nodes.FLOW_DAG;

    let TEMPLATES = null;
    if (withOutcomes) {
        const outcomesData = JSON.parse(
            fs.readFileSync(path.join(ROOT, 'data', 'outcomes.json'), 'utf8'),
        );
        TEMPLATES = outcomesData.templates;
        if (GraphIO && GraphIO.registerOutcomes) GraphIO.registerOutcomes(TEMPLATES);
    }

    return {
        Graph, Engine, GraphIO, Nodes, FlowPropagation,
        NODES, NODE_MAP, FLOW_DAG, TEMPLATES,
        ROOT,
    };
}

module.exports = { loadNodeRuntime, ROOT };
