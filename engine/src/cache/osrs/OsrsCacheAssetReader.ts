import Packet from '#/io/Packet.js';
import { genHash } from '#/io/Jagfile.js';
import { printWarning } from '#/util/Logger.js';
import AnimBase from '#/cache/graphics/AnimBase.js';
import OsrsModel from '#/cache/osrs/OsrsModel.js';
import OsrsAnimFrame from '#/cache/osrs/OsrsAnimFrame.js';
import OsrsSeqType from '#/cache/osrs/OsrsSeqType.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import StructType from '#/cache/config/StructType.js';

import OsrsCacheReader from './OsrsCacheReader.js';
import { CacheReader } from '#tools/osrs/DependencyTracer.js';
import { NodeKind } from '#tools/osrs/DepsSchema.js';

/**
 * JS5 archive index map used by `OsrsCacheAssetReader`.
 *
 * The OSRS cache (post-rev ~150 era) uses this layout. Different cache
 * revisions sometimes shuffle the higher indices, but 0/1/9 are stable
 * across all modern dumps:
 *
 * | Archive | Contents |
 * |---------|----------|
 * | 0       | Animations (frames AND skeletons, disjoint file IDs) |
 * | 1       | Models (one .ob2 per file ID) |
 * | 2       | Music (jagfile-style bundle) — older OSRS dumps use this for config too |
 * | 3       | Midi |
 * | 4       | Maps |
 * | 5       | Templates (older) / Textures (modern) |
 * | 6       | Bitmaps / Fonts |
 * | 7       | Audio / Graphics |
 * | 8       | Worldmap / Fonts |
 * | 9       | Configs (multi-child bundle: 'npc.dat', 'seq.dat', etc.) — modern OSRS |
 * | 10      | Media / Lores |
 * | 11      | Textures (modern) |
 * | 12      | Interfaces |
 * | 13      | Scripts |
 * | 14      | Shapes |
 * | 15      | Varp |
 * | 16      | Varbit |
 * | 17      | Widget |
 * | 18      | Enum |
 * | 19      | NPC config (modern per-type archive; supersedes archive 9 npc.dat child) |
 * | 20      | Obj config (modern per-type) |
 * | 21      | Struct config (modern per-type) |
 * | 22      | Seq config (modern per-type) |
 * | 23      | Spotanim |
 * | 24      | Bitmap |
 * | 25      | Audio (synth sound effects) |
 * | 26      | Mapframe |
 *
 * The reader tries archive 9 first for the config bundle (modern layout)
 * and falls back to archive 2 (older OSRS / 377-style layout where archive 2
 * holds the config bundle).
 */
const ARCHIVE_ANIMATIONS = 0;
const ARCHIVE_MODELS = 1;
const ARCHIVE_CONFIG_PRIMARY = 9;
const ARCHIVE_CONFIG_FALLBACK = 2;
const ARCHIVE_TEXTURES_PRIMARY = 11;
const ARCHIVE_TEXTURES_FALLBACK = 5;
// Sounds live in archive 25 in modern OSRS caches. Not currently read — see
// `readSound()` stub below. Kept here for documentation / future use.
// const ARCHIVE_SOUNDS = 25;

/**
 * Known config-file child names that live inside the config archive
 * (archive 9 modern / archive 2 older). Used by `ensureConfigChildren()` to
 * resolve numeric child IDs → names via the master index's per-child name
 * hashes.
 *
 * Order matters for the fallback path: if name-hash resolution fails (master
 * index without name hashes), children are assigned names sequentially in
 * this order.
 */
const CONFIG_CHILD_NAMES: readonly string[] = [
    'npc.dat', 'npc.idx',
    'seq.dat', 'seq.idx',
    'obj.dat', 'obj.idx',
    'param.dat', 'param.idx',
    'struct.dat', 'struct.idx',
    'varp.dat', 'varp.idx',
    'varbit.dat', 'varbit.idx',
    'idk.dat', 'idk.idx',
    'loc.dat', 'loc.idx',
    'flo.dat', 'flo.idx',
    'spotanim.dat', 'spotanim.idx',
    'mesanim.dat', 'mesanim.idx',
    'hunt.dat', 'hunt.idx',
    'enum.dat', 'enum.idx'
];

/**
 * OSRS CacheReader implementation for the dependency tracer (Task 6).
 *
 * Wraps an `OsrsCacheReader` (the low-level JS5 reader) and decodes each
 * asset type using the OSRS decoders from tasks 5-a/5-b/5-c. The decoded
 * configs are cached in their respective static registries
 * (`OsrsNpcType.configs[]`, `OsrsSeqType.configs[]`, etc.) so repeated
 * `readXxx(id)` calls are O(1).
 *
 * Every method returns `null` on missing IDs — never throws. This matches
 * the `CacheReader` contract documented in `tools/osrs/DependencyTracer.ts`:
 * the tracer records null returns as `missing: true` dep refs.
 */
export default class OsrsCacheAssetReader implements CacheReader {
    /** Low-level JS5 reader (handles sector walking + container decompression). */
    private readonly cache: OsrsCacheReader;

    /**
     * Lazily-loaded config archive children.
     *
     * Keyed by child name (e.g. 'npc.dat', 'seq.dat'). The whole multi-child
     * group is decompressed + split ONCE on first `readNpc` / `readSeq` /
     * `readObj` / `readParam` / `readStruct` call.
     */
    private configChildren: Map<string, Uint8Array> | null = null;

    /** Archive ID the config bundle was actually loaded from (9 or 2). */
    private configArchiveUsed: number = -1;

    /** Per-config-type "have we parsed the .dat yet?" flags. */
    private npcParsed: boolean = false;
    private seqParsed: boolean = false;
    private objParsed: boolean = false;
    private paramParsed: boolean = false;
    private structParsed: boolean = false;

    constructor(cacheDir: string) {
        this.cache = new OsrsCacheReader(cacheDir);
    }

    /** Expose the underlying reader for direct archive access (e.g. by tooling). */
    get raw(): OsrsCacheReader {
        return this.cache;
    }

    /** True if the cache directory was opened successfully. */
    get available(): boolean {
        return this.cache.isAvailable;
    }

    // ---- CacheReader implementation ----

    /** OSRS model blob (archive 1). */
    readModel(id: number): OsrsModel | null {
        const data = this.cache.read(ARCHIVE_MODELS, id);
        if (!data) {
            return null;
        }
        return OsrsModel.decode(id, data);
    }

    /**
     * OSRS animation frame (archive 0 file `id`).
     *
     * The frame blob's trailing 2 bytes encode its base (skeleton) ID. We
     * peek those, lazily load the AnimBase if needed, then call
     * `OsrsAnimFrame.decode()`.
     */
    readAnim(id: number): OsrsAnimFrame | null {
        const data = this.cache.read(ARCHIVE_ANIMATIONS, id);
        if (!data || data.length < 2) {
            return null;
        }

        // Peek trailing 2-byte base ID.
        const trailer = new Packet(data);
        trailer.pos = data.length - 2;
        const baseId = trailer.g2();

        // Lazily load the base if not yet registered. `OsrsAnimFrame.decode`
        // bails with a warning when `AnimBase.instances[baseId]` is missing.
        if (!AnimBase.instances[baseId]) {
            this.loadAnimBase(baseId);
        }

        return OsrsAnimFrame.decode(data, baseId);
    }

    /**
     * OSRS animation skeleton (archive 0 file `id`).
     *
     * OSRS stores skeletons in the SAME archive as frames (archive 0), with
     * file IDs that don't collide with frame IDs (assigned from disjoint
     * pools by Jagex's build pipeline). This is a simplification — some OSRS
     * cache revisions use a separate skeleton archive; if the base isn't at
     * archive 0 file `id`, this returns null.
     *
     * The skeleton format is byte-identical to 377 (same `u8 length`,
     * `u8[] types`, `u8[][] labels` layout), so we parse it inline and
     * register it in `AnimBase.instances[id]` for `OsrsAnimFrame.decode()` to
     * find.
     */
    readAnimBase(id: number): AnimBase | null {
        if (AnimBase.instances[id]) {
            return AnimBase.instances[id];
        }
        return this.loadAnimBase(id);
    }

    /** OSRS sequence config (seq.dat entry). */
    readSeq(id: number): OsrsSeqType | null {
        if (!this.seqParsed) {
            this.parseSeqConfigs();
            this.seqParsed = true;
        }
        return OsrsSeqType.configs[id] ?? null;
    }

    /** OSRS NPC config (npc.dat entry). */
    readNpc(id: number): OsrsNpcType | null {
        if (!this.npcParsed) {
            this.parseNpcConfigs();
            this.npcParsed = true;
        }
        return OsrsNpcType.configs[id] ?? null;
    }

    /**
     * Item config (obj.dat entry).
     *
     * For now this returns a STUB `ObjType` with only the ID populated — the
     * legacy `ObjType.decode()` calls `printFatalError` (which terminates
     * the process via `process.exit(1)`) on unrecognized opcodes, and OSRS
     * obj configs use opcodes the 377 decoder doesn't know. The dep tracer
     * treats objs as leaves anyway (see task 6 worklog entry: "ObjType deep
     * walk is stubbed"). When `OsrsObjType` is ported (task 8+), swap this
     * to decode properly.
     */
    readObj(id: number): ObjType | null {
        if (!this.objParsed) {
            // Don't actually parse — just mark as "parsed" so we don't retry.
            // Loading the obj.dat child here would let us populate the
            // debugname at least, but until OsrsObjType is ported there's
            // no safe decoder to run on the bytes.
            this.objParsed = true;
        }
        if (!this.cache.isAvailable) {
            return null;
        }
        // Return a stub. Callers that need fields should wait for OsrsObjType.
        return new ObjType(id);
    }

    /**
     * Param type.
     *
     * Returns null — `OsrsParamType` isn't ported yet, and the legacy
     * `ParamType.decode()` throws on unrecognized opcodes (OSRS params use
     * a few new codes). The dep tracer falls back to `ParamType.get(id)`
     * (the legacy 377 static registry) when this returns null, which is the
     * documented behavior in the task 6 worklog.
     */
    readParam(_id: number): ParamType | null {
        if (!this.paramParsed) {
            this.paramParsed = true;
        }
        // Intentionally null — see method doc. The tracer's `visitParam`
        // falls back to `ParamType.get(id)` when this returns null.
        return null;
    }

    /**
     * Struct config.
     *
     * Same caveat as `readParam`: the legacy `StructType.decode()` throws
     * on unrecognized opcodes, and `OsrsStructType` isn't ported. Returns
     * null to let the tracer fall back to `StructType.get(id)`.
     */
    readStruct(_id: number): StructType | null {
        if (!this.structParsed) {
            this.structParsed = true;
        }
        return null;
    }

    /** Texture image bytes (OSRS archive 11, fallback archive 5). */
    readTexture(id: number): Uint8Array | null {
        let data = this.cache.read(ARCHIVE_TEXTURES_PRIMARY, id);
        if (!data) {
            data = this.cache.read(ARCHIVE_TEXTURES_FALLBACK, id);
        }
        return data;
    }

    /**
     * OSRS particle system bytes.
     *
     * Stub — OSRS particle systems are stored in a sub-archive of the scripts
     * archive (archive 13) and the layout is undocumented. Returns null until
     * a proper particle decoder is ported.
     */
    readParticle(_id: number): Uint8Array | null {
        // TODO: port OSRS particle decoder and read from archive 13 sub-archive.
        return null;
    }

    /**
     * Sound effect bytes (synth or midi).
     *
     * Stub — OSRS sound effects live in archive 25 (audio) but the per-file
     * format varies (synth patches vs. raw PCM vs. midi containers). Returns
     * null until a proper sound decoder is ported. The dep tracer records
     * this as a missing leaf, which is fine for the pilot.
     */
    readSound(_id: number): Uint8Array | null {
        // TODO: port OSRS sound decoder and read from archive 25.
        return null;
    }

    /**
     * Optional debugname lookup.
     *
     * Best-effort: consults the OSRS-side registries (OsrsNpcType.configs,
     * OsrsSeqType.configs) when populated, and falls back to the legacy 377
     * pack files for obj/param/struct/model/anim names. Returns null if no
     * name is known.
     */
    getName(kind: NodeKind, id: number | string): string | null {
        if (typeof id === 'string') {
            // Scripts use debugname-as-id; the name IS the id.
            return id;
        }

        switch (kind) {
            case 'npc': {
                const npc = OsrsNpcType.configs[id];
                return npc?.debugname ?? npc?.name ?? null;
            }
            case 'seq': {
                const seq = OsrsSeqType.configs[id];
                return seq?.debugname ?? null;
            }
            case 'obj': {
                // Legacy 377 pack file lookup — loaded only after `ObjType.load()`.
                const obj = ObjType.get(id);
                return obj?.debugname ?? null;
            }
            case 'param': {
                const param = ParamType.get(id);
                return param?.debugname ?? null;
            }
            case 'struct': {
                const struct = StructType.get(id);
                return struct?.debugname ?? null;
            }
            default:
                // model/anim/anim-base/texture/particle/sound don't carry
                // debugnames in the OSRS cache — they're referenced by ID.
                // The content folder's pack files (model.pack, anim.pack)
                // are the source of truth for those names; deferred to
                // task 8.
                return null;
        }
    }

    // ---- Internal helpers ----

    /**
     * Load the config archive (archive 9, fallback archive 2) and split it
     * into named children. Cached in `this.configChildren` for the lifetime
     * of the reader.
     */
    private ensureConfigChildren(): Map<string, Uint8Array> {
        if (this.configChildren !== null) {
            return this.configChildren;
        }

        this.configChildren = new Map();
        if (!this.cache.isAvailable) {
            return this.configChildren;
        }

        // Try archive 9 first (modern OSRS), then archive 2 (older layout).
        for (const archiveId of [ARCHIVE_CONFIG_PRIMARY, ARCHIVE_CONFIG_FALLBACK]) {
            // The config bundle is a single multi-child group at file 0.
            const result = this.cache.readArchive(archiveId, 0);
            if (!result || result.children.size === 0) {
                continue;
            }

            // Resolve numeric child IDs → names via the master index's per-child
            // name hashes. We pre-compute genHash(name) for every entry in
            // Jagfile.KNOWN_NAMES (which includes 'npc.dat', 'seq.dat', etc.)
            // and match against the master index entry's childNameHashes.
            const named = new Map<string, Uint8Array>();
            const masterEntry = this.cache
                .readIndex255()
                .find(e => e.archive === archiveId);

            // Build a lookup table: nameHash → childIndex in masterEntry.
            const hashToChildId = new Map<number, number>();
            if (masterEntry) {
                for (let i = 0; i < masterEntry.childCount; i++) {
                    const h = masterEntry.childNameHashes[i];
                    if (h !== 0) {
                        hashToChildId.set(h, masterEntry.childIds[i]);
                    }
                }
            }

            // For each known config file name, try to resolve via name hash.
            for (const name of CONFIG_CHILD_NAMES) {
                const hash = genHash(name);
                const childId = hashToChildId.get(hash);
                if (childId !== undefined) {
                    const data = result.children.get(childId);
                    if (data) {
                        named.set(name, data);
                    }
                }
            }

            // Fallback: for any children we didn't resolve by name (e.g. when
            // the master index doesn't have name hashes), fall back to a
            // sequential-name assignment based on child index. This is a
            // best-effort guess — correctness depends on the cache revision
            // following the standard child ordering.
            if (named.size === 0 && result.children.size > 0) {
                const childIds = Array.from(result.children.keys()).sort((a, b) => a - b);
                for (let i = 0; i < childIds.length && i < CONFIG_CHILD_NAMES.length; i++) {
                    const name = CONFIG_CHILD_NAMES[i];
                    const data = result.children.get(childIds[i]);
                    if (data && !named.has(name)) {
                        named.set(name, data);
                    }
                }
            }

            this.configChildren = named;
            this.configArchiveUsed = archiveId;
            return this.configChildren;
        }

        // No config archive found — cache an empty map so we don't retry.
        printWarning('OsrsCacheAssetReader: no config archive found (tried 9 and 2)');
        return this.configChildren;
    }

    /** Look up a named child from the config archive (returns null if absent). */
    private readConfigChild(name: string): Uint8Array | null {
        const children = this.ensureConfigChildren();
        return children.get(name) ?? null;
    }

    /**
     * Parse all NPC configs from the 'npc.dat' child of the config archive.
     * Populates `OsrsNpcType.configs[]` + `OsrsNpcType.configNames`.
     */
    private parseNpcConfigs(): void {
        const dat = this.readConfigChild('npc.dat');
        if (!dat) {
            return;
        }

        OsrsNpcType.configNames = new Map();
        OsrsNpcType.configs = [];

        const packet = new Packet(dat);
        if (packet.available < 2) {
            printWarning('OsrsCacheAssetReader: npc.dat too short for count');
            return;
        }
        const count = packet.g2();

        for (let id = 0; id < count; id++) {
            const config = new OsrsNpcType(id);
            try {
                config.decodeType(packet);
                config.postDecode();
            } catch (err) {
                printWarning(
                    `OsrsCacheAssetReader: npc ${id} decode failed: ${(err as Error).message}`
                );
            }
            OsrsNpcType.configs[id] = config;
            if (config.debugname) {
                OsrsNpcType.configNames.set(config.debugname, id);
            }
        }
    }

    /**
     * Parse all seq configs from the 'seq.dat' child of the config archive.
     * Populates `OsrsSeqType.configs[]` + `OsrsSeqType.configNames`.
     */
    private parseSeqConfigs(): void {
        const dat = this.readConfigChild('seq.dat');
        if (!dat) {
            return;
        }

        OsrsSeqType.configNames = new Map();
        OsrsSeqType.configs = [];

        const packet = new Packet(dat);
        if (packet.available < 2) {
            printWarning('OsrsCacheAssetReader: seq.dat too short for count');
            return;
        }
        const count = packet.g2();

        for (let id = 0; id < count; id++) {
            const config = new OsrsSeqType(id);
            try {
                config.decodeType(packet);
                config.postDecode();
            } catch (err) {
                printWarning(
                    `OsrsCacheAssetReader: seq ${id} decode failed: ${(err as Error).message}`
                );
            }
            OsrsSeqType.configs[id] = config;
            if (config.debugname) {
                OsrsSeqType.configNames.set(config.debugname, id);
            }
        }
    }

    /**
     * Load + parse an OSRS AnimBase (skeleton) from archive 0 file `id`.
     * The skeleton format is byte-identical to 377, so we mirror
     * `AnimBase.unpack()` inline (we can't call `unpack()` directly because
     * it pushes onto `instances[]` at the wrong index for out-of-order loads).
     *
     * Returns the loaded AnimBase, or null on missing/invalid data.
     */
    private loadAnimBase(id: number): AnimBase | null {
        const data = this.cache.read(ARCHIVE_ANIMATIONS, id);
        if (!data || data.length < 1) {
            return null;
        }

        const packet = new Packet(data);
        if (packet.available < 1) {
            return null;
        }
        const length = packet.g1();

        const types = new Int32Array(length);
        const labels: Int32Array[] = new Array(length);

        for (let i = 0; i < length; i++) {
            if (packet.available < 1) {
                printWarning(`OsrsCacheAssetReader: AnimBase ${id} truncated (types)`);
                return null;
            }
            types[i] = packet.g1();
        }

        for (let i = 0; i < length; i++) {
            if (packet.available < 1) {
                printWarning(`OsrsCacheAssetReader: AnimBase ${id} truncated (labels)`);
                return null;
            }
            const labelCount = packet.g1();
            const labelArr = new Int32Array(labelCount);
            for (let j = 0; j < labelCount; j++) {
                if (packet.available < 1) {
                    printWarning(`OsrsCacheAssetReader: AnimBase ${id} truncated (label ${j})`);
                    return null;
                }
                labelArr[j] = packet.g1();
            }
            labels[i] = labelArr;
        }

        const base = new AnimBase();
        base.length = length;
        base.types = types;
        base.labels = labels;
        AnimBase.instances[id] = base;
        return base;
    }
}
