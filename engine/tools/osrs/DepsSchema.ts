/**
 * Dependency map schema for the OSRS → 377 import pipeline.
 *
 * A `DepsMap` records the full transitive dependency graph rooted at a single
 * OSRS NPC (or a batch of NPCs when produced by `DependencyTracer.traceMany`).
 * Downstream pipeline stages (transform / pack / register) consume it to know
 * which cache files must come along with the NPC, and to flag any missing
 * references before they break the live client.
 *
 * Schema versioning: bump `DEPS_SCHEMA_VERSION` and update the migration note
 * in `DependencyTracer.serialize()` whenever the shape changes.
 */

/**
 * All asset kinds that may appear in a dependency graph.
 *
 * - `npc`         : NPC config (root, or reached via multinpc[]).
 * - `model`       : 3D model blob (archive 1).
 * - `anim`        : animation frame blob (archive 2 file).
 * - `anim-base`   : animation skeleton (AnimBase — separate OSRS index,
 *                   same byte layout as 377 for pre-HD content).
 * - `seq`         : sequence config (seq.dat entry — references anims + base).
 * - `obj`         : item config (obj.dat entry — e.g. the TD's fire shield).
 * - `param`       : param type (param.dat entry — defines what its values
 *                   reference).
 * - `struct`      : struct config (often used for combat-script sub-tables).
 * - `script`      : runescript (content/scripts/npc/scripts/*.rs2). IDs are
 *                   script-name strings, not numeric cache indices.
 * - `texture`     : texture image (archive 1 in OSRS, named PNG in 377).
 * - `particle`    : OSRS particle system (referenced by obj/npc params).
 * - `sound`       : synth/midi sound effect.
 */
export type NodeKind =
    | 'npc'
    | 'model'
    | 'anim'
    | 'anim-base'
    | 'seq'
    | 'obj'
    | 'param'
    | 'struct'
    | 'script'
    | 'texture'
    | 'particle'
    | 'sound';

/**
 * Where a node's bytes/config originate. The dep tracer only ever emits
 * `'osrs'` for nodes it discovers in the OSRS cache; `'legacy377'` is set by
 * downstream stages (task 8 content-folder writer) when they generate the
 * 377-transformed twin of an OSRS node.
 */
export type NodeSource = 'osrs' | 'legacy377';

/**
 * A reference from one node to another. Always appears inside a parent
 * node's `deps[]` array.
 *
 * - `kind` + `id` identify the child node. `id` is numeric for cache-indexed
 *   assets and string for scripts (whose "id" is their debugname).
 * - `via` is a free-form annotation describing how the parent references the
 *   child — e.g. `'readyanim'`, `'models[0]'`, `'param:attack_anim'`,
 *   `'seq:frames[2]'`. Used for human-readable dep maps and for diagnostics.
 * - `missing` is `true` when the child asset couldn't be located in the
 *   source cache. The tracer still emits the ref so the importer knows it
 *   was expected; the same ref also appears in the top-level `missing[]`
 *   array for O(1) importer flagging.
 */
export interface DepRef {
    kind: NodeKind;
    id: number | string;
    via?: string;
    missing?: boolean;
}

/**
 * A single node in the dependency graph.
 *
 * - `key()` (helper) returns the canonical map key `${kind}:${id}`.
 * - `name` is the asset's debugname if known (from pack files or
 *   `debugname` field on decoded configs). `null` when unknown.
 * - `transformedFrom` is the OSRS id of the original asset, set ONLY when
 *   `source === 'legacy377'` and this node is the 377-transformed twin of
 *   an OSRS original. `null` for OSRS-native nodes (the common case in the
 *   dep tracer output).
 * - `cycle` is `true` when the tracer re-encountered this node mid-walk
 *   (i.e. it is part of a cycle). Such nodes are NOT recursed into again;
 *   the cycle itself is also recorded in `DepsMap.cycles`.
 * - `missing` is `true` when the node itself couldn't be loaded. Missing
 *   nodes have an empty `deps[]` array (since we couldn't introspect them).
 * - `skins` (model nodes only): `true` if the OSRS model has non-empty
 *   `triangleSkin` or `vertexSkin` arrays. Such models lose rig-skinning
 *   data when transformed to 377 — the pilot should prefer models with
 *   `skins === false` when alternatives exist. See task 5-a worklog entry.
 * - `note` is a free-form annotation string for things like
 *   `'TODO: deep obj walk not implemented'` so downstream stages know which
 *   nodes were intentionally treated as leaves.
 * - `deps[]` is the list of outgoing edges. Duplicates are removed by the
 *   tracer; ordering is deterministic (insertion order).
 */
export interface DepNode {
    kind: NodeKind;
    id: number | string;
    name: string | null;
    source: NodeSource;
    transformedFrom: number | string | null;
    cycle?: boolean;
    missing?: boolean;
    skins?: boolean;
    note?: string;
    deps: DepRef[];
}

/**
 * Cycle record. `path` is the list of node keys from the walk root down to
 * and including the re-entered node (so the cycle is `path[last] → path[i]`
 * for some `i` — that `i` is what `reentry` records).
 */
export interface DepCycle {
    path: string[];
    reentry: string;
}

/**
 * Root reference. Always points at an NPC for the dep tracer; the kind
 * field is kept for forward-compat (e.g. if a future stage wants to root
 * a graph at an obj for item-import pilots).
 */
export interface DepRoot {
    kind: NodeKind;
    id: number | string;
    name: string | null;
}

/**
 * The top-level dependency map. Serialized verbatim to `deps.json`.
 *
 * - `version` mirrors `DEPS_SCHEMA_VERSION` from this module. Bump on
 *   breaking shape changes.
 * - `root` is the primary walk root. For `traceMany()` output, the first
 *   NPC is the root and any additional roots are listed in
 *   `secondaryRoots`.
 * - `secondaryRoots` is omitted for single-NPC traces.
 * - `nodes` is a flat map keyed by `${kind}:${id}` for O(1) lookup. The
 *   root node is also present in this map.
 * - `cycles` is a list of every cycle the tracer encountered. Empty for
 *   well-formed NPC configs (cycles are rare but possible via param
 *   cross-references).
 * - `missing` is a flat list of every `DepRef` whose target couldn't be
 *   loaded from the source cache. Each entry also appears inside its
 *   parent node's `deps[]` for context.
 */
export interface DepsMap {
    version: 1;
    root: DepRoot;
    secondaryRoots?: DepRef[];
    nodes: Record<string, DepNode>;
    cycles: DepCycle[];
    missing: DepRef[];
}

/** Schema version — bump on breaking shape changes. */
export const DEPS_SCHEMA_VERSION = 1 as const;

/**
 * Canonical map key for a node. Stable across runs and across
 * implementations — used as the `nodes` object key and as the cycle-path
 * element.
 */
export function nodeKey(kind: NodeKind, id: number | string): string {
    return `${kind}:${id}`;
}

/**
 * Returns `true` if the given param type string (as returned by
 * `ParamType.getType()`) denotes a value that points at another asset
 * (vs. a primitive like int/string/boolean).
 *
 * Used by `walkParams()` to decide whether to emit a dep edge for a
 * param's value.
 */
export function isRefParamType(type: string): boolean {
    switch (type) {
        case 'seq':
        case 'obj':
        case 'npc':
        case 'struct':
        case 'spotanim':
        case 'inv':
        case 'synth':
        case 'midi':
        case 'enum':
            return true;
        default:
            return false;
    }
}

/**
 * Maps a param's type string to the dep-node `kind` it references.
 *
 * - 'seq' → 'seq' (sequence config = a set of anim frames)
 * - 'obj' → 'obj' (item config)
 * - 'npc' → 'npc'
 * - 'struct' → 'struct'
 * - 'spotanim' → 'particle' (spotanims in 377 are the closest thing to
 *   OSRS particle systems; the tracer records them as particle nodes so
 *   downstream stages can map them to whichever format the target client
 *   uses)
 * - 'inv' → 'struct' (inventories are config tables, treated as struct-like)
 * - 'synth' → 'sound'
 * - 'midi' → 'sound'
 * - 'enum' → 'struct' (enums are config tables)
 *
 * Returns `null` for primitive types (int/string/boolean/coord/category/
 * stat/varp/etc) — those don't produce dep edges.
 */
export function paramTypeToNodeKind(type: string): NodeKind | null {
    switch (type) {
        case 'seq':
            return 'seq';
        case 'obj':
            return 'obj';
        case 'npc':
            return 'npc';
        case 'struct':
            return 'struct';
        case 'spotanim':
            return 'particle';
        case 'inv':
        case 'enum':
            return 'struct';
        case 'synth':
        case 'midi':
            return 'sound';
        default:
            return null;
    }
}
