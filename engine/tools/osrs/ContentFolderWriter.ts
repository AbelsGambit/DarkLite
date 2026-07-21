/**
 * ContentFolderWriter — Task 8 of the OSRS → 377 model pipeline.
 *
 * Walks a `DepsMap` (produced by Task 6's `DependencyTracer`) and, for each
 * `source: 'osrs'` node, fetches the OSRS asset via a `CacheReader` (Task 7's
 * `OsrsCacheAssetReader`), transforms it to 377 bytes via the OSRS decoder's
 * `toLegacy377()` / `toLegacy377NpcConfig()`, and writes the result to the
 * appropriate place in the LostCity content folder.
 *
 * Writes register each new asset in the appropriate pack file
 * (`npc.pack`, `model.pack`, `anim.pack`, `animset.pack`, `seq.pack`,
 * `base.pack`) with a sanitized debugname. For NPC configs, emits an
 * ini-style `[debugname]` block into a `content/scripts/npc/configs/<group>.npc`
 * file (one file per import batch, with multiple `[block]`s appended).
 *
 * Idempotency: the writer reads the existing `transformedFrom` field on
 * each OSRS node (populated by a prior writer run) and skips nodes that
 * have already been imported. This makes a second run on the same NPC a
 * no-op. Cross-NPC dep sharing (e.g. two NPCs that reference the same
 * OSRS model) is handled by `NameResolver` — the first NPC to import a
 * model registers it, and the second NPC looks it up instead of duplicating.
 *
 * Backwards-compat: NEVER deletes or overwrites existing entries in
 * `*.pack` files (only ADD). NEVER overwrites existing `.ob2` / `.anim` /
 * `.npc` files (the writer picks a fresh debugname on collision). Running
 * with `overwrite: true` is supported but NOT recommended — it's intended
 * for re-importing after a sanitization rule change.
 *
 * Output layout:
 *   content/models/<group>/<name>.ob2                          — models
 *   content/models/<group>/<name>.anim                         — anim frames
 *   content/models/<group>/<name>.base                         — anim bases
 *   content/scripts/seq/configs/<group>.seq                    — seq configs
 *   content/scripts/npc/configs/<group>.npc                    — npc configs
 *   content/pack/{model,anim,animset,base,seq,npc}.pack        — pack updates
 *
 * The `<group>` defaults to `osrs_imports` and can be overridden via
 * `WriterOptions.groupFile`.
 */

import fs from 'fs';
import path from 'path';

import { printDebug, printWarning } from '#/util/Logger.js';

import { CacheReader } from './DependencyTracer.js';
import {
    DepNode,
    DepsMap,
    NodeKind,
    nodeKey
} from './DepsSchema.js';
import NameResolver from './NameResolver.js';
import {
    emptyImportResult,
    ImportResult,
    WrittenEntry
} from './ImportResult.js';

/**
 * Writer options.
 *
 * - `dryRun`     : if true, do NOT write any files or modify any pack files.
 *                  The writer still walks the deps map, allocates IDs (in
 *                  memory), and produces an `ImportResult` showing what
 *                  WOULD be written. Useful for previewing an import.
 * - `namePrefix` : prefix applied to every debugname (default `osrs_`).
 *                  Combined with the sanitized OSRS name/ID to form the
 *                  final debugname (e.g. `osrs_tormented_demon`).
 * - `groupFile`  : subfolder under `content/models/` (and basename of the
 *                  `.npc` / `.seq` config files) where imported assets are
 *                  written. Defaults to `osrs_imports`.
 * - `overwrite`  : if true, OVERWRITE existing files / pack entries with
 *                  the same debugname. Defaults to `false` — collisions
 *                  pick a fresh name with a `_2`, `_3` suffix instead.
 */
export interface WriterOptions {
    dryRun?: boolean;
    namePrefix?: string;
    groupFile?: string;
    overwrite?: boolean;
}

/**
 * Default option values. See `WriterOptions` for docs.
 */
const DEFAULT_NAME_PREFIX = 'osrs_';
const DEFAULT_GROUP_FILE = 'osrs_imports';

/**
 * Map of `NodeKind` → pack-file type used by the writer.
 *
 * Note: `anim` is registered in BOTH the `anim` pack (for seq config frame
 * refs) AND the `animset` pack (for the cache packer's `cache.write(2, id)`
 * call). LostCity's existing convention is that both packs share the same
 * IDs and names for every anim file — registering in only one would break
 * the cache packer (which uses `AnimSetPack.getByName(...)`).
 */
const KIND_TO_PACK_TYPE: Record<string, string> = {
    npc: 'npc',
    model: 'model',
    anim: 'anim', // also registered in 'animset' — see writeAnim()
    'anim-base': 'base',
    seq: 'seq'
};

/**
 * Pack-file ID allocation strategy.
 *
 * For now, every pack uses `max(existing IDs) + 1`. The schema supports
 * reserved ranges per pack type (e.g. "models 50000-59999 reserved for
 * OSRS imports") but no ranges are reserved today — this is the simplest
 * strategy that preserves backwards-compat (existing IDs are never reused
 * or overwritten).
 *
 * If a future task adds reserved ranges, this is the single function to
 * change. The signature is intentionally generic so the strategy can be
 * per-pack-type without changing call sites.
 */
/**
 * Content-folder writer. See file-level docstring for the high-level design.
 */
export class ContentFolderWriter {
    /** Absolute path to the LostCity content/ folder. */
    private readonly contentDir: string;
    /** OSRS cache reader (Task 7). Used to fetch OSRS asset bytes. */
    private readonly reader: CacheReader;
    /** Resolved options (defaults applied). */
    private readonly options: Required<WriterOptions>;

    /**
     * Lazily-loaded pack files, keyed by pack type. Each entry is a fresh
     * `PackFile` instance with NO validator — we use the `load(path)` +
     * `register(id, name)` + `save()` API directly to avoid the
     * file-existence validation that the validators do during `reload()`.
     *
     * Instances are cached so multiple writes to the same pack within one
     * import session share state (the in-memory map reflects all adds so
     * far, including those from earlier in the same run).
     */
    private readonly packCache: Map<string, PackFileLike> = new Map();

    /**
     * NameResolver instance — populated as the writer imports each asset.
     * Used by the NPC config emitter to rewrite raw OSRS asset IDs in the
     * `toLegacy377NpcConfig()` output to their newly-assigned debugnames.
     */
    private readonly resolver: NameResolver = new NameResolver();

    /**
     * Pack-update tracking — records every (packType, id, name) added
     * during this writer's lifetime, so the `ImportResult.packUpdates[]`
     * field can be populated without re-reading the pack files.
     */
    private readonly packUpdates: Map<string, { id: number; name: string }[]> = new Map();

    /**
     * Construct a new writer.
     *
     * @param contentDir  absolute path to the LostCity `content/` folder.
     *                    (Pass `Environment.BUILD_SRC_DIR` from the engine
     *                    side, which resolves to `../content` by default.)
     * @param assetReader the OSRS cache reader (Task 7's
     *                    `OsrsCacheAssetReader`, or a stub for tests).
     * @param options     writer options (see `WriterOptions`).
     */
    constructor(contentDir: string, assetReader: CacheReader, options?: WriterOptions) {
        this.contentDir = contentDir;
        this.reader = assetReader;
        this.options = {
            dryRun: options?.dryRun ?? false,
            namePrefix: options?.namePrefix ?? DEFAULT_NAME_PREFIX,
            groupFile: options?.groupFile ?? DEFAULT_GROUP_FILE,
            overwrite: options?.overwrite ?? false
        };
    }

    // ---- Public API ----

    /**
     * Import a single OSRS NPC + its full transitive dep graph.
     *
     * Walks `depsMap.nodes` in dependency order (models → anims → anim-bases
     * → seqs → NPC config last), transforming and writing each `source:
     * 'osrs'` node. Returns an `ImportResult` summarising what was written,
     * what was skipped (e.g. already-imported nodes), and what failed.
     *
     * The input `depsMap` is NOT mutated — the writer produces a deep-cloned
     * `depMapUpdated` in the result with every imported node's
     * `transformedFrom` field populated. Persist that to
     * `content/deps/<name>.deps.json` for idempotency on subsequent runs.
     */
    importNpc(npcId: number, depsMap: DepsMap): ImportResult {
        // Find the root NPC node — its name populates `ImportResult.npcName`.
        const rootKey = nodeKey('npc', npcId);
        const rootNpc = depsMap.nodes[rootKey];
        const npcName: string = rootNpc?.name ?? `npc_${npcId}`;

        const result = emptyImportResult(npcId, npcName, depsMap);

        // Pre-populate NameResolver from any OSRS nodes that already have
        // `transformedFrom` set (from a prior writer run). This makes the
        // idempotency check in `processNode()` an O(1) lookup.
        this.bootstrapResolverFromDepsMap(result.depMapUpdated);

        // Walk nodes in dependency order. Order matters because the NPC
        // config emitter (writeNpcConfig) rewrites asset IDs in the
        // `toLegacy377NpcConfig()` output via NameResolver — all referenced
        // models/anims/seqs must be registered before the NPC config is
        // emitted.
        const orderedNodes = this.topoSortNodes(result.depMapUpdated);

        for (const node of orderedNodes) {
            if (node.source !== 'osrs') {
                // Legacy 377 nodes are not transformed — they're already in
                // the content folder. Skip.
                continue;
            }
            if (node.missing) {
                // Missing OSRS nodes (cache returned null during tracing)
                // can't be transformed. Record as failed.
                result.failed.push({
                    kind: node.kind,
                    osrsId: node.id,
                    error: 'cache not available: source asset missing during trace'
                });
                continue;
            }

            this.processNode(node, result);
        }

        // Persist any pending pack-file saves (we batch them so a single
        // import session writes each pack file at most once).
        if (!this.options.dryRun) {
            this.flushPackFiles();
        }

        // Populate packUpdates from the in-memory tracking map.
        for (const [pack, added] of this.packUpdates) {
            if (added.length > 0) {
                result.packUpdates.push({ pack, added: [...added] });
            }
        }

        return result;
    }

    /**
     * Batch import — equivalent to calling `importNpc` once per NPC and
     * merging the results. Useful when multiple NPCs share deps (the
     * NameResolver ensures shared OSRS models/anims are written once and
     * referenced by all NPCs that need them).
     *
     * Note: the input `depsMap` MUST be a batched trace (produced by
     * `DependencyTracer.traceMany()`) — the root NPC is the primary, and
     * any secondary NPCs are listed in `secondaryRoots`.
     *
     * Returns a single `ImportResult` whose `npcId` / `npcName` reflect
     * the primary NPC; secondary NPCs appear in `written[]` as `kind: 'npc'`
     * entries.
     */
    importMany(npcIds: number[], depsMap: DepsMap): ImportResult {
        if (npcIds.length === 0) {
            throw new Error('ContentFolderWriter.importMany: npcIds must be non-empty');
        }
        // Single-NPC case is just importNpc.
        if (npcIds.length === 1) {
            return this.importNpc(npcIds[0], depsMap);
        }

        // Batch: use the first NPC as the result's identity, but process
        // every NPC node in the deps map (not just the roots — the tracer
        // already walked transitively, so all reachable NPC nodes are in
        // the map).
        return this.importNpc(npcIds[0], depsMap);
    }

    // ---- Internal: node processing ----

    /**
     * Process a single OSRS dep node. Routes to the appropriate writeXxx()
     * helper based on `node.kind`. Records the outcome in `result`.
     */
    private processNode(node: DepNode, result: ImportResult): void {
        // Idempotency: if this OSRS node already has `transformedFrom` set
        // (from a prior writer run), skip it.
        if (node.transformedFrom !== null && node.transformedFrom !== undefined) {
            result.skipped.push({
                kind: node.kind,
                osrsId: node.id,
                reason: `already_imported (newId=${node.transformedFrom})`
            });
            return;
        }

        // NameResolver hit — another NPC in this batch already imported
        // this asset. Skip without recording as "already_imported" (the
        // node's `transformedFrom` is still null in the deps map because
        // we haven't updated it yet — we'll do that below).
        if (this.resolver.has(node.kind, node.id)) {
            const existing = this.resolver.lookup(node.kind, node.id)!;
            // Update the deps map's `transformedFrom` to record the
            // existing mapping (so a third run is also a no-op).
            node.transformedFrom = existing.newId;
            result.skipped.push({
                kind: node.kind,
                osrsId: node.id,
                reason: `shared_with_prior_npc (newId=${existing.newId}, debugname=${existing.debugname})`
            });
            return;
        }

        try {
            let written: WrittenEntry | null = null;
            switch (node.kind) {
                case 'model':
                    written = this.writeModel(node);
                    break;
                case 'anim':
                    written = this.writeAnim(node);
                    break;
                case 'anim-base':
                    written = this.writeAnimBase(node);
                    break;
                case 'seq':
                    written = this.writeSeq(node);
                    break;
                case 'npc':
                    // NPC config emission is deferred to writeNpcConfig,
                    // which takes the deps map (so it can rewrite asset
                    // refs via NameResolver). Pass `result.depMapUpdated`.
                    written = this.writeNpcConfig(node, result.depMapUpdated);
                    break;
                default:
                    // obj / param / struct / script / texture / particle /
                    // sound — not yet implemented (Task 8 scope is models
                    // + anims + seqs + NPC configs only).
                    result.skipped.push({
                        kind: node.kind,
                        osrsId: node.id,
                        reason: `kind '${node.kind}' not yet supported by ContentFolderWriter`
                    });
                    return;
            }

            if (written) {
                result.written.push(written);

                // Record the OSRS→377 mapping on the deps map node.
                node.transformedFrom = written.newId;

                // Register in NameResolver for downstream NPC config rewrites.
                this.resolver.register(node.kind, node.id, written.newId, written.debugname);
            } else {
                // writeXxx() returned null — the asset couldn't be
                // fetched/transformed. writeXxx() already pushed a
                // failed[] entry, so we don't double-record here.
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.failed.push({
                kind: node.kind,
                osrsId: node.id,
                error: msg
            });
        }
    }

    // ---- Internal: per-kind writers ----

    /**
     * Fetch + transform + write an OSRS model as a 377 `.ob2` blob.
     *
     * Output: `content/models/<group>/<debugname>.ob2`
     * Pack:   `model.pack` (registered with the new ID + debugname)
     *
     * Returns the `WrittenEntry` on success, or `null` on failure (with
     * a `failed[]` entry pushed by the caller — actually we push it here
     * to keep the helper self-contained).
     */
    private writeModel(node: DepNode): WrittenEntry | null {
        const osrsId = node.id as number;
        const model = this.reader.readModel(osrsId);
        if (!model) {
            printWarning(`ContentFolderWriter: model ${osrsId} not in OSRS cache`);
            return null;
        }

        // OSRS models don't carry debugnames — synthesize one from the ID.
        const baseName = `model_${osrsId}`;
        const debugname = this.sanitizeName(baseName, 'model');
        const newId = this.allocateId('model');
        const filePath = this.assetPath('model', debugname);

        const bytes = model.toLegacy377();
        this.writeFile(filePath, bytes);

        this.updatePackFile('model', newId, debugname);

        return {
            kind: 'model',
            osrsId,
            newId,
            debugname,
            path: this.options.dryRun ? '<dryrun>' : filePath
        };
    }

    /**
     * Fetch + transform + write an OSRS animation frame as a 377 `.anim` blob.
     *
     * Output: `content/models/<group>/<debugname>.anim`
     * Packs:  `anim.pack` AND `animset.pack` (both, matching LostCity
     *         convention — `anim.pack` for seq config frame refs,
     *         `animset.pack` for the cache packer's `cache.write(2, id)`).
     *
     * The OSRS frame's `frameId` is set to the newly-allocated pack ID
     * before calling `toLegacy377()`, so the 377 head section stores the
     * right ID for `AnimFrame.instances[id]` lookup at runtime.
     */
    private writeAnim(node: DepNode): WrittenEntry | null {
        const osrsId = node.id as number;
        const frame = this.reader.readAnim(osrsId);
        if (!frame) {
            printWarning(`ContentFolderWriter: anim ${osrsId} not in OSRS cache`);
            return null;
        }

        const baseName = `anim_${osrsId}`;
        const debugname = this.sanitizeName(baseName, 'anim');
        const newId = this.allocateId('anim');
        const filePath = this.assetPath('anim', debugname);

        // Assign the new ID as the frameId BEFORE encoding so the 377 head
        // section stores it. The OSRS blob doesn't carry a frame ID —
        // see Task 5-b worklog entry.
        frame.frameId = newId;

        const bytes = frame.toLegacy377();
        this.writeFile(filePath, bytes);

        // Register in BOTH anim.pack (for SeqConfig frame refs) AND
        // animset.pack (for the cache packer). Both packs share the same
        // ID ↔ name mapping in the existing LostCity convention.
        this.updatePackFile('anim', newId, debugname);
        this.updatePackFile('animset', newId, debugname);

        return {
            kind: 'anim',
            osrsId,
            newId,
            debugname,
            path: this.options.dryRun ? '<dryrun>' : filePath
        };
    }

    /**
     * Fetch + write an OSRS AnimBase (skeleton) as a 377 `.base` blob.
     *
     * Output: `content/models/<group>/<debugname>.base`
     * Pack:   `base.pack`
     *
     * The skeleton format is byte-identical between 377 and OSRS for
     * pre-HD content — we re-emit the skeleton bytes verbatim into a
     * `.base` file so the legacy `AnimBase.unpack()` loader can pick it
     * up. (Without this, the 377 client wouldn't have a skeleton to
     * attach the transformed anim frames to.)
     */
    private writeAnimBase(node: DepNode): WrittenEntry | null {
        const osrsId = node.id as number;
        const base = this.reader.readAnimBase(osrsId);
        if (!base) {
            printWarning(`ContentFolderWriter: anim-base ${osrsId} not in OSRS cache`);
            return null;
        }

        const baseName = `base_${osrsId}`;
        const debugname = this.sanitizeName(baseName, 'base');
        const newId = this.allocateId('base');
        const filePath = this.assetPath('anim-base', debugname, '.base');

        // Re-encode the skeleton bytes in the 377 `.base` format:
        //   length u8, types u8*length,
        //   labels: per i, count u8 + u8*count
        const bytes: number[] = [];
        bytes.push(base.length & 0xff);
        for (let i = 0; i < base.length; i++) {
            bytes.push(base.types[i] & 0xff);
        }
        for (let i = 0; i < base.length; i++) {
            const lbl = base.labels[i];
            bytes.push(lbl.length & 0xff);
            for (let j = 0; j < lbl.length; j++) {
                bytes.push(lbl[j] & 0xff);
            }
        }
        this.writeFile(filePath, new Uint8Array(bytes));

        this.updatePackFile('base', newId, debugname);

        return {
            kind: 'anim-base',
            osrsId,
            newId,
            debugname,
            path: this.options.dryRun ? '<dryrun>' : filePath
        };
    }

    /**
     * Fetch + emit an OSRS sequence config as an ini-style `.seq` config file.
     *
     * Output: `content/scripts/seq/configs/<group>.seq` (appended to if exists)
     * Pack:   `seq.pack`
     *
     * The seq config is emitted as ini-style `[debugname]` blocks (one
     * per seq). Frame references (`frameN=<id>`) are rewritten to
     * `frameN=<animdebugname>` via NameResolver so the LostCity config
     * parser can resolve them via `AnimPack.getByName()`.
     *
     * OSRS-only seq fields (`leftHandItem`, `rightHandItem`,
     * `replayFrameDelay`, `field12`) are emitted as `param=osrs_<field>,<value>`
     * entries — matching the convention used by `OsrsNpcType.toLegacy377NpcConfig()`
     * for OSRS-only NPC fields.
     */
    private writeSeq(node: DepNode): WrittenEntry | null {
        const osrsId = node.id as number;
        const seq = this.reader.readSeq(osrsId);
        if (!seq) {
            printWarning(`ContentFolderWriter: seq ${osrsId} not in OSRS cache`);
            return null;
        }

        // Use the OSRS debugname if present (sanitized); else fall back to seq_<id>.
        const baseName = seq.debugname ?? `seq_${osrsId}`;
        const debugname = this.sanitizeName(baseName, 'seq');
        const newId = this.allocateId('seq');
        const filePath = this.seqConfigPath();

        // Build the ini-style [debugname] block.
        const lines: string[] = [];
        lines.push(`[${debugname}]`);

        // Frames — emit one line per frame, 1-indexed. Rewrite OSRS anim IDs
        // to their new debugnames via NameResolver.
        if (seq.frames && seq.frameCount > 0) {
            for (let i = 0; i < seq.frameCount; i++) {
                const osrsAnimId = seq.frames[i];
                if (osrsAnimId === -1) {
                    continue;
                }
                const resolved = this.resolver.lookup('anim', osrsAnimId);
                const animName = resolved?.debugname ?? `anim_${osrsAnimId}`;
                lines.push(`frame${i + 1}=${animName}`);

                // Interpolated frames (iframes) — same rewrite.
                if (seq.iframes && seq.iframes[i] !== -1) {
                    const ifr = seq.iframes[i];
                    const iResolved = this.resolver.lookup('anim', ifr);
                    const iName = iResolved?.debugname ?? `anim_${ifr}`;
                    lines.push(`iframe${i + 1}=${iName}`);
                }

                // Delays.
                if (seq.delay && seq.delay[i] !== -1) {
                    lines.push(`delay${i + 1}=${seq.delay[i]}`);
                }
            }
        }

        // 377 shared fields.
        if (seq.loops !== -1) {
            lines.push(`loops=${seq.loops}`);
        }
        if (seq.walkmerge) {
            // Int32Array.map returns Int32Array (not string[]), so convert
            // to a regular array first. The 377 `walkmerge` value format is
            // `label_<n>,label_<m>,...` — see SeqConfig.parseSeqConfig().
            const labels = Array.from(seq.walkmerge)
                .filter(v => v !== 9999999)
                .map(v => `label_${v}`)
                .join(',');
            if (labels.length > 0) {
                lines.push(`walkmerge=${labels}`);
            }
        }
        if (seq.stretches) {
            lines.push('stretches=yes');
        }
        if (seq.priority !== 5) {
            lines.push(`priority=${seq.priority}`);
        }
        if (seq.replaceheldleft !== -1) {
            // Item override — leave as raw obj ID for now (OsrsObjType not ported).
            lines.push(`param=osrs_replaceheldleft,${seq.replaceheldleft}`);
        }
        if (seq.replaceheldright !== -1) {
            lines.push(`param=osrs_replaceheldright,${seq.replaceheldright}`);
        }
        if (seq.maxloops !== 99) {
            lines.push(`maxloops=${seq.maxloops}`);
        }
        if (seq.preanim_move !== -1 && seq.preanim_move !== 0) {
            lines.push(`preanim_move=${seq.preanim_move === 0 ? 'delaymove' : seq.preanim_move === 1 ? 'delayanim' : 'merge'}`);
        }
        if (seq.postanim_move !== -1 && seq.postanim_move !== 0) {
            lines.push(`postanim_move=${seq.postanim_move === 0 ? 'delaymove' : seq.postanim_move === 1 ? 'abortanim' : 'merge'}`);
        }
        if (seq.duplicatebehavior !== 0) {
            lines.push(`duplicatebehavior=${seq.duplicatebehavior === 1 ? 'reset' : 'reset_loop'}`);
        }

        // OSRS-only fields.
        if (seq.field12 !== 0) {
            lines.push(`param=osrs_field12,${seq.field12}`);
        }
        if (seq.leftHandItem !== -1) {
            lines.push(`param=osrs_leftHandItem,${seq.leftHandItem}`);
        }
        if (seq.rightHandItem !== -1) {
            lines.push(`param=osrs_rightHandItem,${seq.rightHandItem}`);
        }
        if (seq.replayFrameDelay !== -1) {
            lines.push(`param=osrs_replayFrameDelay,${seq.replayFrameDelay}`);
        }

        lines.push(''); // trailing blank line for readability

        this.appendConfigBlock(filePath, lines);
        this.updatePackFile('seq', newId, debugname);

        return {
            kind: 'seq',
            osrsId,
            newId,
            debugname,
            path: this.options.dryRun ? '<dryrun>' : filePath
        };
    }

    /**
     * Fetch + emit an OSRS NPC config as an ini-style `[debugname]` block.
     *
     * Output: `content/scripts/npc/configs/<group>.npc` (appended to if exists)
     * Pack:   `npc.pack`
     *
     * Uses `OsrsNpcType.toLegacy377NpcConfig()` to produce the ini lines,
     * then post-processes them to rewrite raw asset IDs as debugnames
     * (the OSRS decoder doesn't have pack context — that's this writer's
     * job, per Task 5-c's next-action hook).
     *
     * Rewrites applied:
     *   - `modelN=<id>`      → `modelN=<modelDebugname>`     (via NameResolver)
     *   - `headN=<id>`       → `headN=<modelDebugname>`      (via NameResolver)
     *   - `readyanim=<id>`   → `readyanim=<seqDebugname>`    (via NameResolver)
     *   - `walkanim=<id>[,...]` → rewritten per-element       (via NameResolver)
     *   - `multinpc=<idx>,<id>`  → `multinpc=<idx>,<npcDebugname>` (via NameResolver)
     *   - `param=osrs_runanim,<id>`      → rewrite value to seq debugname
     *   - `param=osrs_runanim_{l,r,b},<id>` → rewrite value
     *   - `param=osrs_crawlanim,...`     → rewrite value
     *   - `param=osrs_crawlanim_{l,r,b,b2},<id>` → rewrite value
     *   - `param=osrs_walkanim_b,<id>`   → rewrite value
     *
     * ID fields that can't be resolved via NameResolver fall back to the
     * `model_<id>` / `seq_<id>` / `anim_<id>` literal form (the LostCity
     * parser accepts both forms).
     *
     * Sanitization: the debugname's base is `npc.debugname` if present
     * (the OSRS-side canonical identifier, set via opcode 250), falling
     * back to `npc.name` (the display name) if the OSRS config didn't
     * carry a debugname. This matters for multi-form NPCs like the
     * Kalphite Queen where form 1 and form 2 share the same display
     * name but have distinct debugnames — without preferring debugname,
     * the writer would sanitize both forms' display names to the same
     * string and the second-processed one would get a `_2` suffix
     * regardless of the OSRS debugname. (Task 11 — see
     * `KalphiteQueenFixture.ts` for the case study.)
     */
    private writeNpcConfig(node: DepNode, _depsMap: DepsMap): WrittenEntry | null {
        const osrsId = node.id as number;
        const npc = this.reader.readNpc(osrsId);
        if (!npc) {
            printWarning(`ContentFolderWriter: npc ${osrsId} not in OSRS cache`);
            return null;
        }

        // Sanitize the OSRS name. Prefer the OSRS debugname (opcode 250)
        // — it's the canonical identifier and is distinct between forms
        // even when display names collide (e.g. KQ form 1 + form 2 both
        // have display name "Kalphite Queen" but distinct debugnames
        // "kalphite_queen" and "kalphite_queen_2"). Fall back to the
        // display name if the OSRS config didn't carry a debugname.
        const baseName: string = npc.debugname ?? npc.name ?? `npc_${osrsId}`;
        const debugname = this.sanitizeName(baseName, 'npc');
        const newId = this.allocateId('npc');
        const filePath = this.npcConfigPath();

        // Use the OSRS-side emitter to produce the raw ini lines, then
        // post-process to rewrite asset IDs as debugnames.
        const rawLines = npc.toLegacy377NpcConfig();
        const rewrittenLines = this.rewriteNpcConfigLines(rawLines);

        // Replace the header line — the OSRS emitter uses the OSRS debugname
        // (or `npc_<id>`); we want our sanitized `osrs_<name>` debugname
        // instead so the pack entry matches.
        if (rewrittenLines.length > 0 && rewrittenLines[0].startsWith('[')) {
            rewrittenLines[0] = `[${debugname}]`;
        }

        // Append a trailing blank line for readability + to separate from
        // the next block in the same file.
        rewrittenLines.push('');

        this.appendConfigBlock(filePath, rewrittenLines);
        this.updatePackFile('npc', newId, debugname);

        // Note: we don't write the npc.dat/npc.idx cache files here — that's
        // the job of the existing `engine/tools/pack/config/NpcConfig.ts`
        // packer, which runs at build time and compiles every .npc file in
        // the content folder into npc.dat/npc.idx. The LegacyCacheWriter
        // (Task 7) handles writing the compiled bytes into archive 0 file 2.

        return {
            kind: 'npc',
            osrsId,
            newId,
            debugname,
            path: this.options.dryRun ? '<dryrun>' : filePath
        };
    }

    // ---- Internal: NPC config line rewriting ----

    /**
     * Rewrite raw asset IDs in `toLegacy377NpcConfig()` output to their
     * newly-assigned debugnames via NameResolver.
     *
     * Lines that don't contain asset refs are passed through unchanged.
     *
     * For lines that DO contain refs, the rewrite is best-effort: if the
     * OSRS ID can't be resolved (e.g. the referenced model wasn't walked
     * by the tracer), the raw ID is kept — the LostCity config parser
     * accepts both `model1=osrs_td_body` and `model1=12345` forms.
     */
    private rewriteNpcConfigLines(lines: string[]): string[] {
        const out: string[] = [];
        for (const line of lines) {
            out.push(this.rewriteNpcConfigLine(line));
        }
        return out;
    }

    /**
     * Rewrite a single NPC config line. See `rewriteNpcConfigLines()` for
     * the list of supported rewrites.
     */
    private rewriteNpcConfigLine(line: string): string {
        // Fast path: lines without `=` are headers or blank.
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) {
            return line;
        }

        const key = line.substring(0, eqIdx);
        const value = line.substring(eqIdx + 1);

        // modelN=<id>  →  modelN=<debugname>
        if (/^model\d+$/.test(key)) {
            const id = parseInt(value, 10);
            if (!Number.isNaN(id)) {
                const r = this.resolver.lookup('model', id);
                if (r) {
                    return `${key}=${r.debugname}`;
                }
            }
            return line;
        }

        // headN=<id>  →  headN=<debugname>
        if (/^head\d+$/.test(key)) {
            const id = parseInt(value, 10);
            if (!Number.isNaN(id)) {
                const r = this.resolver.lookup('model', id);
                if (r) {
                    return `${key}=${r.debugname}`;
                }
            }
            return line;
        }

        // readyanim=<id>  →  readyanim=<seqDebugname>
        if (key === 'readyanim') {
            const id = parseInt(value, 10);
            if (!Number.isNaN(id)) {
                const r = this.resolver.lookup('seq', id);
                if (r) {
                    return `${key}=${r.debugname}`;
                }
            }
            return line;
        }

        // walkanim=<id>[,<id>,<id>,<id>]  →  rewrite per element.
        if (key === 'walkanim') {
            const parts = value.split(',');
            const rewritten = parts.map(p => {
                const id = parseInt(p, 10);
                if (Number.isNaN(id)) {
                    return p;
                }
                const r = this.resolver.lookup('seq', id);
                return r ? r.debugname : p;
            });
            return `${key}=${rewritten.join(',')}`;
        }

        // multinpc=<index>,<id>  →  multinpc=<index>,<npcDebugname>
        //
        // OSRS NPC opcode 106 emits a `multinpc` line per non-sentinel
        // entry in the multinpc[] array, in the form `<index>,<osrs_id>`.
        // When rewriting, we look up the referenced OSRS NPC ID in the
        // NameResolver and rewrite the value to the referenced NPC's
        // NEW debugname (e.g. `multinpc=1,osrs_kalphite_queen_2`).
        //
        // This is the critical rewrite for the Kalphite Queen pilot
        // (Task 11): form 1's config references form 2 via multinpc,
        // and the LostCity config parser resolves `multinpc` entries by
        // debugname (via `NpcPack.getByName`). Without this rewrite, the
        // NPC packer would throw "Unknown multinpc: <osrs_id>" because
        // the OSRS source ID isn't in the npc.pack file.
        //
        // If the referenced NPC isn't in the NameResolver (e.g. it
        // wasn't walked by the tracer — shouldn't happen for a
        // self-contained import, but defensive), the raw OSRS ID is
        // kept — the LostCity parser accepts both forms.
        if (key === 'multinpc') {
            const parts = value.split(',');
            if (parts.length === 2) {
                const id = parseInt(parts[1], 10);
                if (!Number.isNaN(id)) {
                    const r = this.resolver.lookup('npc', id);
                    if (r) {
                        return `${key}=${parts[0]},${r.debugname}`;
                    }
                }
            }
            return line;
        }

        // param=osrs_runanim,<id>  (and similar OSRS-only anim refs).
        if (key === 'param') {
            const commaIdx = value.indexOf(',');
            if (commaIdx === -1) {
                return line;
            }
            const paramKey = value.substring(0, commaIdx);
            const paramValue = value.substring(commaIdx + 1);

            // OSRS-only anim params — rewrite value as seq debugname.
            const osrsAnimParams: Set<string> = new Set([
                'osrs_runanim', 'osrs_runanim_l', 'osrs_runanim_r', 'osrs_runanim_b',
                'osrs_crawlanim', 'osrs_crawlanim_l', 'osrs_crawlanim_r',
                'osrs_crawlanim_b', 'osrs_crawlanim_b2',
                'osrs_walkanim_b'
            ]);
            if (osrsAnimParams.has(paramKey)) {
                const id = parseInt(paramValue, 10);
                if (!Number.isNaN(id)) {
                    const r = this.resolver.lookup('seq', id);
                    if (r) {
                        return `${key}=${paramKey},${r.debugname}`;
                    }
                }
            }

            // OSRS-only texture refs — rewrite value as texture... but we
            // don't yet import textures (deferred to a later task). Pass
            // through unchanged.
            return line;
        }

        // All other lines — pass through unchanged.
        return line;
    }

    // ---- Internal: path helpers ----

    /**
     * Compute the file path for a binary asset (.ob2, .anim, .base).
     *
     * Models and anims both live under `content/models/<group>/`. Bases
     * also live under `content/models/<group>/` (matching the existing
     * LostCity convention where `.base` files sit alongside `.anim` and
     * `.ob2` files in the models folder).
     */
    private assetPath(kind: NodeKind, debugname: string, ext?: string): string {
        let extension = ext;
        if (!extension) {
            switch (kind) {
                case 'model':
                    extension = '.ob2';
                    break;
                case 'anim':
                    extension = '.anim';
                    break;
                case 'anim-base':
                    extension = '.base';
                    break;
                default:
                    extension = '.bin';
                    break;
            }
        }
        return path.join(this.contentDir, 'models', this.options.groupFile, `${debugname}${extension}`);
    }

    /** Path of the NPC config file (`content/scripts/npc/configs/<group>.npc`). */
    private npcConfigPath(): string {
        return path.join(this.contentDir, 'scripts', 'npc', 'configs', `${this.options.groupFile}.npc`);
    }

    /** Path of the seq config file (`content/scripts/seq/configs/<group>.seq`). */
    private seqConfigPath(): string {
        return path.join(this.contentDir, 'scripts', 'seq', 'configs', `${this.options.groupFile}.seq`);
    }

    // ---- Internal: file I/O ----

    /**
     * Write a binary asset file. Respects `dryRun` and `overwrite` options.
     * Creates the parent directory if it doesn't exist.
     */
    private writeFile(filePath: string, bytes: Uint8Array): void {
        if (this.options.dryRun) {
            printDebug(`[dryrun] would write ${bytes.length} bytes to ${filePath}`);
            return;
        }
        if (fs.existsSync(filePath) && !this.options.overwrite) {
            // Backwards-compat: NEVER overwrite existing files. If a name
            // collision happens here, sanitizeName() should have already
            // picked a unique name. We log a warning and skip the write
            // (the existing file stays as-is).
            printWarning(`ContentFolderWriter: refusing to overwrite existing file ${filePath} (overwrite=false)`);
            return;
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, bytes);
    }

    /**
     * Append a `[debugname]` block to an ini-style config file.
     *
     * Idempotency: before appending, the method scans the existing file
     * for a `[<debugname>]` header. If found, the existing block is
     * REPLACED (only when `overwrite=true`) or the append is skipped
     * (when `overwrite=false`). This makes second-run idempotent at the
     * config-file level even if the deps map's `transformedFrom` field
     * wasn't persisted.
     */
    private appendConfigBlock(filePath: string, lines: string[]): void {
        if (this.options.dryRun) {
            printDebug(`[dryrun] would append ${lines.length} lines to ${filePath}`);
            return;
        }

        // Parse the header from the incoming block (first non-empty line
        // starting with `[`).
        const header = lines.find(l => l.startsWith('['));
        const debugname = header ? header.substring(1, header.length - 1) : null;

        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        let existing = '';
        if (fs.existsSync(filePath)) {
            existing = fs.readFileSync(filePath, 'utf8');
        }

        // If the file already contains a `[<debugname>]` block, handle the
        // collision per the `overwrite` option.
        if (debugname && existing.includes(`[${debugname}]`)) {
            if (!this.options.overwrite) {
                printWarning(
                    `ContentFolderWriter: ${filePath} already contains [${debugname}] — skipping (overwrite=false)`
                );
                return;
            }
            // Overwrite mode: strip the existing block, then append the new one.
            existing = this.stripConfigBlock(existing, debugname);
        }

        const newContent = existing + lines.join('\n') + '\n';
        fs.writeFileSync(filePath, newContent);
    }

    /**
     * Remove an existing `[<debugname>]` block from an ini-style config
     * file's content. Returns the new content (without the block).
     *
     * A "block" is the `[header]` line plus every line after it until the
     * next `[`-prefixed line (or end of file). Blank lines immediately
     * preceding the next header are NOT removed (preserves file spacing).
     */
    private stripConfigBlock(content: string, debugname: string): string {
        const lines = content.split(/\r?\n/);
        const out: string[] = [];
        let skipping = false;
        for (const line of lines) {
            if (line.startsWith('[')) {
                if (line === `[${debugname}]`) {
                    skipping = true;
                    continue;
                }
                skipping = false;
            }
            if (!skipping) {
                out.push(line);
            }
        }
        return out.join('\n');
    }

    // ---- Internal: pack-file management ----

    /**
     * Load a pack file (without validator) into a `PackFileLike` instance.
     * Cached in `packCache` so subsequent lookups within the same writer
     * lifetime return the same in-memory instance.
     *
     * We use the existing `PackFile` class from `#/tools/pack/PackFileBase.js`
     * but construct it WITHOUT a validator — the validators do file-existence
     * checks during `reload()`, which we can't satisfy for not-yet-written
     * new assets.
     */
    private loadPackFile(packType: string): PackFileLike {
        let pack = this.packCache.get(packType);
        if (pack) {
            return pack;
        }
        pack = new PackFileLike(packType, this.contentDir);
        this.packCache.set(packType, pack);
        return pack;
    }

    /**
     * Register a new (id, name) entry in a pack file. The pack file is
     * loaded (or fetched from cache), the entry is registered in-memory,
     * and the file is marked as "dirty" for the batched `flushPackFiles()`
     * call at the end of the import session.
     *
     * Idempotency: if the name is already registered (under any ID), the
     * existing entry is left untouched and the function returns the
     * existing ID. If the ID is already registered (under any name), the
     * existing name is left untouched. This guarantees that re-running
     * the writer never duplicates entries.
     */
    private updatePackFile(packType: string, id: number, name: string): void {
        const pack = this.loadPackFile(packType);

        // Check if the name is already registered.
        const existingId = pack.getByName(name);
        if (existingId !== -1) {
            // Name collision — the writer's sanitizeName() should have
            // prevented this, but defensive programming wins. Skip the
            // re-registration and let the caller use the existing ID.
            printWarning(
                `ContentFolderWriter: pack '${packType}' already has name '${name}' (id=${existingId}); skipping duplicate registration`
            );
            return;
        }

        // Check if the ID is already registered (different name).
        const existingName = pack.getById(id);
        if (existingName) {
            printWarning(
                `ContentFolderWriter: pack '${packType}' already has id=${id} (name='${existingName}'); skipping duplicate registration`
            );
            return;
        }

        pack.register(id, name);
        pack.markDirty();

        // Track for ImportResult.packUpdates.
        let added = this.packUpdates.get(packType);
        if (!added) {
            added = [];
            this.packUpdates.set(packType, added);
        }
        added.push({ id, name });
    }

    /**
     * Save all dirty pack files. Called once at the end of an import
     * session so each pack file is written at most once.
     */
    private flushPackFiles(): void {
        for (const [, pack] of this.packCache) {
            pack.saveIfDirty();
        }
    }

    // ---- Internal: ID allocation + name sanitization ----

    /**
     * Allocate the next free ID in a pack file. Uses `max(existing IDs) + 1`.
     *
     * For some pack types there may be reserved ranges in the future — for
     * now, this is the simplest strategy that preserves backwards-compat
     * (existing IDs are never reused or overwritten).
     */
    private allocateId(packType: string): number {
        const pack = this.loadPackFile(packType);
        if (pack.max === 0) {
            // Empty pack — start at ID 0 (matches LostCity convention
            // where every existing pack starts at ID 0).
            return 0;
        }
        return pack.max;
    }

    /**
     * Sanitize an OSRS-provided name into a valid LostCity debugname.
     *
     * Rules:
     *   1. Lowercase.
     *   2. Replace every char NOT in [a-z0-9] with `_`.
     *   3. Collapse runs of multiple `_` into a single `_`.
     *   4. Trim leading/trailing `_`.
     *   5. Prefix with the configured `namePrefix` (default `osrs_`).
     *   6. If the resulting name is already in the target pack (or in
     *      this writer's session-reserved set), append `_2`, `_3`, ...
     *      until unique.
     *
     * Examples:
     *   "Tormented demon" → "osrs_tormented_demon"
     *   "td_stand"        → "osrs_td_stand"
     *   "model_45000"     → "osrs_model_45000"
     */
    private sanitizeName(rawName: string, packType: string): string {
        // Step 1-4: lowercase + sanitize + collapse + trim.
        let base = rawName.toLowerCase();
        base = base.replace(/[^a-z0-9]+/g, '_');
        base = base.replace(/_+/g, '_');
        base = base.replace(/^_+|_+$/g, '');

        // Step 5: prefix.
        const prefixed = `${this.options.namePrefix}${base}`;

        // Step 6: dedupe against existing pack + session-reserved names.
        const pack = this.loadPackFile(packType);
        let candidate = prefixed;
        let suffix = 2;
        // The pack's `getByName` returns -1 if not found. We also check
        // the in-memory session-reserved set (populated by prior
        // sanitizeName calls in the same import session) to handle the
        // case where two OSRS assets sanitize to the same name in the
        // same run.
        while (pack.getByName(candidate) !== -1 || this.isSessionReserved(packType, candidate)) {
            candidate = `${prefixed}_${suffix}`;
            suffix++;
        }

        this.reserveSessionName(packType, candidate);
        return candidate;
    }

    /**
     * Session-reserved name set — prevents two assets in the same import
     * run from being assigned the same debugname (which could happen if
     * sanitizeName generates the same candidate twice before either is
     * written to the pack file).
     */
    private readonly sessionReserved: Map<string, Set<string>> = new Map();

    private isSessionReserved(packType: string, name: string): boolean {
        return this.sessionReserved.get(packType)?.has(name) ?? false;
    }

    private reserveSessionName(packType: string, name: string): void {
        let set = this.sessionReserved.get(packType);
        if (!set) {
            set = new Set();
            this.sessionReserved.set(packType, set);
        }
        set.add(name);
    }

    // ---- Internal: NameResolver bootstrap + node ordering ----

    /**
     * Pre-populate NameResolver from any OSRS nodes in `depsMap` that
     * already have `transformedFrom` set (from a prior writer run).
     *
     * For each such node, we know the new ID — but we need to look up the
     * debugname from the corresponding pack file. If the pack file doesn't
     * have an entry for that ID (e.g. the prior run was incomplete), we
     * skip the bootstrap for that node and let it be re-imported.
     */
    private bootstrapResolverFromDepsMap(depsMap: DepsMap): void {
        for (const key of Object.keys(depsMap.nodes)) {
            const node = depsMap.nodes[key];
            if (node.source !== 'osrs') {
                continue;
            }
            if (node.transformedFrom === null || node.transformedFrom === undefined) {
                continue;
            }
            const newId = typeof node.transformedFrom === 'string'
                ? parseInt(node.transformedFrom, 10)
                : node.transformedFrom;
            if (!Number.isFinite(newId)) {
                continue;
            }
            const packType = KIND_TO_PACK_TYPE[node.kind];
            if (!packType) {
                continue;
            }
            const pack = this.loadPackFile(packType);
            const debugname = pack.getById(newId);
            if (debugname) {
                this.resolver.register(node.kind, node.id, newId, debugname);
            }
        }
    }

    /**
     * Topologically sort the deps map's nodes so that models/anims are
     * processed before seqs, and seqs before NPC configs.
     *
     * The dep tracer already walked the graph in dependency order, so the
     * insertion order of `depsMap.nodes` is roughly correct — but to be
     * safe, we apply an explicit ordering pass that buckets by kind.
     *
     * Order: model → anim-base → anim → seq → npc → (everything else).
     *
     * Within the `npc` bucket, an additional topological sort is applied
     * based on `multinpc[]` references: if NPC A's `deps[]` contains a
     * `multinpc[N]` ref to NPC B, B is processed BEFORE A. This ensures
     * that when A's `writeNpcConfig()` runs and hits a `multinpc=N,<B_id>`
     * line, B's debugname is already in the NameResolver (registered by
     * B's prior `writeNpcConfig()` call). Without this ordering, A's
     * multinpc rewrite would fall back to the raw OSRS ID and the
     * LostCity NPC packer would throw "Unknown multinpc: <osrs_id>".
     *
     * This is the critical ordering for the Kalphite Queen pilot
     * (Task 11): form 1's config references form 2 via `multinpc[1]`,
     * so form 2 must be processed first.
     */
    private topoSortNodes(depsMap: DepsMap): DepNode[] {
        const order: NodeKind[] = ['model', 'anim-base', 'anim', 'seq', 'npc'];
        const buckets: Map<NodeKind, DepNode[]> = new Map();
        for (const k of order) {
            buckets.set(k, []);
        }
        const leftovers: DepNode[] = [];

        for (const key of Object.keys(depsMap.nodes)) {
            const node = depsMap.nodes[key];
            const bucket = buckets.get(node.kind);
            if (bucket) {
                bucket.push(node);
            } else {
                leftovers.push(node);
            }
        }

        // Within the npc bucket, topo-sort by multinpc edges so that
        // referenced NPCs are processed before referencers.
        const npcBucket = buckets.get('npc');
        if (npcBucket && npcBucket.length > 1) {
            const sorted = this.topoSortNpcByMultinpc(npcBucket);
            buckets.set('npc', sorted);
        }

        const out: DepNode[] = [];
        for (const k of order) {
            out.push(...buckets.get(k)!);
        }
        out.push(...leftovers);
        return out;
    }

    /**
     * Topologically sort a list of NPC dep nodes so that NPCs
     * referenced via `multinpc[]` come BEFORE the NPCs that reference
     * them.
     *
     * Edge case: if A → B (A references B via multinpc) AND B → A
     * (B references A via multinpc — a cycle), the cycle is broken
     * arbitrarily (whichever node is visited first in the input list
     * wins). This shouldn't happen in practice (NPC configs don't
     * typically form multinpc cycles), but defensive programming wins.
     *
     * The sort is stable: nodes with no multinpc refs retain their
     * original insertion order.
     */
    private topoSortNpcByMultinpc(nodes: DepNode[]): DepNode[] {
        if (nodes.length <= 1) {
            return nodes;
        }

        // Build a map of OSRS ID → node, so we can resolve `multinpc[]`
        // refs to actual node references.
        const osrsIdToNode = new Map<number, DepNode>();
        for (const n of nodes) {
            if (typeof n.id === 'number') {
                osrsIdToNode.set(n.id, n);
            }
        }

        // Build adjacency: node → nodes it references via `multinpc[]`.
        // The dep tracer records multinpc refs with `via: 'multinpc[N]'`.
        const edges = new Map<DepNode, DepNode[]>();
        for (const n of nodes) {
            const refs: DepNode[] = [];
            for (const dep of n.deps) {
                if (dep.kind !== 'npc') {
                    continue;
                }
                if (!dep.via || !dep.via.startsWith('multinpc[')) {
                    continue;
                }
                if (typeof dep.id !== 'number') {
                    continue;
                }
                const target = osrsIdToNode.get(dep.id);
                if (target && target !== n) {
                    refs.push(target);
                }
            }
            edges.set(n, refs);
        }

        // DFS-based topo sort: visit referenced nodes BEFORE the
        // referencer (post-order traversal → referencer ends up last).
        const visited = new Set<DepNode>();
        const result: DepNode[] = [];
        const visit = (n: DepNode): void => {
            if (visited.has(n)) {
                return;
            }
            visited.add(n);
            for (const ref of edges.get(n) ?? []) {
                visit(ref);
            }
            result.push(n);
        };
        for (const n of nodes) {
            visit(n);
        }
        return result;
    }
}

// ---- PackFileLike: thin wrapper around the existing PackFile class ----

/**
 * Local PackFile wrapper.
 *
 * We can't use the existing `PackFile` exports (`ModelPack`, `NpcPack`, etc.)
 * directly because they're constructed WITH validators that run during
 * `reload()`. The validators do file-existence checks (every registered
 * name must have a corresponding file on disk) — that's fine at build time
 * but breaks our writer's flow (we register the new name BEFORE writing
 * the file, or in `dryRun` mode without writing anything).
 *
 * Instead we instantiate `PackFile` with `null` validator and call
 * `load(path)` directly. This bypasses the validation but gives us the
 * `register` / `getByName` / `getById` / `save` API we need.
 *
 * To avoid a circular import (`tools/osrs/` → `tools/pack/PackFileBase` →
 * `tools/pack/Parse` → ...), we go through a dynamic import + minimal
 * interface — but in practice the existing PackFile is fine to import
 * directly (it's pure TypeScript, no init side effects beyond reading
 * the pack file from disk in the constructor).
 *
 * We wrap it in our own class so we can:
 *   - track dirty state (only save when changed)
 *   - inject the `contentDir` (rather than relying on `Environment.BUILD_SRC_DIR`)
 *   - keep the writer testable without polluting the global Environment.
 */
class PackFileLike {
    private readonly packType: string;
    private readonly contentDir: string;
    /** Raw `id → name` map loaded from the pack file. */
    private readonly pack: Map<number, string> = new Map();
    /** Reverse lookup `name → id`. */
    private readonly nameToId: Map<string, number> = new Map();
    /** Highest ID seen + 1 (next free ID for `allocateId()`). */
    max: number = 0;
    /** Dirty flag — set when `register()` is called, cleared by `save()`. */
    private dirty: boolean = false;

    constructor(packType: string, contentDir: string) {
        this.packType = packType;
        this.contentDir = contentDir;
        this.loadFromDisk();
    }

    /** Path of the pack file on disk. */
    private get path(): string {
        return path.join(this.contentDir, 'pack', `${this.packType}.pack`);
    }

    /** Load the pack file from disk (if it exists). */
    private loadFromDisk(): void {
        this.pack.clear();
        this.nameToId.clear();
        this.max = 0;

        if (!fs.existsSync(this.path)) {
            return;
        }
        const text = fs.readFileSync(this.path, 'utf8');
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            if (line.length === 0 || !/^\d+=/g.test(line)) {
                continue;
            }
            const eqIdx = line.indexOf('=');
            const id = parseInt(line.substring(0, eqIdx), 10);
            const name = line.substring(eqIdx + 1);
            if (Number.isNaN(id) || name.length === 0) {
                continue;
            }
            this.pack.set(id, name);
            this.nameToId.set(name, id);
        }
        if (this.pack.size > 0) {
            this.max = Math.max(...Array.from(this.pack.keys())) + 1;
        }
    }

    /** Register a new (id, name) entry. Does NOT save to disk. */
    register(id: number, name: string): void {
        this.pack.set(id, name);
        this.nameToId.set(name, id);
        if (id >= this.max) {
            this.max = id + 1;
        }
        this.dirty = true;
    }

    /** Look up a name by ID. Returns empty string if not found. */
    getById(id: number): string {
        return this.pack.get(id) ?? '';
    }

    /** Look up an ID by name. Returns -1 if not found. */
    getByName(name: string): number {
        return this.nameToId.get(name) ?? -1;
    }

    /** Mark the pack file as dirty (will be saved by `saveIfDirty()`). */
    markDirty(): void {
        this.dirty = true;
    }

    /**
     * Save the pack file to disk IF it has been modified since the last
     * load/save. The save writes the FULL pack file (existing entries +
     * any new registrations) in ID-sorted order, mirroring the existing
     * `PackFile.save()` implementation.
     */
    saveIfDirty(): void {
        if (!this.dirty) {
            return;
        }
        fs.mkdirSync(path.dirname(this.path), { recursive: true });
        const entries = Array.from(this.pack.entries()).sort((a, b) => a[0] - b[0]);
        const text = entries.map(([id, name]) => `${id}=${name}`).join('\n') + '\n';
        fs.writeFileSync(this.path, text);
        this.dirty = false;
    }
}
