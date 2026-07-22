/**
 * KalphiteQueenFixture.ts — Part A of the Kalphite Queen end-to-end pilot
 * (Task 11 of the OSRS → 377 model pipeline).
 *
 * Synthesizes a minimal but realistic OSRS-shaped test fixture for the
 * Kalphite Queen NPC — the "tricky test" for the pipeline because she has
 * TWO forms (form 1 = flying insect, form 2 = ground-based) that must be
 * imported together and treated as a unit by the variant registry.
 *
 * The fixture is a sibling of `TormentedDemonFixture.ts` (Task 10) and
 * uses the same `StubCacheReader` pattern (real OSRS decoders on
 * synthesized in-memory bytes that match the OSRS on-disk format
 * byte-for-byte). See `TormentedDemonFixture.ts` for the rationale of
 * why we use a StubCacheReader instead of a real JS5 store on disk.
 *
 * ----------------------------------------------------------------------------
 * What's tricky about the Kalphite Queen
 * ----------------------------------------------------------------------------
 *
 * The KQ is implemented as TWO separate OSRS NPC configs:
 *   - Form 1 (id=1158 in our fixture): the initial spawn — a giant flying
 *     insect with wings. Has `multinpc=[-1, 1159]` (when varbit 0 flips
 *     to value 1, swap to form 2). HP ~255.
 *   - Form 2 (id=1159 in our fixture): emerges when form 1 dies — a
 *     smaller, ground-based form. HP ~255 again.
 *
 * The form-swap is implemented via NPC config opcode 106 (multivarbit /
 * multivarp / multinpc). Form 1's config carries the multinpc array;
 * form 2's config is standalone (no multinpc).
 *
 * The dep tracer MUST:
 *   1. Walk BOTH forms as separate NPCs (they have different models,
 *      anims, etc.).
 *   2. PRESERVE the cross-form reference: when form 1's config is
 *      imported, the `multinpc[]` array must be rewritten to point at
 *      form 2's NEW imported debugname (not the OSRS ID), so the
 *      LostCity NPC config parser can resolve it via `NpcPack.getByName`.
 *
 * The variant registry MUST:
 *   1. Register BOTH forms as separate variant entries (one per form).
 *   2. Treat the two forms as a UNIT via `linkVariants(form1NewId,
 *      form2NewId)` — if a player picks 'legacy377' for form 1, form 2
 *      must also resolve to 'legacy377' (and vice versa).
 *
 * ----------------------------------------------------------------------------
 * What the fixture synthesizes
 * ----------------------------------------------------------------------------
 *
 * All bytes are written byte-by-byte using `Packet`'s `p1/p2/pjstr/p4`
 * methods, matching the OSRS on-disk layout the decoders expect:
 *
 *   - 2 OSRS model blobs (archive 1 files 51001 + 51002) — one per form.
 *     Each is 4 vertices + 2 triangles (identical to the TD fixture's
 *     model blob shape, just under different IDs).
 *
 *   - 1 OSRS AnimBase blob (archive 0 file 52001) — shared skeleton
 *     (both forms use the same rig). 5 bones: OP_BASE/TRANSLATE/ROTATE/
 *     SCALE/ALPHA, 1 label each.
 *
 *   - 4 OSRS anim frame blobs (archive 0 files 22001, 22003, 22004,
 *     22006) — shared between forms where possible to exercise the
 *     writer's cross-form anim dedup:
 *       - 22001 (idle): used by BOTH form1's kq1_idle seq AND form2's
 *         kq2_idle seq. The writer should write this anim ONCE (the
 *         second reference is a "shared_with_prior_npc" skip).
 *       - 22003 (form1 attack): used only by kq1_attack seq.
 *       - 22004 (death): used by BOTH form1's kq1_death seq AND form2's
 *         kq2_death seq. Same dedup as 22001.
 *       - 22006 (form2 attack): used only by kq2_attack seq.
 *
 *   - 6 OSRS seq config blobs (seq.dat entries 9601..9606):
 *       - 9601 (kq1_idle):   frame 22001 — used by form1 readyanim + walkanim.
 *       - 9602 (kq1_attack): frame 22003 — used by form1 attack_anim param.
 *       - 9603 (kq1_death):  frame 22004 — used by form1 death_anim param.
 *       - 9604 (kq2_idle):   frame 22001 — used by form2 readyanim + walkanim.
 *       - 9605 (kq2_attack): frame 22006 — used by form2 attack_anim param.
 *       - 9606 (kq2_death):  frame 22004 — used by form2 death_anim param.
 *
 *   - 2 OSRS NPC config blobs (npc.dat entries 1158 + 1159):
 *       - 1158 (form 1): name="Kalphite Queen", debugname="kalphite_queen",
 *         models=[51001], readyanim=9601, walkanim=9601,
 *         params={attack_anim=9602, death_anim=9603},
 *         multivarbit=0, multinpc=[-1, 1159] (form-swap on varbit flip).
 *       - 1159 (form 2): name="Kalphite Queen", debugname="kalphite_queen_2",
 *         models=[51002], readyanim=9604, walkanim=9604,
 *         params={attack_anim=9605, death_anim=9606}.
 *
 *   - 1 fake combat script at `<cacheDir>/scripts/npc/scripts/kalphite_queen.rs2`
 *     (placeholder runescript with `[ai_applayer2,Kalphite Queen]` dispatch
 *     directives for BOTH forms (they share the display name) plus
 *     `inv_has(worn, kq_head)` and `inv_total(worn, kq_head)` call sites
 *     so the dep tracer's script scanner discovers the `kq_head` obj ref
 *     and records it as a missing dep — proving the tracer walks the
 *     script → obj edge for the KQ too).
 *
 * The fixture also pre-populates `AnimBase.instances[52001]` so the
 * OSRS anim frame decoder can find the skeleton it references.
 *
 * ----------------------------------------------------------------------------
 * Cleanup
 * ----------------------------------------------------------------------------
 *
 * The fixture writes to `<os.tmpdir()>/osrs-kq-fixture/` (or `$TMPDIR`).
 * The pilot script (`PilotKalphiteQueen.ts`) cleans up the temp dir on
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

/** OSRS NPC ID for KQ form 1 (the initial flying-insect form). */
export const KQ_FORM1_NPC_ID = 1158;
/** OSRS NPC ID for KQ form 2 (the ground-based form that emerges when form 1 dies). */
export const KQ_FORM2_NPC_ID = 1159;
/** OSRS model ID for form 1's body mesh. */
export const KQ_FORM1_MODEL_ID = 51001;
/** OSRS model ID for form 2's body mesh. */
export const KQ_FORM2_MODEL_ID = 51002;
/** OSRS AnimBase (skeleton) ID — shared between both forms. */
export const KQ_BASE_ID = 52001;
/** OSRS anim frame ID for the idle frame (shared between form1 + form2 idle seqs). */
export const KQ_ANIM_IDLE_ID = 22001;
/** OSRS anim frame ID for form1's attack frame. */
export const KQ_ANIM_FORM1_ATTACK_ID = 22003;
/** OSRS anim frame ID for the death frame (shared between form1 + form2 death seqs). */
export const KQ_ANIM_DEATH_ID = 22004;
/** OSRS anim frame ID for form2's attack frame. */
export const KQ_ANIM_FORM2_ATTACK_ID = 22006;
/** OSRS seq ID for kq1_idle (form1 readyanim + walkanim). */
export const KQ_SEQ_FORM1_IDLE_ID = 9601;
/** OSRS seq ID for kq1_attack (form1 attack_anim param). */
export const KQ_SEQ_FORM1_ATTACK_ID = 9602;
/** OSRS seq ID for kq1_death (form1 death_anim param). */
export const KQ_SEQ_FORM1_DEATH_ID = 9603;
/** OSRS seq ID for kq2_idle (form2 readyanim + walkanim). */
export const KQ_SEQ_FORM2_IDLE_ID = 9604;
/** OSRS seq ID for kq2_attack (form2 attack_anim param). */
export const KQ_SEQ_FORM2_ATTACK_ID = 9605;
/** OSRS seq ID for kq2_death (form2 death_anim param). */
export const KQ_SEQ_FORM2_DEATH_ID = 9606;
/** OSRS param ID for the `attack_anim` param (seq-typed) — shared by both forms. */
export const KQ_PARAM_ATTACK_ANIM = 1234;
/** OSRS param ID for the `death_anim` param (seq-typed) — shared by both forms. */
export const KQ_PARAM_DEATH_ANIM = 1235;
/**
 * OSRS varbit ID that drives the form-swap (form 1 → form 2 when the
 * varbit flips to value 1). Doesn't need to be a real OSRS varbit —
 * the dep tracer doesn't walk varbit configs (they're not in the
 * fixture's stub reader). The value just needs to be non-sentinel so
 * `OsrsNpcType.toLegacy377NpcConfig()` emits the `multivar=` + `multinpc=`
 * lines.
 */
export const KQ_FORM_SWAP_VARBIT_ID = 0;

/**
 * Number of dep nodes the tracer is expected to discover for this fixture.
 *
 * Nodes (form1 is the trace root; the tracer walks multinpc[1] to form2):
 *   1.  npc:1158            (form 1 — root)
 *   2.  npc:1159            (form 2 — via multinpc[1])
 *   3.  model:51001         (form1 body, via models[0])
 *   4.  model:51002         (form2 body, via models[0])
 *   5.  anim-base:52001     (shared skeleton, via anim.base)
 *   6.  anim:22001          (shared idle frame — used by seq 9601 + 9604)
 *   7.  anim:22003          (form1 attack frame)
 *   8.  anim:22004          (shared death frame — used by seq 9603 + 9606)
 *   9.  anim:22006          (form2 attack frame)
 *  10.  seq:9601            (kq1_idle)
 *  11.  seq:9602            (kq1_attack)
 *  12.  seq:9603            (kq1_death)
 *  13.  seq:9604            (kq2_idle)
 *  14.  seq:9605            (kq2_attack)
 *  15.  seq:9606            (kq2_death)
 *  16.  param:1234          (attack_anim — seq-typed, walks to seq 9602/9605)
 *  17.  param:1235          (death_anim — seq-typed, walks to seq 9603/9606)
 *  18.  script:kalphite_queen  (combat script, found via dispatch scan)
 *
 * Plus 1 missing dep ref (the `kq_head` obj ref discovered by the script
 * scanner — recorded as a missing leaf, NOT a node in `nodes`, but
 * appears in the top-level `missing[]` array).
 *
 * Total nodes = 18.
 */
export const EXPECTED_DEP_NODES = 18;

// ---- Fixture return type ----

export interface KalphiteQueenFixture {
    /** Temp directory containing the fixture's files (script, etc). */
    cacheDir: string;
    /** OSRS NPC ID for form 1 (the trace root — 1158). */
    form1Id: number;
    /** OSRS NPC ID for form 2 (referenced by form 1's multinpc — 1159). */
    form2Id: number;
    /** Expected number of nodes in the traced DepsMap (both forms combined). */
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
 * Matches the format read by `Packet.gsmart()`. Local copy of the helper
 * in `OsrsModel.ts` / `OsrsAnimFrame.ts` / `TormentedDemonFixture.ts`.
 * Hoisting into `Packet.ts` is a deferred Task 5-a/12 cleanup.
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
 * Layout matches the TD fixture's `synthesizeOsrsModelBlob` byte-for-byte
 * (4 vertices, 2 triangles, version=1, all optional sections omitted).
 * See `TormentedDemonFixture.ts` for the full layout comment.
 *
 * Total blob: 16 (body) + 23 (trailer) = 39 bytes.
 */
function synthesizeOsrsModelBlob(): Uint8Array {
    const body: number[] = [];

    // 1. vertex flags (4 bytes, all 0 — no deltas)
    body.push(0, 0, 0, 0);

    // 5.5 triangle orientation bytes (2 bytes — both type 1)
    body.push(1, 1);

    // 6. triangle colours (2 × u16 = 4 bytes) — colour 0x1234 each.
    body.push(0x12, 0x34);
    body.push(0x12, 0x34);

    // 11. triangle vertex indices (smart-encoded deltas)
    psmartSigned(body, 0);   // tri 0: a
    psmartSigned(body, 1);   // tri 0: b
    psmartSigned(body, 1);   // tri 0: c
    psmartSigned(body, -2);  // tri 1: a
    psmartSigned(body, 2);   // tri 1: b
    psmartSigned(body, 1);   // tri 1: c

    const dataLenFaceOrientations = 6;
    const dataLenX = 0;
    const dataLenY = 0;
    const dataLenZ = 0;

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
 * Byte-identical to the TD fixture's skeleton (5 bones: OP_BASE,
 * OP_TRANSLATE, OP_ROTATE, OP_SCALE, OP_ALPHA, 1 label each).
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
 * Layout matches the TD fixture's `synthesizeOsrsAnimFrameBlob` byte-for-byte.
 * See `TormentedDemonFixture.ts` for the full layout comment.
 *
 * Each frame:
 *   - frameLength = 5 (5 bones, matching the shared AnimBase).
 *   - group 0 (OP_BASE): flags=0x7, X=x, Y=y, Z=z.
 *   - group 1 (OP_TRANSLATE): flags=0x1, X=translateX.
 *   - groups 2, 3, 4: flags=0.
 *   - u8 delay = 2.
 *   - trailing u16 baseId (= 52001 in our fixture).
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
 * Layout matches the TD fixture's `synthesizeOsrsSeqBlob` byte-for-byte:
 *   opcode 1 (frames):  u8 frameCount=1, u16 frameId, u16 iframeId=65535, u16 delay=2
 *   opcode 250:         gjstr debugname
 *   opcode 0:           end
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
 * Helper: write a single param entry inside an opcode 249 block.
 *
 * Same layout as the TD fixture's `writeParam` helper.
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

/**
 * Synthesize the OSRS NPC config blob for KQ form 1.
 *
 * Opcodes emitted:
 *   opcode 1   (models):       u8 count=1, u16 modelId=51001
 *   opcode 2   (name):         gjstr "Kalphite Queen"
 *   opcode 13  (readyanim):    u16 9601
 *   opcode 14  (walkanim):     u16 9601
 *   opcode 74  (atk stat):     u16 200
 *   opcode 75  (def stat):     u16 150
 *   opcode 76  (str stat):     u16 180
 *   opcode 77  (hp stat):      u16 255  (KQ HP)
 *   opcode 78  (range stat):   u16 1
 *   opcode 79  (mage stat):    u16 250
 *   opcode 106 (multivarbit/multivarp/multinpc):
 *                              u16 multivarbit=0, u16 multivarp=65535 (-1),
 *                              u8 count=1 (array length 2),
 *                              u16 multinpc[0]=65535 (-1),
 *                              u16 multinpc[1]=1159 (form 2's OSRS ID)
 *   opcode 249 (params):       u8 count=2
 *                              param 1234 (attack_anim) → seq 9602
 *                              param 1235 (death_anim)  → seq 9603
 *   opcode 250 (debugname):    gjstr "kalphite_queen"
 *   opcode 0   (end)
 */
function synthesizeOsrsForm1NpcBlob(): Uint8Array {
    const bytes: number[] = [];

    // opcode 1: models
    bytes.push(1);
    bytes.push(1);                                                          // count = 1
    bytes.push((KQ_FORM1_MODEL_ID >> 8) & 0xff, KQ_FORM1_MODEL_ID & 0xff); // model 51001

    // opcode 2: name
    bytes.push(2);
    const name = 'Kalphite Queen';
    for (let i = 0; i < name.length; i++) {
        bytes.push(name.charCodeAt(i) & 0xff);
    }
    bytes.push(10);  // gjstr terminator

    // opcode 13: readyanim
    bytes.push(13);
    bytes.push((KQ_SEQ_FORM1_IDLE_ID >> 8) & 0xff, KQ_SEQ_FORM1_IDLE_ID & 0xff);

    // opcode 14: walkanim
    bytes.push(14);
    bytes.push((KQ_SEQ_FORM1_IDLE_ID >> 8) & 0xff, KQ_SEQ_FORM1_IDLE_ID & 0xff);

    // opcodes 74..79: stats
    const stats = [200, 150, 180, 255, 1, 250];
    for (let i = 0; i < stats.length; i++) {
        bytes.push(74 + i);
        const s = stats[i];
        bytes.push((s >> 8) & 0xff, s & 0xff);
    }

    // opcode 106: multivarbit / multivarp / multinpc (form-swap config).
    //
    // Layout (per OsrsNpcType.decode code 106):
    //   u16 multivarbit
    //   u16 multivarp
    //   u8  count           (array length = count + 1)
    //   u16 multinpc[0..count]
    //
    // For form 1's `multinpc = [-1, 1159]`:
    //   multivarbit = 0 (any non-sentinel value triggers emission of the
    //                   multivar= + multinpc= lines by toLegacy377NpcConfig)
    //   multivarp   = 65535 (= -1, no multivarp)
    //   count       = 1 (array length = 2)
    //   multinpc[0] = 65535 (= -1, no swap at varbit value 0)
    //   multinpc[1] = 1159 (form 2's OSRS ID — swap at varbit value 1)
    bytes.push(106);
    bytes.push((KQ_FORM_SWAP_VARBIT_ID >> 8) & 0xff, KQ_FORM_SWAP_VARBIT_ID & 0xff); // multivarbit = 0
    bytes.push(0xff, 0xff);                                                          // multivarp = 65535 (-1)
    bytes.push(1);                                                                   // count = 1 (array length 2)
    bytes.push(0xff, 0xff);                                                          // multinpc[0] = 65535 (-1)
    bytes.push((KQ_FORM2_NPC_ID >> 8) & 0xff, KQ_FORM2_NPC_ID & 0xff);              // multinpc[1] = 1159

    // opcode 249: params
    bytes.push(249);
    bytes.push(2);  // count = 2 params
    writeParam(bytes, KQ_PARAM_ATTACK_ANIM, false, KQ_SEQ_FORM1_ATTACK_ID);
    writeParam(bytes, KQ_PARAM_DEATH_ANIM, false, KQ_SEQ_FORM1_DEATH_ID);

    // opcode 250: debugname
    bytes.push(250);
    const debugname = 'kalphite_queen';
    for (let i = 0; i < debugname.length; i++) {
        bytes.push(debugname.charCodeAt(i) & 0xff);
    }
    bytes.push(10);  // gjstr terminator

    // opcode 0: end
    bytes.push(0);

    return new Uint8Array(bytes);
}

/**
 * Synthesize the OSRS NPC config blob for KQ form 2.
 *
 * Opcodes emitted (same shape as form 1, minus opcode 106):
 *   opcode 1   (models):       u8 count=1, u16 modelId=51002
 *   opcode 2   (name):         gjstr "Kalphite Queen" (same display name as form 1)
 *   opcode 13  (readyanim):    u16 9604
 *   opcode 14  (walkanim):     u16 9604
 *   opcode 74..79 (stats):     same as form 1 (HP 255)
 *   opcode 249 (params):       u8 count=2
 *                              param 1234 (attack_anim) → seq 9605
 *                              param 1235 (death_anim)  → seq 9606
 *   opcode 250 (debugname):    gjstr "kalphite_queen_2"
 *   opcode 0   (end)
 *
 * Note: form 2 does NOT have opcode 106 (no multinpc) — it's a leaf in
 * the form-swap graph. Form 2 doesn't swap to anything else.
 */
function synthesizeOsrsForm2NpcBlob(): Uint8Array {
    const bytes: number[] = [];

    // opcode 1: models
    bytes.push(1);
    bytes.push(1);                                                          // count = 1
    bytes.push((KQ_FORM2_MODEL_ID >> 8) & 0xff, KQ_FORM2_MODEL_ID & 0xff); // model 51002

    // opcode 2: name (form 2 has a distinct display name — "Kalphite Queen (form 2)"
    // — so the writer's sanitizeName produces distinct debugnames for the two
    // forms. Without this distinction, both forms would sanitize to
    // "osrs_kalphite_queen" and the second-processed one would get the "_2"
    // suffix — but the topo-sort processes form 2 FIRST (so form 1's
    // multinpc rewrite can look up form 2's debugname), which would
    // give form 1 the "_2" suffix. The spec mandates form 1 =
    // "osrs_kalphite_queen" and form 2 = "osrs_kalphite_queen_2", so we
    // give form 2 a distinct display name here.)
    bytes.push(2);
    const name = 'Kalphite Queen (form 2)';
    for (let i = 0; i < name.length; i++) {
        bytes.push(name.charCodeAt(i) & 0xff);
    }
    bytes.push(10);  // gjstr terminator

    // opcode 13: readyanim
    bytes.push(13);
    bytes.push((KQ_SEQ_FORM2_IDLE_ID >> 8) & 0xff, KQ_SEQ_FORM2_IDLE_ID & 0xff);

    // opcode 14: walkanim
    bytes.push(14);
    bytes.push((KQ_SEQ_FORM2_IDLE_ID >> 8) & 0xff, KQ_SEQ_FORM2_IDLE_ID & 0xff);

    // opcodes 74..79: stats (same as form 1)
    const stats = [200, 150, 180, 255, 1, 250];
    for (let i = 0; i < stats.length; i++) {
        bytes.push(74 + i);
        const s = stats[i];
        bytes.push((s >> 8) & 0xff, s & 0xff);
    }

    // (no opcode 106 — form 2 has no multinpc)

    // opcode 249: params
    bytes.push(249);
    bytes.push(2);  // count = 2 params
    writeParam(bytes, KQ_PARAM_ATTACK_ANIM, false, KQ_SEQ_FORM2_ATTACK_ID);
    writeParam(bytes, KQ_PARAM_DEATH_ANIM, false, KQ_SEQ_FORM2_DEATH_ID);

    // opcode 250: debugname
    bytes.push(250);
    const debugname = 'kalphite_queen_2';
    for (let i = 0; i < debugname.length; i++) {
        bytes.push(debugname.charCodeAt(i) & 0xff);
    }
    bytes.push(10);  // gjstr terminator

    // opcode 0: end
    bytes.push(0);

    return new Uint8Array(bytes);
}

// ---- StubCacheReader: wraps the synthesized bytes and uses the real OSRS decoders ----

/**
 * Stub `CacheReader` for the Kalphite Queen fixture.
 *
 * Implements the same `CacheReader` interface as Task 7's
 * `OsrsCacheAssetReader` and Task 10's `TormentedDemonStubReader`, but
 * instead of reading bytes from a real JS5 cache on disk, it returns
 * synthesized OSRS blobs from in-memory `Uint8Array`s. The blobs are
 * then decoded by the REAL OSRS decoders — so every code path the
 * pipeline would hit on a real OSRS cache is exercised here.
 *
 * The reader pre-loads the synthesized AnimBase into
 * `AnimBase.instances[52001]` in its constructor (mirroring what
 * `OsrsCacheAssetReader.readAnimBase` does on demand). The
 * `OsrsAnimFrame.decode()` call requires the base to be present.
 *
 * For obj/param/struct/texture/particle/sound reads, this stub returns
 * `null` (matching Task 7's behavior for asset types whose OSRS-native
 * decoders aren't ported yet). The dep tracer records these as missing
 * leaves — the KQ's `kq_head` obj ref (discovered via the script scanner)
 * will be recorded as missing here too.
 *
 * The ONE exception to the "return null for params" rule is params 1234
 * and 1235 (attack_anim + death_anim), which return stub `ParamType`
 * instances with `type = ScriptVarType.SEQ`. This mirrors what a real
 * OSRS cache would provide via the (not-yet-ported) OsrsParamType, and
 * is required to exercise the dep tracer's param-value-walk code path
 * (otherwise the tracer would log "param type unknown" and NOT walk
 * the value — meaning the seq → anim paths wouldn't be reached via
 * params). See the TD fixture's `readParam` for the same pattern.
 */
export class KalphiteQueenStubReader implements CacheReader {
    /** Synthesized OSRS model bytes (form1 body + form2 body). */
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
        this.modelBytes.set(KQ_FORM1_MODEL_ID, synthesizeOsrsModelBlob());
        this.modelBytes.set(KQ_FORM2_MODEL_ID, synthesizeOsrsModelBlob());
        this.baseBytes.set(KQ_BASE_ID, synthesizeOsrsAnimBaseBlob());
        this.animBytes.set(KQ_ANIM_IDLE_ID, synthesizeOsrsAnimFrameBlob(KQ_BASE_ID, 10, 20, 30, 5));
        this.animBytes.set(KQ_ANIM_FORM1_ATTACK_ID, synthesizeOsrsAnimFrameBlob(KQ_BASE_ID, 0, 0, 0, 0));
        this.animBytes.set(KQ_ANIM_DEATH_ID, synthesizeOsrsAnimFrameBlob(KQ_BASE_ID, -5, -10, -15, 0));
        this.animBytes.set(KQ_ANIM_FORM2_ATTACK_ID, synthesizeOsrsAnimFrameBlob(KQ_BASE_ID, 3, 6, 9, 0));
        this.seqBytes.set(KQ_SEQ_FORM1_IDLE_ID, synthesizeOsrsSeqBlob(KQ_ANIM_IDLE_ID, 'kq1_idle'));
        this.seqBytes.set(KQ_SEQ_FORM1_ATTACK_ID, synthesizeOsrsSeqBlob(KQ_ANIM_FORM1_ATTACK_ID, 'kq1_attack'));
        this.seqBytes.set(KQ_SEQ_FORM1_DEATH_ID, synthesizeOsrsSeqBlob(KQ_ANIM_DEATH_ID, 'kq1_death'));
        this.seqBytes.set(KQ_SEQ_FORM2_IDLE_ID, synthesizeOsrsSeqBlob(KQ_ANIM_IDLE_ID, 'kq2_idle'));
        this.seqBytes.set(KQ_SEQ_FORM2_ATTACK_ID, synthesizeOsrsSeqBlob(KQ_ANIM_FORM2_ATTACK_ID, 'kq2_attack'));
        this.seqBytes.set(KQ_SEQ_FORM2_DEATH_ID, synthesizeOsrsSeqBlob(KQ_ANIM_DEATH_ID, 'kq2_death'));
        this.npcBytes.set(KQ_FORM1_NPC_ID, synthesizeOsrsForm1NpcBlob());
        this.npcBytes.set(KQ_FORM2_NPC_ID, synthesizeOsrsForm2NpcBlob());

        // Pre-load the AnimBase into the shared registry so OsrsAnimFrame.decode
        // can find it (mirroring what OsrsCacheAssetReader.readAnimBase does).
        this.loadAnimBase(KQ_BASE_ID);
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
        // missing leaf. The KQ's `kq_head` obj ref (discovered via the script
        // scanner) will be recorded as missing here too.
        return null;
    }

    readParam(id: number): ParamType | null {
        // Both forms use the same two params (1234=attack_anim, 1235=death_anim),
        // both seq-typed. We synthesize stub ParamType instances so the dep
        // tracer's `walkParams` walks the param VALUE (the seq ID) as a seq
        // ref — exercising the param-value-walk code path. Mirrors what a
        // real OSRS cache would provide via the (not-yet-ported) OsrsParamType.
        if (id === KQ_PARAM_ATTACK_ANIM || id === KQ_PARAM_DEATH_ANIM) {
            const stub = new ParamType(id);
            stub.type = ScriptVarType.SEQ;  // 65 — 'seq'
            stub.debugname = id === KQ_PARAM_ATTACK_ANIM ? 'attack_anim' : 'death_anim';
            return stub;
        }
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
                printWarning(`KalphiteQueenStubReader: npc ${id} decode failed: ${(err as Error).message}`);
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
                printWarning(`KalphiteQueenStubReader: seq ${id} decode failed: ${(err as Error).message}`);
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
 * The placeholder runescript content for the Kalphite Queen's combat script.
 *
 * This is intentionally a stub — the real KQ combat script is a complex
 * runescript that drives the queen's AI behavior (ranged melee, magic
 * attacks, the green-ish spawn adds, etc.). For the pilot, we just need:
 *
 *   1. A `[ai_applayer2,Kalphite Queen]` dispatch directive so the dep
 *      tracer's `findScriptsForNpc()` finds this file for BOTH forms
 *      (they share the display name "Kalphite Queen"). The scanner
 *      records the script as a dep for each NPC node.
 *
 *   2. An `inv_has(worn, kq_head)` call site so the script scanner
 *      discovers the `kq_head` obj ref and records it as a missing
 *      dep — proving the tracer walks the script → obj edge for the
 *      KQ too (matching the TD's `fire_shield` pattern).
 *
 *   3. An `npc_anim(kq1_attack, 0)` call site so the scanner also
 *      discovers the `kq1_attack` seq ref (the script references the
 *      seq by name — a missing dep because the script scanner can't
 *      resolve names to cache IDs without pack files).
 *
 *   4. A `[npc_assoc]` block declaring which NPCs this script belongs
 *      to (LostCity convention; doesn't affect the dep tracer but
 *      documents intent). Lists BOTH forms because they share the
 *      combat AI.
 *
 *   5. An `[obj_assoc]` block declaring the kq_head item drop
 *      (LostCity convention; doesn't affect the dep tracer but
 *      documents intent — the KQ drops her head as a chunk on death).
 */
const KQ_COMBAT_SCRIPT = `// Kalphite Queen combat script (synthesized stub for the OSRS pipeline pilot).
//
// This is a PLACEHOLDER — the real KQ combat script is a complex runescript
// driving the queen's AI: ranged melee, magic attacks, the green-ish spawn
// adds, and the form-swap on death. For the pilot we only need enough
// content for the dep tracer to discover the kq_head obj dependency via the
// script scanner.

[npc_assoc]
kalphite_queen
kalphite_queen_2

[obj_assoc]
kq_head

// Two dispatch directives — one per form. The dep tracer's
// findScriptsForNpc() looks for [<trigger>,<npcName>] directives where
// <npcName> is the NPC's display name. Form 1's name is "Kalphite Queen"
// and form 2's name is "Kalphite Queen (form 2)" (the distinct name lets
// the writer's sanitizeName produce distinct debugnames — see the fixture's
// synthesizeOsrsForm2NpcBlob docstring for the rationale).
[ai_applayer2,Kalphite Queen]
[ai_applayer2,Kalphite Queen (form 2)]
// Combat AI: the queen checks if the player is wearing the kq_head item
// (a placeholder for "did the player already get the KQ head drop this
// kill"). If so, the queen enrages (uses the stronger attack). If not,
// normal attack.
if (inv_has(worn, kq_head)) {
    npc_anim(kq1_attack, 0);
    sound_synth(kq_roar, 0, 30);
} else {
    npc_anim(kq1_attack, 0);
    sound_synth(kq_roar, 0, 60);
}
`;

// ---- Fixture generator ----

/**
 * Generate the Kalphite Queen test fixture.
 *
 * Writes a temp directory under `os.tmpdir()` containing:
 *   - `<cacheDir>/scripts/npc/scripts/kalphite_queen.rs2` — fake combat script.
 *
 * Returns the path + the OSRS NPC IDs (form1 + form2) + the expected dep
 * count. The caller is expected to:
 *   1. Construct a `KalphiteQueenStubReader` (which synthesizes the OSRS
 *      bytes in-memory — no disk I/O for the bytes themselves).
 *   2. Construct a `DependencyTracer` with `scriptDir = <cacheDir>/scripts/npc/scripts`.
 *   3. Call `tracer.trace(fixture.form1Id)` to produce the DepsMap (the
 *      tracer walks multinpc[1] from form 1 to form 2 automatically).
 *
 * Cleanup: the caller is responsible for deleting `cacheDir` when done
 * (the pilot script does this on exit unless `--keep-fixture` is passed).
 */
export function generateKalphiteQueenFixture(): KalphiteQueenFixture {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osrs-kq-fixture-'));
    printInfo(`KalphiteQueenFixture: created temp dir ${cacheDir}`);

    // Write the fake combat script.
    const scriptDir = path.join(cacheDir, 'scripts', 'npc', 'scripts');
    const scriptPath = path.join(scriptDir, 'kalphite_queen.rs2');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(scriptPath, KQ_COMBAT_SCRIPT, 'utf8');
    printInfo(`KalphiteQueenFixture: wrote combat script to ${scriptPath}`);

    return {
        cacheDir,
        form1Id: KQ_FORM1_NPC_ID,
        form2Id: KQ_FORM2_NPC_ID,
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
export function cleanupFixture(fixture: KalphiteQueenFixture): void {
    try {
        fs.rmSync(fixture.cacheDir, { recursive: true, force: true });
        printInfo(`KalphiteQueenFixture: cleaned up ${fixture.cacheDir}`);
    } catch (err) {
        printWarning(`KalphiteQueenFixture: failed to clean up ${fixture.cacheDir}: ${(err as Error).message}`);
    }
}
