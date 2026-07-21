import fs from 'fs';
import path from 'path';

import Environment from '#/util/Environment.js';
import { printDebug, printWarning } from '#/util/Logger.js';
import AnimBase from '#/cache/graphics/AnimBase.js';
import OsrsModel from '#/cache/osrs/OsrsModel.js';
import OsrsAnimFrame from '#/cache/osrs/OsrsAnimFrame.js';
import OsrsSeqType from '#/cache/osrs/OsrsSeqType.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import StructType from '#/cache/config/StructType.js';
import { ParamMap } from '#/cache/config/ParamHelper.js';

import {
    DEPS_SCHEMA_VERSION,
    DepCycle,
    DepNode,
    DepRef,
    DepRoot,
    DepsMap,
    NodeKind,
    nodeKey,
    paramTypeToNodeKind
} from './DepsSchema.js';

/**
 * Abstract cache reader for the dependency tracer.
 *
 * The tracer never touches the raw cache bytes itself — all byte→object
 * decoding happens behind this interface. This lets the tracer be backed
 * by either:
 *   - a real OSRS cache port (Task 7 wires up an OSRS `CacheReader`
 *     implementation that reads from `engine/data/osrs-cache/`), or
 *   - a test stub that returns hand-crafted objects for unit tests.
 *
 * Every method returns `null` when the asset isn't present in the source
 * cache (the tracer records these as `missing: true` nodes). Implementations
 * MUST NOT throw on missing IDs — return `null` instead.
 *
 * Task 7 implementation note: the OSRS cache stores skeletons (AnimBase)
 * in a separate index from frames. The reader is responsible for loading
 * bases into `AnimBase.instances[]` BEFORE returning frames that reference
 * them, since `OsrsAnimFrame.decode()` requires the base to be present
 * (see task 5-b worklog entry).
 */
export interface CacheReader {
    /** OSRS model blob (archive 1). */
    readModel(id: number): OsrsModel | null;

    /** OSRS animation frame (archive 2 file). */
    readAnim(id: number): OsrsAnimFrame | null;

    /** OSRS animation skeleton (separate OSRS index; same byte layout as 377). */
    readAnimBase(id: number): AnimBase | null;

    /** OSRS sequence config (seq.dat entry). */
    readSeq(id: number): OsrsSeqType | null;

    /** OSRS NPC config (npc.dat entry). */
    readNpc(id: number): OsrsNpcType | null;

    /**
     * Item config. For now this returns the legacy `ObjType` because
     * `OsrsObjType` isn't ported yet — the dep tracer treats objs as
     * partial leaf nodes anyway (see `visitObj` for the TODO note).
     * Task 8+ should swap this to `OsrsObjType` once ported.
     */
    readObj(id: number): ObjType | null;

    /**
     * Param type. Returns the legacy `ParamType` if loaded; OSRS param
     * types aren't ported yet, so for OSRS-native params this will
     * typically return `null` (and the tracer logs a TODO).
     */
    readParam(id: number): ParamType | null;

    /** Struct config (often used for combat-script sub-tables). */
    readStruct(id: number): StructType | null;

    /** Texture image bytes (OSRS archive 1 / 377 named PNG). */
    readTexture(id: number): Uint8Array | null;

    /** OSRS particle system bytes (referenced by obj/npc params). */
    readParticle(id: number): Uint8Array | null;

    /** Sound effect bytes (synth or midi). */
    readSound(id: number): Uint8Array | null;

    /**
     * Optional debugname lookup. Returns the asset's pack-file name if
     * known, else `null`. Used to populate `DepNode.name` for human-readable
     * dep maps. Implementations may consult `content/pack/<kind>.pack`.
     */
    getName?(kind: NodeKind, id: number | string): string | null;
}

/**
 * Dependency tracer.
 *
 * Walks an OSRS NPC's full transitive dependency graph and records it as a
 * `DepsMap`. Designed for one-shot pipeline use (decode → trace → pack),
 * not for runtime client caching.
 *
 * Usage:
 *   const tracer = new DependencyTracer(reader);
 *   const deps = tracer.trace(9001);
 *   fs.writeFileSync('deps.json', tracer.serialize(deps));
 *
 * Cycle safety: the walker maintains a per-branch `path: Set<string>` of
 * node keys currently being visited. Re-entering a key already in `path`
 * records a `DepCycle` and skips recursion — guaranteeing termination
 * even on pathological param-cross-reference loops.
 *
 * Memoization: visited nodes are cached for the lifetime of the tracer
 * instance, so `traceMany()` over multiple NPCs shares work across NPCs
 * that depend on the same model/seq/etc.
 */
export class DependencyTracer {
    private readonly reader: CacheReader;
    private readonly scriptDir: string;

    // Per-tracer memoization state. Reset only by an explicit `reset()` call
    // (NOT by `trace()` — sharing across `trace()` calls is intentional for
    // `traceMany()`).
    private readonly nodes: Map<string, DepNode> = new Map();
    private readonly cycles: DepCycle[] = [];
    private readonly missing: DepRef[] = [];

    constructor(reader: CacheReader, opts?: { scriptDir?: string }) {
        this.reader = reader;
        this.scriptDir = opts?.scriptDir ?? `${Environment.BUILD_SRC_DIR}/scripts/npc/scripts`;
    }

    // ---- Public API ----

    /**
     * Walk the full dependency graph rooted at the given NPC.
     *
     * Returns a `DepsMap` whose `root` is the NPC and whose `nodes` map
     * contains every transitively-reached asset. The tracer's internal
     * memo is NOT reset — call `reset()` between independent traces if
     * you want a fresh map.
     */
    trace(npcId: number): DepsMap {
        const rootRef = this.visitNode('npc', npcId, new Set());
        const root = rootRef as DepRoot;
        // visitNode always returns a ref shape compatible with DepRoot for
        // npc kind (id + name); cast is safe here.
        return {
            version: DEPS_SCHEMA_VERSION,
            root: { kind: 'npc', id: root.id, name: root.name ?? null },
            nodes: this.serializeNodes(),
            cycles: [...this.cycles],
            missing: [...this.missing]
        };
    }

    /**
     * Batched trace over multiple NPCs. Merges results into a single
     * `DepsMap`: the first NPC becomes `root`, the rest are listed in
     * `secondaryRoots`. All nodes / cycles / missing arrays are merged.
     */
    traceMany(npcIds: number[]): DepsMap {
        if (npcIds.length === 0) {
            throw new Error('DependencyTracer.traceMany: npcIds must be non-empty');
        }

        const refs: DepRef[] = [];
        for (const id of npcIds) {
            refs.push(this.visitNode('npc', id, new Set()));
        }

        const primary = refs[0];
        const secondary = refs.slice(1).map(r => ({ kind: r.kind, id: r.id }));

        const root: DepRoot = {
            kind: 'npc',
            id: primary.id,
            name: primary.name ?? null
        };

        const map: DepsMap = {
            version: DEPS_SCHEMA_VERSION,
            root,
            nodes: this.serializeNodes(),
            cycles: [...this.cycles],
            missing: [...this.missing]
        };
        if (secondary.length > 0) {
            map.secondaryRoots = secondary;
        }
        return map;
    }

    /** Pretty-print a `DepsMap` to a JSON string (2-space indent, sorted keys). */
    serialize(deps: DepsMap): string {
        return JSON.stringify(deps, null, 2);
    }

    /** Parse a JSON string back into a `DepsMap`. Throws on invalid JSON. */
    deserialize(json: string): DepsMap {
        const parsed = JSON.parse(json) as DepsMap;
        if (parsed.version !== DEPS_SCHEMA_VERSION) {
            printWarning(
                `DepsMap version mismatch: file=${parsed.version}, code=${DEPS_SCHEMA_VERSION}. ` +
                'Downstream stages may misinterpret fields.'
            );
        }
        return parsed;
    }

    /** Clear all memoized state. Call between fully-independent traces. */
    reset(): void {
        this.nodes.clear();
        this.cycles.length = 0;
        this.missing.length = 0;
    }

    /**
     * Visit a single node, returning a `DepRef` that callers push into
     * their parent's `deps[]` array.
     *
     * This is the canonical walker entry point. It is public (despite the
     * task spec calling it "internal") so that the standalone `walkParams`
     * helper and future per-kind walkers (e.g. an `OsrsObjType` walker
     * added by task 8) can hook into the same cycle-detection + memoization
     * logic without duplicating it.
     *
     * @param kind asset kind
     * @param id numeric cache ID, or string for scripts
     * @param path set of node keys currently being walked (for cycle detection).
     *             Callers should pass a fresh `Set` at the top level and let
     *             the per-kind walkers clone-and-add when recursing.
     */
    visitNode(kind: NodeKind, id: number | string, path: Set<string>): DepRef {
        const key = nodeKey(kind, id);

        // Cycle check: if this key is already on the current walk path,
        // record the cycle and bail (do NOT recurse).
        if (path.has(key)) {
            this.cycles.push({
                path: [...path, key],
                reentry: key
            });
            const existing = this.nodes.get(key);
            return {
                kind,
                id,
                via: undefined,
                cycle: true,
                name: existing?.name ?? null
            };
        }

        // Memo check: if we've already fully walked this node, just return
        // a ref to it (don't re-walk — graph is static).
        if (this.nodes.has(key)) {
            const cached = this.nodes.get(key)!;
            return { kind: cached.kind, id: cached.id, name: cached.name };
        }

        // Fresh walk. Dispatch on kind.
        const nextPath = new Set(path);
        nextPath.add(key);

        let node: DepNode;
        switch (kind) {
            case 'npc':
                node = typeof id === 'number'
                    ? this.visitNpc(id, nextPath)
                    : this.missingNode(kind, id, 'npc id must be numeric');
                break;
            case 'model':
                node = typeof id === 'number'
                    ? this.visitModel(id, nextPath)
                    : this.missingNode(kind, id, 'model id must be numeric');
                break;
            case 'anim':
                node = typeof id === 'number'
                    ? this.visitAnim(id, nextPath)
                    : this.missingNode(kind, id, 'anim id must be numeric');
                break;
            case 'anim-base':
                node = typeof id === 'number'
                    ? this.visitAnimBase(id, nextPath)
                    : this.missingNode(kind, id, 'anim-base id must be numeric');
                break;
            case 'seq':
                node = typeof id === 'number'
                    ? this.visitSeq(id, nextPath)
                    : this.missingNode(kind, id, 'seq id must be numeric');
                break;
            case 'obj':
                node = typeof id === 'number'
                    ? this.visitObj(id, nextPath)
                    : this.missingNode(kind, id, 'obj id must be numeric');
                break;
            case 'param':
                node = typeof id === 'number'
                    ? this.visitParam(id, nextPath)
                    : this.missingNode(kind, id, 'param id must be numeric');
                break;
            case 'struct':
                node = typeof id === 'number'
                    ? this.visitStruct(id, nextPath)
                    : this.missingNode(kind, id, 'struct id must be numeric');
                break;
            case 'script':
                node = typeof id === 'string'
                    ? this.visitScript(id, nextPath)
                    : this.missingNode(kind, id, 'script id must be a string (script name)');
                break;
            case 'texture':
                node = typeof id === 'number'
                    ? this.visitTexture(id, nextPath)
                    : this.missingNode(kind, id, 'texture id must be numeric');
                break;
            case 'particle':
                node = typeof id === 'number'
                    ? this.visitParticle(id, nextPath)
                    : this.missingNode(kind, id, 'particle id must be numeric');
                break;
            case 'sound':
                node = typeof id === 'number'
                    ? this.visitSound(id, nextPath)
                    : this.missingNode(kind, id, 'sound id must be numeric');
                break;
            default:
                node = this.missingNode(kind, id, `unknown node kind: ${kind}`);
        }

        this.nodes.set(key, node);
        return { kind: node.kind, id: node.id, name: node.name };
    }

    /**
     * Walk a param map, pushing a `DepRef` for each param (and for each
     * param's value if the param's type indicates the value points at
     * another asset).
     *
     * The spec asked for a standalone `walkParams(params, tracer, deps)`
     * helper; it has been inlined as a tracer method so it can call
     * `visitNode` (which is private-state-aware) without exposing
     * internals. Functionally equivalent.
     */
    walkParams(params: ParamMap, deps: DepRef[], path: Set<string>): void {
        for (const [paramId, value] of params) {
            // The param itself is always a dep — the importer must bring
            // the param type definition along with the NPC config.
            const paramRef = this.visitNode('param', paramId, path);
            deps.push({ ...paramRef, via: `param:${paramId}` });

            // If the param's value is a ref-typed value, walk into it.
            if (typeof value !== 'number') {
                continue;
            }

            const paramType = this.lookupParamType(paramId);
            if (!paramType) {
                // Param type unknown (likely OSRS-native; OsrsParamType not yet
                // ported). Skip the value-walk and annotate the param node.
                const key = nodeKey('param', paramId);
                const node = this.nodes.get(key);
                if (node && !node.note) {
                    node.note = 'param type unknown — value not walked (OsrsParamType not ported)';
                }
                continue;
            }

            const valueKind = paramTypeToNodeKind(paramType.getType());
            if (!valueKind) {
                continue;
            }

            const debugname = paramType.debugname ?? paramId;
            const valueRef = this.visitNode(valueKind, value, path);
            deps.push({ ...valueRef, via: `param:${debugname}` });
        }
    }

    // ---- Per-kind walkers ----

    private visitNpc(id: number, path: Set<string>): DepNode {
        const npc = this.reader.readNpc(id);
        const name = npc?.name ?? this.lookupName('npc', id) ?? null;

        if (!npc) {
            return this.missingNode('npc', id, `npc ${id} not found in source cache`);
        }

        const deps: DepRef[] = [];
        const refs = npc.extractDependencyRefs();

        // Models (body set).
        refs.models.forEach((modelId, i) => {
            const ref = this.visitNode('model', modelId, path);
            deps.push({ ...ref, via: `models[${i}]` });
        });

        // Heads (head-icon render path; also archive-1 models).
        refs.heads.forEach((modelId, i) => {
            const ref = this.visitNode('model', modelId, path);
            deps.push({ ...ref, via: `heads[${i}]` });
        });

        // Anims — every seq reference on the NPC. The via tag is best-effort:
        // we look up which field the seq came from by re-reading the NPC.
        // For simplicity, we annotate with `anims[i]` and the field name if
        // we can determine it from the value.
        refs.anims.forEach((seqId, i) => {
            const ref = this.visitNode('seq', seqId, path);
            deps.push({ ...ref, via: `anims[${i}]:${this.npcAnimFieldName(npc, seqId)}` });
        });

        // Recolors — texture refs (when recol_s_tex/recol_d_tex are set).
        if (npc.recol_s_tex && npc.recol_d_tex) {
            for (let i = 0; i < npc.recol_s_tex.length; i++) {
                const sId = npc.recol_s_tex[i];
                const dId = npc.recol_d_tex[i];
                if (sId !== 0 && sId !== 65535) {
                    const ref = this.visitNode('texture', sId, path);
                    deps.push({ ...ref, via: `recol_s_tex[${i}]` });
                }
                if (dId !== 0 && dId !== 65535) {
                    const ref = this.visitNode('texture', dId, path);
                    deps.push({ ...ref, via: `recol_d_tex[${i}]` });
                }
            }
        }

        // Params — walk each param + its value-ref if applicable.
        this.walkParams(npc.params, deps, path);

        // Multinpc — recurse into other NPC configs.
        if (npc.multinpc && npc.multinpc.length > 0) {
            npc.multinpc.forEach((subId, i) => {
                if (subId !== -1 && subId !== 0) {
                    const ref = this.visitNode('npc', subId, path);
                    deps.push({ ...ref, via: `multinpc[${i}]` });
                }
            });
        }

        // Combat script — look up by NPC name.
        if (name) {
            const scriptRefs = this.findScriptsForNpc(name);
            for (const ref of scriptRefs) {
                const visited = this.visitNode('script', ref.id, path);
                deps.push({ ...visited, via: ref.via });
            }
        }

        return {
            kind: 'npc',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps
        };
    }

    private visitModel(id: number, _path: Set<string>): DepNode {
        const model = this.reader.readModel(id);
        const name = this.lookupName('model', id);

        if (!model) {
            return this.missingNode('model', id, `model ${id} not found in source cache`);
        }

        // Models are leaves — their internal vertex/triangle data doesn't
        // reference other cache assets. We do, however, record the rig-skin
        // presence (see task 5-a worklog entry for why this matters).
        const skins = !!(model.triangleSkin && model.triangleSkin.length > 0)
            || !!(model.vertexSkin && model.vertexSkin.length > 0);

        return {
            kind: 'model',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            skins,
            deps: []
        };
    }

    private visitSeq(id: number, path: Set<string>): DepNode {
        const seq = this.reader.readSeq(id);
        const name = seq?.debugname ?? this.lookupName('seq', id) ?? null;

        if (!seq) {
            return this.missingNode('seq', id, `seq ${id} not found in source cache`);
        }

        const deps: DepRef[] = [];

        // Frames — the anim archive IDs that this sequence plays.
        if (seq.frames) {
            for (let i = 0; i < seq.frames.length; i++) {
                const frameId = seq.frames[i];
                if (frameId === -1) {
                    continue;
                }
                const ref = this.visitNode('anim', frameId, path);
                deps.push({ ...ref, via: `frames[${i}]` });
            }
        }

        // Interpolated frames (iframes) — also anim archive IDs.
        if (seq.iframes) {
            for (let i = 0; i < seq.iframes.length; i++) {
                const frameId = seq.iframes[i];
                if (frameId === -1) {
                    continue;
                }
                const ref = this.visitNode('anim', frameId, path);
                deps.push({ ...ref, via: `iframes[${i}]` });
            }
        }

        // Anim base — every frame in this seq targets the same skeleton.
        // We don't know the base ID from the seq itself (it's encoded in
        // each frame blob's trailing 2 bytes); the tracer walks it via
        // the anim decoder. As a fallback, walk all distinct frame IDs
        // and let visitAnim populate the base ref.
        // (No explicit base walk here — see visitAnim.)

        // OSRS-only item overrides (codes 13/14).
        if (seq.leftHandItem !== -1) {
            const ref = this.visitNode('obj', seq.leftHandItem, path);
            deps.push({ ...ref, via: 'leftHandItem' });
        }
        if (seq.rightHandItem !== -1) {
            const ref = this.visitNode('obj', seq.rightHandItem, path);
            deps.push({ ...ref, via: 'rightHandItem' });
        }

        return {
            kind: 'seq',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps
        };
    }

    private visitAnim(id: number, path: Set<string>): DepNode {
        const anim = this.reader.readAnim(id);
        const name = this.lookupName('anim', id);

        if (!anim) {
            return this.missingNode('anim', id, `anim ${id} not found in source cache`);
        }

        const deps: DepRef[] = [];

        // The frame's base ID — record as an anim-base dep so the importer
        // knows to bring the skeleton along. This is the canonical place
        // the base is discovered (see task 5-b worklog entry).
        if (anim.base !== 0) {
            const ref = this.visitNode('anim-base', anim.base, path);
            deps.push({ ...ref, via: 'base' });
        }

        // Anim frames are otherwise leaves — they carry their transform
        // data inline (groups/x/y/z arrays).
        return {
            kind: 'anim',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps
        };
    }

    private visitAnimBase(id: number, _path: Set<string>): DepNode {
        const base = this.reader.readAnimBase(id);
        const name = this.lookupName('anim-base', id);

        if (!base) {
            return this.missingNode('anim-base', id, `anim-base ${id} not found in source cache`);
        }

        // Skeletons are leaves — they only contain bone type/label metadata.
        return {
            kind: 'anim-base',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps: []
        };
    }

    private visitObj(id: number, _path: Set<string>): DepNode {
        const obj = this.reader.readObj(id);
        const name = obj?.name ?? this.lookupName('obj', id) ?? null;

        if (!obj) {
            return this.missingNode('obj', id, `obj ${id} not found in source cache`);
        }

        // TODO: deep obj walk not implemented. `OsrsObjType` is not yet
        // ported, and the legacy `ObjType` doesn't have an
        // `extractDependencyRefs()` method. When task 8 ports the obj
        // decoder, this method should walk obj.model, obj.manwear,
        // obj.womanwear, obj.manhead, obj.womanhead, obj.countobj[],
        // obj.recol_s/d, and obj.params (via walkParams).
        //
        // For now we record the obj as a leaf with a TODO note so the
        // pilot can still run (the importer will just bring the obj
        // config as-is, without its sub-deps).
        return {
            kind: 'obj',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            note: 'TODO: deep obj walk not implemented (OsrsObjType not ported)',
            deps: []
        };
    }

    private visitParam(id: number, _path: Set<string>): DepNode {
        const param = this.reader.readParam(id);
        const name = param?.debugname ?? this.lookupName('param', id) ?? null;

        if (!param) {
            return this.missingNode('param', id, `param ${id} not found in source cache`);
        }

        // Param types themselves don't reference other assets — they just
        // declare what TYPE their values point at. The value-walk happens
        // in walkParams(), which calls visitNode for the value's target.
        return {
            kind: 'param',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps: []
        };
    }

    private visitStruct(id: number, path: Set<string>): DepNode {
        const struct = this.reader.readStruct(id);
        const name = struct?.debugname ?? this.lookupName('struct', id) ?? null;

        if (!struct) {
            return this.missingNode('struct', id, `struct ${id} not found in source cache`);
        }

        const deps: DepRef[] = [];
        if (struct.params) {
            this.walkParams(struct.params, deps, path);
        }

        return {
            kind: 'struct',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps
        };
    }

    private visitScript(name: string, _path: Set<string>): DepNode {
        // Scripts are identified by name (string ID), not numeric cache ID.
        // Try to find a matching .rs2 file in the LostCity content folder.
        const filePath = path.join(this.scriptDir, `${name}.rs2`);

        if (!fs.existsSync(filePath)) {
            // Common case for OSRS imports — the OSRS combat script hasn't
            // been ported to LostCity runescript yet. Record as missing so
            // the importer knows to expect a script.
            return this.missingNode('script', name, `script file not found: ${filePath}`);
        }

        const source = fs.readFileSync(filePath, 'utf8');
        const refs = this.scanScriptRefs(source);

        // Script refs discovered via text scan use string IDs (asset
        // debugnames from the script source). They're recorded as missing
        // because we can't resolve names→cache IDs without the pack files
        // (which task 8 wires up). The importer resolves them later.
        const deps: DepRef[] = refs.map(r => ({
            kind: r.kind,
            id: r.id,
            via: r.via,
            missing: true
        }));

        // Also record each missing ref in the top-level missing[] array
        // for O(1) importer flagging.
        for (const d of deps) {
            this.missing.push({ kind: d.kind, id: d.id, via: d.via });
        }

        return {
            kind: 'script',
            id: name,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps
        };
    }

    private visitTexture(id: number, _path: Set<string>): DepNode {
        const tex = this.reader.readTexture(id);
        const name = this.lookupName('texture', id);

        if (!tex) {
            return this.missingNode('texture', id, `texture ${id} not found in source cache`);
        }

        // Textures are leaves — they're just image bytes.
        return {
            kind: 'texture',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps: []
        };
    }

    private visitParticle(id: number, _path: Set<string>): DepNode {
        const p = this.reader.readParticle(id);
        const name = this.lookupName('particle', id);

        if (!p) {
            return this.missingNode('particle', id, `particle ${id} not found in source cache`);
        }

        // Particle systems may reference textures, but their internal
        // structure is OSRS-specific and not yet decoded. Treat as leaf.
        return {
            kind: 'particle',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            note: 'particle system internals not yet decoded',
            deps: []
        };
    }

    private visitSound(id: number, _path: Set<string>): DepNode {
        const s = this.reader.readSound(id);
        const name = this.lookupName('sound', id);

        if (!s) {
            return this.missingNode('sound', id, `sound ${id} not found in source cache`);
        }

        return {
            kind: 'sound',
            id,
            name,
            source: 'osrs',
            transformedFrom: null,
            deps: []
        };
    }

    // ---- Helpers ----

    private missingNode(kind: NodeKind, id: number | string, note: string): DepNode {
        const ref: DepRef = { kind, id, missing: true };
        this.missing.push(ref);
        return {
            kind,
            id,
            name: null,
            source: 'osrs',
            transformedFrom: null,
            missing: true,
            note,
            deps: []
        };
    }

    private lookupName(kind: NodeKind, id: number | string): string | null {
        if (!this.reader.getName) {
            return null;
        }
        try {
            return this.reader.getName(kind, id) ?? null;
        } catch {
            return null;
        }
    }

    private lookupParamType(id: number): ParamType | null {
        // Prefer the CacheReader's param registry (Task 7 will wire this to
        // the OSRS param.dat). Fall back to the legacy 377 ParamType static
        // registry if the reader doesn't expose one.
        const fromReader = this.reader.readParam(id);
        if (fromReader) {
            return fromReader;
        }
        return ParamType.get(id) ?? null;
    }

    /**
     * Best-effort: figure out which NPC field a seq ID came from, for the
     * `via` annotation. Returns the field name (e.g. 'readyanim') or
     * 'anims' if unknown.
     */
    private npcAnimFieldName(npc: OsrsNpcType, seqId: number): string {
        if (npc.readyanim === seqId) return 'readyanim';
        if (npc.walkanim === seqId) return 'walkanim';
        if (npc.walkanim_b === seqId) return 'walkanim_b';
        if (npc.walkanim_l === seqId) return 'walkanim_l';
        if (npc.walkanim_r === seqId) return 'walkanim_r';
        if (npc.runanim === seqId) return 'runanim';
        if (npc.runanim_b === seqId) return 'runanim_b';
        if (npc.runanim_l === seqId) return 'runanim_l';
        if (npc.runanim_r === seqId) return 'runanim_r';
        if (npc.crawlanim === seqId) return 'crawlanim';
        if (npc.crawlanim_b === seqId) return 'crawlanim_b';
        if (npc.crawlanim_l === seqId) return 'crawlanim_l';
        if (npc.crawlanim_r === seqId) return 'crawlanim_r';
        if (npc.crawlanim_b2 === seqId) return 'crawlanim_b2';
        return 'anims';
    }

    /**
     * Find runescript files that reference the given NPC name.
     *
     * Looks for:
     *   1. A file named `<npcName>.rs2` in the script dir (primary combat
     *      script convention).
     *   2. Any other `.rs2` file containing `[<trigger>,<npcName>]` dispatch
     *      directives (e.g. `[ai_applayer2,babydragon] @...`).
     *
     * Returns a list of `{ id: scriptName, via: 'dispatch:<trigger>' | 'script:<npcName>' }`
     * refs. The scriptName is the file basename without `.rs2`.
     */
    private findScriptsForNpc(npcName: string): Array<{ id: string; via: string }> {
        const refs: Array<{ id: string; via: string }> = [];

        // 1. Primary script file (convention: <npcName>.rs2).
        const primaryPath = path.join(this.scriptDir, `${npcName}.rs2`);
        if (fs.existsSync(primaryPath)) {
            refs.push({ id: npcName, via: `script:${npcName}` });
        }

        // 2. Dispatch directives in other .rs2 files.
        if (!fs.existsSync(this.scriptDir)) {
            return refs;
        }

        let files: string[] = [];
        try {
            files = fs.readdirSync(this.scriptDir).filter(f => f.endsWith('.rs2'));
        } catch (err) {
            printWarning(`DependencyTracer: could not read script dir ${this.scriptDir}: ${(err as Error).message}`);
            return refs;
        }

        const dispatchRe = new RegExp(`^\\[([a-zA-Z_][a-zA-Z0-9_]*),${escapeRegex(npcName)}\\]`);

        for (const file of files) {
            if (file === `${npcName}.rs2`) {
                continue; // already added as primary
            }

            const filePath = path.join(this.scriptDir, file);
            let source: string;
            try {
                source = fs.readFileSync(filePath, 'utf8');
            } catch {
                continue;
            }

            const scriptName = file.replace(/\.rs2$/, '');
            const lines = source.split(/\r?\n/);
            const triggers = new Set<string>();
            for (const line of lines) {
                const m = line.match(dispatchRe);
                if (m) {
                    triggers.add(m[1]);
                }
            }
            for (const trigger of triggers) {
                refs.push({ id: scriptName, via: `dispatch:${trigger}` });
            }
        }

        if (refs.length === 0) {
            printDebug(`DependencyTracer: no script found for npc '${npcName}'`);
        }

        return refs;
    }

    /**
     * Best-effort scan of a runescript source for asset references.
     *
     * LostCity runescript references assets by debugname in call sites:
     *   - `npc_anim(<seqName>, ...)`           → seq ref
     *   - `spotanim_npc(<particleName>, ...)`  → particle ref
     *   - `spotanim(<particleName>, ...)`      → particle ref
     *   - `sound_synth(<soundName>, ...)`      → sound ref
     *   - `inv_total(<slot>, <objName>)`       → obj ref
     *   - `inv_has(<slot>, <objName>)`         → obj ref
     *   - `npc_param(<paramName>)`             → param ref
     *   - `obj_param(<objName>, <paramName>)`  → obj ref (also param)
     *
     * The returned refs all use STRING ids (the debugnames from the script
     * source). The caller is expected to record them as missing until task
     * 8 resolves them via pack files.
     */
    private scanScriptRefs(source: string): Array<{ kind: NodeKind; id: string; via: string }> {
        const refs: Array<{ kind: NodeKind; id: string; via: string }> = [];

        // Helper: extract first identifier-like argument from a call.
        const ident = '[a-zA-Z_][a-zA-Z0-9_]*';

        const patterns: Array<{ re: RegExp; kind: NodeKind; group: number; via: string }> = [
            // npc_anim(seqName, ...)
            { re: new RegExp(`npc_anim\\(\\s*(${ident})`), kind: 'seq', group: 1, via: 'script:npc_anim' },
            // spotanim_npc(particleName, ...)
            { re: new RegExp(`spotanim_npc\\(\\s*(${ident})`), kind: 'particle', group: 1, via: 'script:spotanim_npc' },
            // spotanim(particleName, ...)
            { re: new RegExp(`bspotanim(?:_npc)?\\(\\s*(${ident})`), kind: 'particle', group: 1, via: 'script:spotanim' },
            { re: new RegExp(`[^b]spotanim(?:_npc)?\\(\\s*(${ident})`), kind: 'particle', group: 1, via: 'script:spotanim' },
            // sound_synth(soundName, ...)
            { re: new RegExp(`sound_synth\\(\\s*(${ident})`), kind: 'sound', group: 1, via: 'script:sound_synth' },
            // inv_total(slot, objName) — second arg is the obj name
            { re: new RegExp(`inv_total\\(\\s*${ident}\\s*,\\s*(${ident})`), kind: 'obj', group: 1, via: 'script:inv_total' },
            // inv_has(slot, objName)
            { re: new RegExp(`inv_has\\(\\s*${ident}\\s*,\\s*(${ident})`), kind: 'obj', group: 1, via: 'script:inv_has' },
            // npc_param(paramName)
            { re: new RegExp(`npc_param\\(\\s*(${ident})`), kind: 'param', group: 1, via: 'script:npc_param' }
        ];

        // Use a global-scan approach: for each pattern, find all matches.
        // We dedupe by (kind, id, via) at the end.
        for (const { re, kind, group, via } of patterns) {
            const globalRe = new RegExp(re.source, 'g');
            let m: RegExpExecArray | null;
            while ((m = globalRe.exec(source)) !== null) {
                const id = m[group];
                if (id) {
                    refs.push({ kind, id, via });
                }
            }
        }

        // Dedupe.
        const seen = new Set<string>();
        const unique: typeof refs = [];
        for (const r of refs) {
            const k = `${r.kind}:${r.id}:${r.via}`;
            if (!seen.has(k)) {
                seen.add(k);
                unique.push(r);
            }
        }
        return unique;
    }

    private serializeNodes(): Record<string, DepNode> {
        const out: Record<string, DepNode> = {};
        for (const [k, v] of this.nodes) {
            out[k] = v;
        }
        return out;
    }
}

/**
 * Standalone helper to walk a param map and push refs into `deps`.
 *
 * This is a thin wrapper around `tracer.walkParams()` provided for parity
 * with the task spec, which called for `walkParams(params, tracer, deps)`.
 * Callers that already have a tracer reference should prefer calling
 * `tracer.walkParams(...)` directly.
 *
 * The `path` argument is REQUIRED (not in the spec signature) because
 * cycle detection depends on it — without a path, walkParams can't safely
 * recurse into param-value targets. Callers should pass the same `path`
 * Set they're using for the surrounding walk.
 */
export function walkParams(
    params: ParamMap,
    tracer: DependencyTracer,
    deps: DepRef[],
    path: Set<string>
): void {
    tracer.walkParams(params, deps, path);
}

/** Escape a string for safe insertion into a RegExp. */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
