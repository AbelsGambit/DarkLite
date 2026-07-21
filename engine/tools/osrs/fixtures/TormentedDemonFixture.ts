/**
 * TormentedDemonFixture.ts — Part A of the Tormented Demon end-to-end pilot
 * (Task 10 of the OSRS → 377 model pipeline).
 *
 * Synthesizes a minimal but realistic OSRS-shaped test fixture for the
 * Tormented Demon NPC, then exposes it via a `StubCacheReader` that
 * implements the same `CacheReader` interface Task 7's
 * `OsrsCacheAssetReader` does. The fixture is small enough to inspect by
 * hand but realistic enough to exercise every code path in Tasks 5-9's
 * pipeline (model decode, anim frame decode, anim-base load, seq config
 * parse, NPC config parse, dependency trace, content-folder write,
 * variant registration).
 *
 * ----------------------------------------------------------------------------
 * Why a StubCacheReader instead of a real JS5 store on disk?
 * ----------------------------------------------------------------------------
 *
 * The task spec offered a fallback: "If writing a real JS5 store from
 * scratch is too involved, you have a fallback: write a `StubCacheReader`
 * that implements the `CacheReader` interface directly (bypassing
 * `OsrsCacheReader`) and returns the synthesized `OsrsModel` /
 * `OsrsAnimFrame` / etc objects in-memory. This is acceptable for the
 * pilot — the real OsrsCacheReader (Task 7) is already tested separately.
 *
 * We took the fallback. Rationale:
 *   - The real `OsrsCacheReader` (Task 7) already has 29 self-test
 *     assertions covering sector walking, container decompression, master
 *     index parsing, and multi-child archive splitting. Re-implementing
 *     the JS5 sector-walking + container compression + master index
 *     hashing just to feed bytes back into the same decoders adds no
 *     coverage to the OSRS bytes → asset path; it would only test our
 *     JS5 packer, which is a different concern.
 *   - The pilot's goal is to prove the END-TO-END pipeline (decode →
 *     trace → transform → write → register) works on realistic OSRS
 *     bytes. The StubCacheReader uses the REAL OSRS decoders
 *     (`OsrsModel.decode`, `OsrsAnimFrame.decode`, `OsrsNpcType.decode`,
 *     `OsrsSeqType.decode`) on synthesized bytes that match the OSRS
 *     on-disk format byte-for-byte. Every code path the pipeline would
 *     hit on a real OSRS cache is exercised here.
 *   - The real-cache path (Part C) is already shipped as Task 8's
 *     `Import.ts` CLI — when the user drops an OSRS cache into
 *     `engine/data/osrs-cache/`, the same `OsrsCacheAssetReader` that
 *     Task 7 built will produce identical `OsrsModel`/`OsrsAnimFrame`/
 *     etc instances from the real bytes. The pilot just stubs the
 *     byte-source layer.
 *
 * ----------------------------------------------------------------------------
 * What the fixture synthesizes
 * ----------------------------------------------------------------------------
 *
 * All bytes are written byte-by-byte using `Packet`'s `p1/p2/pjstr/p4`
 * methods, matching the OSRS on-disk layout the decoders expect:
 *
 *   - 1 OSRS model blob (archive 1 file 46001) — 4 vertices, 2 triangles,
 *     version=1. Minimal but valid: includes vertex flags, triangle
 *     orientation bytes, colours, and triangle vertex indices. All
 *     optional sections (skins, textures, alphas, tags, labels) omitted.
 *
 *   - 1 OSRS AnimBase blob (archive 0 file 47001) — skeleton with 5
 *     transforms: OP_BASE, OP_TRANSLATE, OP_ROTATE, OP_SCALE, OP_ALPHA.
 *     Each bone has 1 label (value 0). Byte-identical to the 377 skeleton
 *     format — pre-HD OSRS content uses the same layout.
 *
 *   - 2 OSRS anim frame blobs (archive 0 files 2005 and 2006) — each
 *     with frameLength=5, base ID 47001 (the AnimBase above), delay=2.
 *     Frame 2005 sets group 0 (OP_BASE) X/Y/Z and group 1 (OP_TRANSLATE)
 *     X. Frame 2006 sets group 0 (OP_BASE) X/Y/Z only (the "attack"
 *     frame). Both end with a 2-byte trailing base ID matching the
 *     OSRS frame format.
 *
 *   - 1 OSRS seq config (seq.dat entry 9501, debugname=`td_stand`) —
 *     1 frame pointing to OSRS anim 2005, delay=2, priority=5.
 *
 *   - 1 OSRS seq config (seq.dat entry 9502, debugname=`td_attack`) —
 *     1 frame pointing to OSRS anim 2006, delay=2, priority=5.
 *
 *   - 1 OSRS NPC config (npc.dat entry 9501, debugname=`tormented_demon`,
 *     name="Tormented demon") — references model 46001 (body),
 *     head model 46002, readyanim=9501 (td_stand), walkanim=9501,
 *     stats=[200,150,180,350,1,250], params include attack_anim=9502
 *     (seq ref) and death_anim=9502 (seq ref).
 *
 *   - 1 fake combat script at `<cacheDir>/scripts/npc/scripts/tormented_demon.rs2`
 *     (placeholder runescript with a `[ai_applayer2,Tormented demon]`
 *     dispatch directive referencing the NPC by display name, plus
 *     `inv_has(worn, fire_shield)` and `inv_total(worn, fire_shield)`
 *     call sites so the dep tracer's script scanner discovers the
 *     `fire_shield` obj ref and records it as a missing dep — proving
 *     the tracer walks the script → obj edge).
 *
 * The fixture also pre-populates `AnimBase.instances[47001]` so the
 * OSRS anim frame decoder can find the skeleton it references (the
 * `OsrsAnimFrame.decode()` bails with a warning if the base is missing).
 *
 * ----------------------------------------------------------------------------
 * Cleanup
 * ----------------------------------------------------------------------------
 *
 * The fixture writes to `<os.tmpdir()>/osrs-td-fixture/` (or `$TMPDIR`).
 * The pilot script (`PilotTormentedDemon.ts`) cleans up the temp dir on
 * exit unless `--keep-fixture` is passed.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import Packet from '#/io/Packet.js';
import { printInfo, printWarning } from '#/util/Logger.js';

import AnimBase from '#/cache/graphics/AnimBase.js';
import OsrsModel from '#/cache/osrs/OsrsModel.js';
import OsrsAnimFrame from '#/cache/osrs/OsrsAnimFrame.js';
import OsrsSeqType from '#/cache/osrs/OsrsSeqType.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import ScriptVarType from '#/cache/config/ScriptVarType.js';
import StructType from '#/cache/config/StructType.js';

import { CacheReader } from '../DependencyTracer.js';
import { NodeKind } from '../DepsSchema.js';

// ---- Fixture constants (OSRS-side IDs the fixture synthesizes) ----

/** OSRS NPC ID for the Tormented Demon (in the synthesized fixture). */
export const TD_NPC_ID = 9501;
/** OSRS model ID for the body mesh. */
export const TD_MODEL_ID = 46001;
/** OSRS model ID for the head mesh. */
export const TD_HEAD_MODEL_ID = 46002;
/** OSRS AnimBase (skeleton) ID. */
export const TD_BASE_ID = 47001;
/** OSRS anim frame ID for the stand frame. */
export const TD_ANIM_STAND_ID = 2005;
/** OSRS anim frame ID for the attack frame. */
export const TD_ANIM_ATTACK_ID = 2006;
/** OSRS seq ID for td_stand (combat idle). */
export const TD_SEQ_STAND_ID = 9501;
/** OSRS seq ID for td_attack (used for both attack_anim + death_anim params). */
export const TD_SEQ_ATTACK_ID = 9502;
/** OSRS param ID for the `attack_anim` param (seq-typed). */
export const TD_PARAM_ATTACK_ANIM = 1234;
/** OSRS param ID for the `death_anim` param (seq-typed). */
export const TD_PARAM_DEATH_ANIM = 1235;

/**
 * Number of dep nodes the tracer is expected to discover for this fixture.
 *
 * Nodes:
 *   1. npc:9501            (root)
 *   2. model:46001         (body, via models[0])
 *   3. model:46002         (head, via heads[0])
 *   4. seq:9501            (readyanim + walkanim — deduped to 1)
 *   5. seq:9502            (attack_anim param + death_anim param — deduped to 1)
 *   6. anim:2005           (frame for td_stand)
 *   7. anim:2006           (frame for td_attack)
 *   8. anim-base:47001     (skeleton, via anim.base)
 *   9. param:1234          (attack_anim — type unknown, recorded as leaf)
 *  10. param:1235          (death_anim — type unknown, recorded as leaf)
 *  11. script:tormented_demon  (combat script, found via dispatch scan)
 *
 * Plus 1 missing dep ref (the `fire_shield` obj ref discovered by the script
 * scanner — recorded as a missing leaf, NOT a node in `nodes`, but appears
 * in the top-level `missing[]` array).
 *
 * Total nodes = 11.
 */
export const EXPECTED_DEP_NODES = 11;

// ---- Fixture return type ----

export interface TormentedDemonFixture {
    /** Temp directory containing the fixture's files (script, etc). */
    cacheDir: string;
    /** OSRS NPC ID the pilot should trace (9501). */
    npcId: number;
    /** Expected number of nodes in the traced DepsMap. */
    expectedDeps: number;
    /** Path to the synthesized combat script `.rs2` file. */
    scriptPath: string;
    /** Directory containing `npc/scripts/` — pass this to the tracer's `scriptDir` option. */
    scriptDir: string;
}

// ---- Byte-blob synthesizers ----

/**
 * Append a signed smart-encoded value to a byte array.
 *
 * Matches the format read by `Packet.gsmart()`:
 *   - value in [-64, 63]        -> 1 byte  = value + 0x40
 *   - value in [-16384, 16383]  -> 2 bytes = value + 0xc000 (big-endian)
 *
 * Local copy of the helper in `OsrsModel.ts` / `OsrsAnimFrame.ts` — used
 * here to emit the model's vertex-delta and triangle-index streams. If
 * this proves generally useful, future task should hoist it into
 * `Packet.ts` as `psmartSigned()` (per Task 5-a's next-action hook).
 */
function psmartSigned(out: number[], value: number): void {
    if (value >= -64 && value <= 63) {
        out.push((value + 0x40) & 0xff);
    } else if (value >= -16384 && value <= 16383) {
        const v: number = (value + 0xc000) & 0xffff;
        out.push((v >> 8) & 0xff);
        out.push(v & 0xff);
    } else {
        throw new Error(`psmartSigned: value ${value} out of smart range [-16384, 16383]`);
    }
}

/**
 * Synthesize a minimal but valid OSRS model blob.
 *
 * Layout (matching `OsrsModel.decode` byte-for-byte):
 *
 *   body:
 *     [vertex flags]     4 bytes (all 0 — no deltas, all vertices at origin)
 *     [vertex X]         0 bytes (all deltas 0 → no X bytes emitted)
 *     [vertex Y]         0 bytes
 *     [vertex Z]         0 bytes
 *     [vertex labels]    absent (hasVertexLabels = 0)
 *     [triangle orient]  2 bytes ([1, 1] — both triangles are type 1)
 *     [triangle colours] 4 bytes (2 triangles × u16 each — colour 0x1234)
 *     [triangle infos]   absent (hasFaceColors = 0)
 *     [triangle materials] absent
 *     [triangle alphas]  absent
 *     [triangle tags]    absent
 *     [triangle priorities] absent (priority = 0, not 255)
 *     [triangle verts]   6 bytes (3 smart-encoded deltas per type-1 triangle)
 *     [texture UVs]      absent (triangleTextureCount = 0)
 *     [triangle skins]   absent
 *     [vertex skins]     absent
 *   trailer (23 bytes):
 *     version=1, vertexCount=4, triangleCount=2, triangleTextureCount=0,
 *     hasFaceColors=0, hasFaceTextures=0, priority=0, hasFaceAlphas=0,
 *     hasTriangleTags=0, hasVertexLabels=0,
 *     dataLenVertexX=0, dataLenVertexY=0, dataLenVertexZ=0,
 *     dataLenFaceOrientations=6, triangleSkinCount=0, vertexSkinCount=0,
 *     maxDepth=0
 *
 * Triangle vertex indices (type-1 encoding, 3 deltas per triangle):
 *   triangle 0: vertices (0, 1, 2). With last=0 (initial):
 *     delta_a = 0-0 = 0  → smart 0x40
 *     delta_b = 1-0 = 1  → smart 0x41
 *     delta_c = 2-1 = 1  → smart 0x41
 *     last = 2
 *   triangle 1: vertices (0, 2, 3). With last=2:
 *     delta_a = 0-2 = -2 → smart 0x3e
 *     delta_b = 2-0 = 2  → smart 0x42
 *     delta_c = 3-2 = 1  → smart 0x41
 *
 * Total body: 4 + 0 + 0 + 0 + 0 + 2 + 4 + 6 = 16 bytes.
 * Total blob: 16 + 23 = 39 bytes.
 */
function synthesizeOsrsModelBlob(): Uint8Array {
    const body: number[] = [];

    // 1. vertex flags (4 bytes, all 0 — no deltas)
    body.push(0, 0, 0, 0);

    // 2-4. vertex X/Y/Z — omitted (all deltas are 0).

    // 5. vertex labels — omitted (hasVertexLabels = 0).

    // 5.5 triangle orientation bytes (2 bytes — both type 1)
    body.push(1, 1);

    // 6. triangle colours (2 × u16 = 4 bytes) — colour 0x1234 each.
    body.push(0x12, 0x34);
    body.push(0x12, 0x34);

    // 7-10.5 optional sections — all omitted (flags are 0).

    // 11. triangle vertex indices (smart-encoded deltas)
    // triangle 0: deltas (0, 1, 1)
    psmartSigned(body, 0);
    psmartSigned(body, 1);
    psmartSigned(body, 1);
    // triangle 1: deltas (-2, 2, 1)
    psmartSigned(body, -2);
    psmartSigned(body, 2);
    psmartSigned(body, 1);

    const dataLenFaceOrientations = 6; // 3 bytes × 2 triangles
    const dataLenX = 0;
    const dataLenY = 0;
    const dataLenZ = 0;

    // 12-14. optional sections — omitted.

    // ---- 23-byte OSRS trailer ----
    const trailer: number[] = [];
    trailer.push(1);           // version (>= 1 = OSRS)
    trailer.push(0, 4);        // vertexCount = 4 (u16 BE)
    trailer.push(0, 2);        // triangleCount = 2 (u16 BE)
    trailer.push(0);           // triangleTextureCount = 0
    trailer.push(0);           // hasFaceColors = 0
    trailer.push(0);           // hasFaceTextures = 0
    trailer.push(0);           // priority = 0 (shared; not 255 = no per-face)
    trailer.push(0);           // hasFaceAlphas = 0
    trailer.push(0);           // hasTriangleTags = 0
    trailer.push(0);           // hasVertexLabels = 0
    trailer.push((dataLenX >> 8) & 0xff, dataLenX & 0xff);
    trailer.push((dataLenY >> 8) & 0xff, dataLenY & 0xff);
    trailer.push((dataLenZ >> 8) & 0xff, dataLenZ & 0xff);
    trailer.push((dataLenFaceOrientations >> 8) & 0xff, dataLenFaceOrientations & 0xff);
    trailer.push(0);           // triangleSkinCount = 0
    trailer.push(0);           // vertexSkinCount = 0
    trailer.push(0);           // maxDepth = 0

    const total = body.length + trailer.length;
    const out = new Packet(new Uint8Array(total));
    for (const b of body) {
        out.p1(b);
    }
    for (const b of trailer) {
        out.p1(b);
    }
    return out.data;
}

/**
 * Synthesize a minimal OSRS AnimBase (skeleton) blob.
 *
 * Layout (byte-identical to 377 skeleton format):
 *   length: u8 = 5
 *   types:  u8 × 5 = [0, 1, 2, 3, 5]  (OP_BASE, OP_TRANSLATE, OP_ROTATE, OP_SCALE, OP_ALPHA)
 *   labels: per i, count: u8 = 1, then 1 × u8 = 0
 *
 * Total: 1 + 5 + 5*(1+1) = 16 bytes.
 */
function synthesizeOsrsAnimBaseBlob(): Uint8Array {
    const bytes: number[] = [];
    bytes.push(5);                              // length
    bytes.push(0, 1, 2, 3, 5);                  // types (5 bones)
    for (let i = 0; i < 5; i++) {
        bytes.push(1);                          // labelCount = 1
        bytes.push(0);                          // label[0] = 0
    }
    return new Uint8Array(bytes);
}

/**
 * Synthesize a minimal OSRS anim frame blob.
 *
 * Layout (matching `OsrsAnimFrame.decode` byte-for-byte):
 *
 *   body (before trailing 2-byte base ID):
 *     u16 frameLength          = 5
 *     per group 0..4:
 *       u8 flags               (group 0: 0x7 = X+Y+Z; group 1: 0x1 = X; others: 0)
 *       smart X (if flag & 0x1)
 *       smart Y (if flag & 0x2)
 *       smart Z (if flag & 0x4)
 *     u8 delay                 = 2
 *   trailer (2 bytes):
 *     u16 baseId
 *
 * For frame 2005 (stand):
 *   group 0 (OP_BASE): flags=0x7, X=10, Y=20, Z=30 (3 smart bytes)
 *   group 1 (OP_TRANSLATE): flags=0x1, X=5 (1 smart byte)
 *   groups 2,3,4: flags=0
 *
 * For frame 2006 (attack):
 *   group 0 (OP_BASE): flags=0x7, X=0, Y=0, Z=0 (3 smart bytes)
 *   groups 1,2,3,4: flags=0
 *
 * Total blob: 2 (frameLength) + (1+3) + (1+1) + 1 + 1 + 1 (3 zero-flag groups) + 1 (delay) + 2 (baseId) = 13 bytes for frame 2005.
 */
function synthesizeOsrsAnimFrameBlob(baseId: number, x: number, y: number, z: number, translateX: number): Uint8Array {
    const bytes: number[] = [];
    // u16 frameLength = 5
    bytes.push((5 >> 8) & 0xff, 5 & 0xff);

    // group 0 (OP_BASE): flags=0x7, X=x, Y=y, Z=z
    bytes.push(0x7);
    psmartSigned(bytes, x);
    psmartSigned(bytes, y);
    psmartSigned(bytes, z);

    // group 1 (OP_TRANSLATE): flags=0x1, X=translateX
    bytes.push(0x1);
    psmartSigned(bytes, translateX);

    // groups 2, 3, 4: flags=0
    bytes.push(0, 0, 0);

    // u8 delay = 2
    bytes.push(2);

    // trailing u16 baseId
    bytes.push((baseId >> 8) & 0xff, baseId & 0xff);

    return new Uint8Array(bytes);
}

/**
 * Synthesize an OSRS seq config blob.
 *
 * Layout (matching `OsrsSeqType.decode` byte-for-byte):
 *
 *   opcode 1 (frames):  u8 frameCount, then per frame: u16 frameId, u16 iframeId, u16 delay
 *   opcode 250:         gjstr debugname
 *   opcode 0:           end
 *
 * For 1 frame pointing to OSRS anim `frameId` with delay=2, debugname=<debugname>:
 *   bytes: 1 (opcode), 1 (frameCount), 2 (frameId), 2 (iframeId=65535→-1), 2 (delay), 1 (opcode 250), N (debugname chars) + 1 (terminator), 1 (opcode 0)
 */
function synthesizeOsrsSeqBlob(frameId: number, debugname: string): Uint8Array {
    const bytes: number[] = [];
    // opcode 1: frames
    bytes.push(1);
    bytes.push(1);                                          // frameCount = 1
    bytes.push((frameId >> 8) & 0xff, frameId & 0xff);     // frameId
    bytes.push(0xff, 0xff);                                 // iframeId = 65535 → -1
    bytes.push(0, 2);                                       // delay = 2

    // opcode 250: debugname
    bytes.push(250);
    for (let i = 0; i < debugname.length; i++) {
        bytes.push(debugname.charCodeAt(i) & 0xff);
    }
    bytes.push(10);  // gjstr terminator

    // opcode 0: end
    bytes.push(0);

    return new Uint8Array(bytes);
}

/**
 * Synthesize an OSRS NPC config blob for the Tormented Demon.
 *
 * Layout (matching `OsrsNpcType.decode` byte-for-byte). Only opcodes the
 * fixture needs are emitted:
 *
 *   opcode 1   (models):       u8 count=1, u16 modelId=46001
 *   opcode 2   (name):         gjstr "Tormented demon"
 *   opcode 13  (readyanim):    u16 9501
 *   opcode 14  (walkanim):     u16 9501
 *   opcode 60  (heads):        u8 count=1, u16 headModelId=46002
 *   opcode 74  (atk stat):     u16 200
 *   opcode 75  (def stat):     u16 150
 *   opcode 76  (str stat):     u16 180
 *   opcode 77  (hp stat):      u16 350
 *   opcode 78  (range stat):   u16 1
 *   opcode 79  (mage stat):    u16 250
 *   opcode 249 (params):       u8 count=2, then per param:
 *                              u24 key (g3), u1 isString=0, u32 value (g4s)
 *                              (param 1234 → seq 9502, param 1235 → seq 9502)
 *   opcode 250 (debugname):    gjstr "tormented_demon"
 *   opcode 0   (end)
 */
function synthesizeOsrsNpcBlob(): Uint8Array {
    const bytes: number[] = [];

    // opcode 1: models
    bytes.push(1);
    bytes.push(1);                                                  // count = 1
    bytes.push((TD_MODEL_ID >> 8) & 0xff, TD_MODEL_ID & 0xff);     // model 46001

    // opcode 2: name
    bytes.push(2);
    const name = 'Tormented demon';
    for (let i = 0; i < name.length; i++) {
        bytes.push(name.charCodeAt(i) & 0xff);
    }
    bytes.push(10);  // gjstr terminator

    // opcode 13: readyanim
    bytes.push(13);
    bytes.push((TD_SEQ_STAND_ID >> 8) & 0xff, TD_SEQ_STAND_ID & 0xff);

    // opcode 14: walkanim
    bytes.push(14);
    bytes.push((TD_SEQ_STAND_ID >> 8) & 0xff, TD_SEQ_STAND_ID & 0xff);

    // opcode 60: heads
    bytes.push(60);
    bytes.push(1);                                                       // count = 1
    bytes.push((TD_HEAD_MODEL_ID >> 8) & 0xff, TD_HEAD_MODEL_ID & 0xff); // head 46002

    // opcodes 74..79: stats
    const stats = [200, 150, 180, 350, 1, 250];
    for (let i = 0; i < stats.length; i++) {
        bytes.push(74 + i);
        const s = stats[i];
        bytes.push((s >> 8) & 0xff, s & 0xff);
    }

    // opcode 249: params
    bytes.push(249);
    bytes.push(2);  // count = 2 params

    // param 1234 (attack_anim) → seq 9502 (encoded as signed int32)
    writeParam(bytes, TD_PARAM_ATTACK_ANIM, false, TD_SEQ_ATTACK_ID);
    // param 1235 (death_anim) → seq 9502
    writeParam(bytes, TD_PARAM_DEATH_ANIM, false, TD_SEQ_ATTACK_ID);

    // opcode 250: debugname
    bytes.push(250);
    const debugname = 'tormented_demon';
    for (let i = 0; i < debugname.length; i++) {
        bytes.push(debugname.charCodeAt(i) & 0xff);
    }
    bytes.push(10);  // gjstr terminator

    // opcode 0: end
    bytes.push(0);

    return new Uint8Array(bytes);
}

/**
 * Helper: write a single param entry inside an opcode 249 block.
 *
 * Layout (per `ParamHelper.decodeParams`):
 *   u24 key (3 bytes BE)
 *   u1 isString (1 byte — 0 for int, 1 for string)
 *   if isString: gjstr value
 *   else:        i32 value (4 bytes BE, signed)
 */
function writeParam(out: number[], key: number, isString: boolean, value: number | string): void {
    // u24 key (3 bytes BE)
    out.push((key >> 16) & 0xff);
    out.push((key >> 8) & 0xff);
    out.push(key & 0xff);
    // u1 isString
    out.push(isString ? 1 : 0);
    if (isString) {
        const s = String(value);
        for (let i = 0; i < s.length; i++) {
            out.push(s.charCodeAt(i) & 0xff);
        }
        out.push(10);  // gjstr terminator
    } else {
        // i32 BE signed
        const v = value as number | 0;
        out.push((v >>> 24) & 0xff);
        out.push((v >>> 16) & 0xff);
        out.push((v >>> 8) & 0xff);
        out.push(v & 0xff);
    }
}

// ---- StubCacheReader: wraps the synthesized bytes and uses the real OSRS decoders ----

/**
 * Stub `CacheReader` for the Tormented Demon fixture.
 *
 * Implements the same `CacheReader` interface as Task 7's
 * `OsrsCacheAssetReader`, but instead of reading bytes from a real JS5
 * cache on disk, it returns synthesized OSRS blobs from in-memory
 * `Uint8Array`s. The blobs are then decoded by the REAL OSRS decoders
 * (`OsrsModel.decode`, `OsrsAnimFrame.decode`, etc.) — so every code path
 * the pipeline would hit on a real OSRS cache is exercised here.
 *
 * The reader pre-loads the synthesized AnimBase into
 * `AnimBase.instances[47001]` in its constructor (mirroring what
 * `OsrsCacheAssetReader.readAnimBase` does on demand). The
 * `OsrsAnimFrame.decode()` call requires the base to be present.
 *
 * For obj/param/struct/texture/particle/sound reads, this stub returns
 * `null` — matching Task 7's behavior for asset types whose OSRS-native
 * decoders aren't ported yet. The dep tracer records these as missing
 * leaves, which is the expected behavior.
 */
export class TormentedDemonStubReader implements CacheReader {
    /** Synthesized OSRS model bytes (body model + head model). */
    private readonly modelBytes: Map<number, Uint8Array> = new Map();
    /** Synthesized OSRS anim frame bytes. */
    private readonly animBytes: Map<number, Uint8Array> = new Map();
    /** Synthesized OSRS AnimBase bytes. */
    private readonly baseBytes: Map<number, Uint8Array> = new Map();
    /** Synthesized OSRS seq config bytes (parsed on first read). */
    private readonly seqBytes: Map<number, Uint8Array> = new Map();
    /** Synthesized OSRS NPC config bytes (parsed on first read). */
    private readonly npcBytes: Map<number, Uint8Array> = new Map();

    /** Whether `parseNpcConfigs` / `parseSeqConfigs` have run yet. */
    private npcParsed: boolean = false;
    private seqParsed: boolean = false;

    constructor() {
        // Synthesize all the byte blobs up front.
        this.modelBytes.set(TD_MODEL_ID, synthesizeOsrsModelBlob());
        this.modelBytes.set(TD_HEAD_MODEL_ID, synthesizeOsrsModelBlob());
        this.baseBytes.set(TD_BASE_ID, synthesizeOsrsAnimBaseBlob());
        this.animBytes.set(TD_ANIM_STAND_ID, synthesizeOsrsAnimFrameBlob(TD_BASE_ID, 10, 20, 30, 5));
        this.animBytes.set(TD_ANIM_ATTACK_ID, synthesizeOsrsAnimFrameBlob(TD_BASE_ID, 0, 0, 0, 0));
        this.seqBytes.set(TD_SEQ_STAND_ID, synthesizeOsrsSeqBlob(TD_ANIM_STAND_ID, 'td_stand'));
        this.seqBytes.set(TD_SEQ_ATTACK_ID, synthesizeOsrsSeqBlob(TD_ANIM_ATTACK_ID, 'td_attack'));
        this.npcBytes.set(TD_NPC_ID, synthesizeOsrsNpcBlob());

        // Pre-load the AnimBase into the shared registry so OsrsAnimFrame.decode
        // can find it (mirroring what OsrsCacheAssetReader.readAnimBase does).
        this.loadAnimBase(TD_BASE_ID);
    }

    // ---- CacheReader implementation ----

    readModel(id: number): OsrsModel | null {
        const bytes = this.modelBytes.get(id);
        if (!bytes) {
            return null;
        }
        return OsrsModel.decode(id, bytes);
    }

    readAnim(id: number): OsrsAnimFrame | null {
        const bytes = this.animBytes.get(id);
        if (!bytes || bytes.length < 2) {
            return null;
        }
        // Peek the trailing 2-byte base ID (same logic as OsrsCacheAssetReader.readAnim).
        const trailer = new Packet(bytes);
        trailer.pos = bytes.length - 2;
        const baseId = trailer.g2();
        if (!AnimBase.instances[baseId]) {
            this.loadAnimBase(baseId);
        }
        return OsrsAnimFrame.decode(bytes, baseId);
    }

    readAnimBase(id: number): AnimBase | null {
        if (AnimBase.instances[id]) {
            return AnimBase.instances[id];
        }
        return this.loadAnimBase(id);
    }

    readSeq(id: number): OsrsSeqType | null {
        if (!this.seqParsed) {
            this.parseSeqConfigs();
            this.seqParsed = true;
        }
        return OsrsSeqType.configs[id] ?? null;
    }

    readNpc(id: number): OsrsNpcType | null {
        if (!this.npcParsed) {
            this.parseNpcConfigs();
            this.npcParsed = true;
        }
        return OsrsNpcType.configs[id] ?? null;
    }

    readObj(_id: number): ObjType | null {
        // OSRS obj configs use opcodes the legacy ObjType decoder doesn't know
        // (and OsrsObjType isn't ported yet). Mirroring OsrsCacheAssetReader's
        // stub behavior — return null so the dep tracer records the obj as a
        // missing leaf. The Tormented Demon's `fire_shield` obj ref (discovered
        // via the script scanner) will be recorded as missing here too.
        return null;
    }

    readParam(id: number): ParamType | null {
        // The fixture's TD NPC has 2 params (1234=attack_anim, 1235=death_anim),
        // both seq-typed. We synthesize a stub ParamType with type=SEQ so the
        // dep tracer's `walkParams` walks the param VALUE (seq 9502) as a seq
        // ref — exercising the param-value-walk code path.
        //
        // This mirrors what a real OSRS cache would provide via the (not-yet-
        // ported) OsrsParamType. Without this stub, the tracer would log a
        // "param type unknown" note and NOT walk the value — meaning the
        // seq:9502 → anim:2006 path wouldn't be reached via params.
        if (id === TD_PARAM_ATTACK_ANIM || id === TD_PARAM_DEATH_ANIM) {
            const stub = new ParamType(id);
            stub.type = ScriptVarType.SEQ;  // 65 — 'seq'
            stub.debugname = id === TD_PARAM_ATTACK_ANIM ? 'attack_anim' : 'death_anim';
            return stub;
        }
        // Other param IDs — return null (mirrors OsrsCacheAssetReader behavior).
        return null;
    }

    readStruct(_id: number): StructType | null {
        return null;
    }

    readTexture(_id: number): Uint8Array | null {
        return null;
    }

    readParticle(_id: number): Uint8Array | null {
        return null;
    }

    readSound(_id: number): Uint8Array | null {
        return null;
    }

    getName(kind: NodeKind, id: number | string): string | null {
        if (typeof id === 'string') {
            return id;  // scripts use debugname-as-id
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
            default:
                return null;
        }
    }

    // ---- Internal helpers (mirror OsrsCacheAssetReader's parsing flow) ----

    /**
     * Parse the synthesized NPC config bytes and populate
     * `OsrsNpcType.configs[]` + `OsrsNpcType.configNames`.
     *
     * Mirrors `OsrsCacheAssetReader.parseNpcConfigs()`.
     */
    private parseNpcConfigs(): void {
        OsrsNpcType.configNames = new Map();
        OsrsNpcType.configs = [];

        for (const [id, bytes] of this.npcBytes) {
            const packet = new Packet(bytes);
            const config = new OsrsNpcType(id);
            try {
                config.decodeType(packet);
                config.postDecode();
            } catch (err) {
                printWarning(`TormentedDemonStubReader: npc ${id} decode failed: ${(err as Error).message}`);
            }
            OsrsNpcType.configs[id] = config;
            if (config.debugname) {
                OsrsNpcType.configNames.set(config.debugname, id);
            }
        }
    }

    /**
     * Parse the synthesized seq config bytes and populate
     * `OsrsSeqType.configs[]` + `OsrsSeqType.configNames`.
     *
     * Mirrors `OsrsCacheAssetReader.parseSeqConfigs()`.
     */
    private parseSeqConfigs(): void {
        OsrsSeqType.configNames = new Map();
        OsrsSeqType.configs = [];

        for (const [id, bytes] of this.seqBytes) {
            const packet = new Packet(bytes);
            const config = new OsrsSeqType(id);
            try {
                config.decodeType(packet);
                config.postDecode();
            } catch (err) {
                printWarning(`TormentedDemonStubReader: seq ${id} decode failed: ${(err as Error).message}`);
            }
            OsrsSeqType.configs[id] = config;
            if (config.debugname) {
                OsrsSeqType.configNames.set(config.debugname, id);
            }
        }
    }

    /**
     * Load + parse a synthesized AnimBase and register it in
     * `AnimBase.instances[id]`. Mirrors
     * `OsrsCacheAssetReader.loadAnimBase()`.
     */
    private loadAnimBase(id: number): AnimBase | null {
        const bytes = this.baseBytes.get(id);
        if (!bytes || bytes.length < 1) {
            return null;
        }
        const packet = new Packet(bytes);
        const length = packet.g1();
        const types = new Int32Array(length);
        const labels: Int32Array[] = new Array(length);
        for (let i = 0; i < length; i++) {
            types[i] = packet.g1();
        }
        for (let i = 0; i < length; i++) {
            const labelCount = packet.g1();
            const labelArr = new Int32Array(labelCount);
            for (let j = 0; j < labelCount; j++) {
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

// ---- Fake combat script content ----

/**
 * The placeholder runescript content for the Tormented Demon's combat script.
 *
 * This is intentionally a stub — the real TD combat script is a complex
 * runescript that drives the demon's AI behavior (the fire shield mechanic,
 * the magic fireball attack, etc.). For the pilot, we just need:
 *
 *   1. A `[ai_applayer2,Tormented demon]` dispatch directive so the dep
 *      tracer's `findScriptsForNpc()` finds this file (it scans for
 *      `[<trigger>,<npcName>]` patterns where `npcName` is the NPC's
 *      display name).
 *
 *   2. An `inv_has(worn, fire_shield)` call site so the script scanner
 *      discovers the `fire_shield` obj ref and records it as a missing
 *      dep (proving the tracer walks the script → obj edge — which is
 *      the goal per the user's brief: "the TD combat script probably
 *      needs the fire shield for the demon").
 *
 *   3. A `npc_anim(td_attack, 0)` call site so the scanner also discovers
 *      the `td_attack` seq ref (the script references the seq by name).
 *
 *   4. A `[npc_assoc]` block declaring which NPC this script belongs to
 *      (LostCity convention; doesn't affect the dep tracer but documents
 *      intent).
 *
 *   5. An `[obj_assoc]` block declaring the fire shield dependency
 *      (LostCity convention; doesn't affect the dep tracer but documents
 *      intent).
 */
const TD_COMBAT_SCRIPT = `// Tormented Demon combat script (synthesized stub for the OSRS pipeline pilot).
//
// This is a PLACEHOLDER — the real TD combat script is a complex runescript
// driving the demon's AI: the fire shield mechanic, the magic fireball
// attack, melee swipe, defend stance, and death animation. For the pilot we
// only need enough content for the dep tracer to discover the fire_shield
// obj dependency via the script scanner.

[npc_assoc]
tormented_demon

[obj_assoc]
fire_shield

[ai_applayer2,Tormented demon]
// Combat AI: check if the player is wearing a fire shield (anti-dragon-breath
// shield). If not, the demon's fireball attack hits harder.
if (inv_has(worn, fire_shield)) {
    npc_anim(td_attack, 0);
    sound_synth(td_fireball, 0, 30);
} else {
    npc_anim(td_attack, 0);
    sound_synth(td_fireball, 0, 60);
}
`;

// ---- Fixture generator ----

/**
 * Generate the Tormented Demon test fixture.
 *
 * Writes a temp directory under `os.tmpdir()` containing:
 *   - `<cacheDir>/scripts/npc/scripts/tormented_demon.rs2` — fake combat script.
 *
 * Returns the path + the OSRS NPC ID + the expected dep count. The caller
 * is expected to:
 *   1. Construct a `TormentedDemonStubReader` (which synthesizes the OSRS
 *      bytes in-memory — no disk I/O for the bytes themselves).
 *   2. Construct a `DependencyTracer` with `scriptDir = <cacheDir>/scripts/npc/scripts`.
 *   3. Call `tracer.trace(fixture.npcId)` to produce the DepsMap.
 *
 * Cleanup: the caller is responsible for deleting `cacheDir` when done
 * (the pilot script does this on exit unless `--keep-fixture` is passed).
 */
export function generateTormentedDemonFixture(): TormentedDemonFixture {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osrs-td-fixture-'));
    printInfo(`TormentedDemonFixture: created temp dir ${cacheDir}`);

    // Write the fake combat script.
    const scriptDir = path.join(cacheDir, 'scripts', 'npc', 'scripts');
    const scriptPath = path.join(scriptDir, 'tormented_demon.rs2');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(scriptPath, TD_COMBAT_SCRIPT, 'utf8');
    printInfo(`TormentedDemonFixture: wrote combat script to ${scriptPath}`);

    return {
        cacheDir,
        npcId: TD_NPC_ID,
        expectedDeps: EXPECTED_DEP_NODES,
        scriptPath,
        scriptDir
    };
}

/**
 * Remove the fixture's temp directory. Best-effort — failures are logged
 * but not thrown (the pilot may want to continue even if cleanup fails).
 *
 * Idempotent: calling this twice is safe.
 */
export function cleanupFixture(fixture: TormentedDemonFixture): void {
    try {
        fs.rmSync(fixture.cacheDir, { recursive: true, force: true });
        printInfo(`TormentedDemonFixture: cleaned up ${fixture.cacheDir}`);
    } catch (err) {
        printWarning(`TormentedDemonFixture: failed to clean up ${fixture.cacheDir}: ${(err as Error).message}`);
    }
}
