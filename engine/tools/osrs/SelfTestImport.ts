/**
 * SelfTestImport.ts — idempotency self-test for ContentFolderWriter (Task 8).
 *
 * Synthesizes a fake DepsMap + stub CacheReader, runs the writer twice on
 * the same NPC, and asserts that:
 *   1. The first run writes the expected assets (model + anim + anim-base +
 *      seq + npc config).
 *   2. The first run produces correct ImportResult fields (written[],
 *      packUpdates[], depMapUpdated with transformedFrom populated).
 *   3. The second run is a NO-OP: every node is "skipped" with reason
 *      "already_imported", no new files are written, no pack entries added.
 *
 * The test uses a fresh temp directory as the content folder so it doesn't
 * pollute the real LostCity content folder. The temp dir is cleaned up on
 * exit (best-effort).
 *
 * Run with:
 *   bun tools/osrs/SelfTestImport.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import AnimBase from '#/cache/graphics/AnimBase.js';
import OsrsModel from '#/cache/osrs/OsrsModel.js';
import OsrsAnimFrame from '#/cache/osrs/OsrsAnimFrame.js';
import OsrsSeqType from '#/cache/osrs/OsrsSeqType.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import StructType from '#/cache/config/StructType.js';
import { printInfo, printWarning } from '#/util/Logger.js';

import { CacheReader } from './DependencyTracer.js';
import { DepsMap, DEPS_SCHEMA_VERSION } from './DepsSchema.js';
import { ContentFolderWriter } from './ContentFolderWriter.js';
import { ImportResult } from './ImportResult.js';
import { NodeKind } from './DepsSchema.js';

let failures = 0;

function assert(cond: boolean, msg: string): void {
    if (cond) {
        printInfo(`  PASS: ${msg}`);
    } else {
        failures++;
        printWarning(`  FAIL: ${msg}`);
    }
}

// ---- Synthesize stub OSRS assets ----

// Stub OsrsModel — bypass the private constructor via cast (same trick as
// SelfTest.ts from Task 6). We only need toLegacy377() to return some bytes;
// the actual byte content doesn't matter for the idempotency test.
const stubModel = new (OsrsModel as unknown as new (id: number) => OsrsModel)(45000);
(OsrsModel.prototype as unknown as { toLegacy377: () => Uint8Array }).toLegacy377 = function (): Uint8Array {
    return new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
};
// Ensure the stub instance's toLegacy377 uses the prototype override.
// (It does — JS method lookup goes through the prototype chain.)

// Stub OsrsAnimFrame — needs `base`, `frameId`, `frameLength`, `flags`,
// `length`, `groups`, `x`, `y`, `z`, `delay`. We need toLegacy377() to
// return bytes; the real implementation reads AnimBase.instances[base].
const stubAnimBase = new AnimBase();
stubAnimBase.length = 1;
stubAnimBase.types = new Int32Array([0]);
stubAnimBase.labels = [new Int32Array([0])];
AnimBase.instances[36] = stubAnimBase;

const stubAnim = new OsrsAnimFrame();
stubAnim.base = 36;
stubAnim.frameId = 0;
stubAnim.frameLength = 1;
stubAnim.flags = new Int32Array([0]);
stubAnim.length = 0;
stubAnim.groups = new Int32Array();
stubAnim.x = new Int32Array();
stubAnim.y = new Int32Array();
stubAnim.z = new Int32Array();
stubAnim.delay = 1;

// Stub OsrsSeqType — minimal fields. The writer reads `debugname`,
// `frames`, `iframes`, `delay`, `frameCount`.
const stubSeq = new OsrsSeqType(9200);
stubSeq.debugname = 'td_attack';
stubSeq.frameCount = 1;
stubSeq.frames = new Int32Array([2005]);
stubSeq.iframes = new Int32Array([-1]);
stubSeq.delay = new Int32Array([2]);

// Stub OsrsNpcType — minimal fields. The writer calls `toLegacy377NpcConfig()`.
const stubNpc = new OsrsNpcType(9001);
stubNpc.name = 'Tormented Demon Stub';
stubNpc.models = new Uint16Array([45000]);
stubNpc.readyanim = 9200;

// ---- Stub CacheReader ----

class StubReader implements CacheReader {
    readModel(id: number): OsrsModel | null {
        return id === 45000 ? stubModel : null;
    }
    readAnim(id: number): OsrsAnimFrame | null {
        return id === 2005 ? stubAnim : null;
    }
    readAnimBase(id: number): AnimBase | null {
        return id === 36 ? stubAnimBase : null;
    }
    readSeq(id: number): OsrsSeqType | null {
        return id === 9200 ? stubSeq : null;
    }
    readNpc(id: number): OsrsNpcType | null {
        return id === 9001 ? stubNpc : null;
    }
    readObj(): ObjType | null { return null; }
    readParam(): ParamType | null { return null; }
    readStruct(): StructType | null { return null; }
    readTexture(): Uint8Array | null { return null; }
    readParticle(): Uint8Array | null { return null; }
    readSound(): Uint8Array | null { return null; }
    getName(kind: NodeKind, id: number | string): string | null {
        if (kind === 'npc' && id === 9001) return 'Tormented Demon Stub';
        return null;
    }
}

// ---- Synthesize DepsMap ----

function buildDepsMap(): DepsMap {
    return {
        version: DEPS_SCHEMA_VERSION,
        root: { kind: 'npc', id: 9001, name: 'Tormented Demon Stub' },
        nodes: {
            'npc:9001': {
                kind: 'npc',
                id: 9001,
                name: 'Tormented Demon Stub',
                source: 'osrs',
                transformedFrom: null,
                deps: [
                    { kind: 'model', id: 45000, via: 'models[0]' },
                    { kind: 'seq', id: 9200, via: 'readyanim' }
                ]
            },
            'model:45000': {
                kind: 'model',
                id: 45000,
                name: null,
                source: 'osrs',
                transformedFrom: null,
                deps: []
            },
            'anim:2005': {
                kind: 'anim',
                id: 2005,
                name: null,
                source: 'osrs',
                transformedFrom: null,
                deps: [
                    { kind: 'anim-base', id: 36, via: 'base' }
                ]
            },
            'anim-base:36': {
                kind: 'anim-base',
                id: 36,
                name: null,
                source: 'osrs',
                transformedFrom: null,
                deps: []
            },
            'seq:9200': {
                kind: 'seq',
                id: 9200,
                name: 'td_attack',
                source: 'osrs',
                transformedFrom: null,
                deps: [
                    { kind: 'anim', id: 2005, via: 'frames[0]' }
                ]
            }
        },
        cycles: [],
        missing: []
    };
}

// ---- Main test ----

function runTest(): void {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osrs-import-test-'));
    printInfo(`Using temp content dir: ${tmpDir}`);

    try {
        const reader = new StubReader();
        const writer = new ContentFolderWriter(tmpDir, reader, {
            dryRun: false,
            namePrefix: 'osrs_',
            groupFile: 'td_stub',
            overwrite: false
        });

        // ---- First run ----
        printInfo('Run 1: initial import');
        const depsMap1 = buildDepsMap();
        const result1: ImportResult = writer.importNpc(9001, depsMap1);

        // Verify written[] has the expected entries.
        assert(result1.written.length === 5, `Run 1 wrote 5 assets (got ${result1.written.length})`);
        const writtenKinds = result1.written.map(w => w.kind).sort();
        assert(
            JSON.stringify(writtenKinds) === JSON.stringify(['anim', 'anim-base', 'model', 'npc', 'seq']),
            `Run 1 wrote all 5 kinds (got ${JSON.stringify(writtenKinds)})`
        );
        assert(result1.skipped.length === 0, `Run 1 skipped 0 (got ${result1.skipped.length})`);
        assert(result1.failed.length === 0, `Run 1 failed 0 (got ${result1.failed.length})`);

        // Verify packUpdates[] — model + anim + animset + base + seq + npc.
        const updatedPacks = result1.packUpdates.map(p => p.pack).sort();
        assert(
            JSON.stringify(updatedPacks) === JSON.stringify(['anim', 'animset', 'base', 'model', 'npc', 'seq']),
            `Run 1 updated 6 packs (got ${JSON.stringify(updatedPacks)})`
        );

        // Verify depMapUpdated has transformedFrom populated on every node.
        const nodes = result1.depMapUpdated.nodes;
        let allTransformed = true;
        for (const key of Object.keys(nodes)) {
            const n = nodes[key];
            if (n.source === 'osrs' && (n.transformedFrom === null || n.transformedFrom === undefined)) {
                allTransformed = false;
                printWarning(`  ${key} transformedFrom is null after Run 1`);
            }
        }
        assert(allTransformed, 'Run 1: every OSRS node has transformedFrom set');

        // Verify files were actually written to disk.
        const modelFile = path.join(tmpDir, 'models', 'td_stub', 'osrs_model_45000.ob2');
        assert(fs.existsSync(modelFile), `Run 1 wrote ${modelFile}`);
        const animFile = path.join(tmpDir, 'models', 'td_stub', 'osrs_anim_2005.anim');
        assert(fs.existsSync(animFile), `Run 1 wrote ${animFile}`);
        const baseFile = path.join(tmpDir, 'models', 'td_stub', 'osrs_base_36.base');
        assert(fs.existsSync(baseFile), `Run 1 wrote ${baseFile}`);
        const npcFile = path.join(tmpDir, 'scripts', 'npc', 'configs', 'td_stub.npc');
        assert(fs.existsSync(npcFile), `Run 1 wrote ${npcFile}`);
        const seqFile = path.join(tmpDir, 'scripts', 'seq', 'configs', 'td_stub.seq');
        assert(fs.existsSync(seqFile), `Run 1 wrote ${seqFile}`);

        // Verify pack files were updated.
        const modelPack = path.join(tmpDir, 'pack', 'model.pack');
        assert(fs.existsSync(modelPack), `Run 1 wrote ${modelPack}`);
        const modelPackContent = fs.readFileSync(modelPack, 'utf8');
        assert(
            modelPackContent.includes('osrs_model_45000'),
            'Run 1 registered osrs_model_45000 in model.pack'
        );

        // Verify NPC config file content.
        const npcContent = fs.readFileSync(npcFile, 'utf8');
        assert(
            npcContent.includes('[osrs_tormented_demon_stub]'),
            'Run 1 NPC config has [osrs_tormented_demon_stub] header'
        );
        assert(
            npcContent.includes('model1=osrs_model_45000'),
            'Run 1 NPC config rewrites model1=osrs_model_45000 (via NameResolver)'
        );
        assert(
            npcContent.includes('readyanim=osrs_td_attack'),
            'Run 1 NPC config rewrites readyanim=osrs_td_attack (via NameResolver)'
        );

        // Verify seq config file content.
        const seqContent = fs.readFileSync(seqFile, 'utf8');
        assert(
            seqContent.includes('[osrs_td_attack]'),
            'Run 1 seq config has [osrs_td_attack] header'
        );
        assert(
            seqContent.includes('frame1=osrs_anim_2005'),
            'Run 1 seq config rewrites frame1=osrs_anim_2005 (via NameResolver)'
        );

        // ---- Second run: idempotency ----
        printInfo('Run 2: idempotency check (should be a no-op)');
        // Use the depMapUpdated from Run 1 — this is what would be persisted
        // to deps.json and loaded on the next run.
        const depsMap2 = JSON.parse(JSON.stringify(result1.depMapUpdated)) as DepsMap;
        const writer2 = new ContentFolderWriter(tmpDir, reader, {
            dryRun: false,
            namePrefix: 'osrs_',
            groupFile: 'td_stub',
            overwrite: false
        });
        const result2: ImportResult = writer2.importNpc(9001, depsMap2);

        assert(result2.written.length === 0, `Run 2 wrote 0 assets (got ${result2.written.length})`);
        assert(
            result2.skipped.length === 5,
            `Run 2 skipped 5 assets (got ${result2.skipped.length})`
        );
        assert(result2.failed.length === 0, `Run 2 failed 0 (got ${result2.failed.length})`);

        // All skipped entries should have reason starting with "already_imported".
        const allAlreadyImported = result2.skipped.every(s => s.reason.startsWith('already_imported'));
        assert(allAlreadyImported, 'Run 2: every skip reason starts with "already_imported"');

        // Verify no new pack entries were added (pack files unchanged).
        const modelPackContent2 = fs.readFileSync(modelPack, 'utf8');
        assert(
            modelPackContent2 === modelPackContent,
            'Run 2: model.pack content unchanged'
        );

        // ---- Third run: dry-run should produce same written[] list but no file changes ----
        printInfo('Run 3: dry-run (should produce written[] but not modify files)');
        const depsMap3 = buildDepsMap(); // fresh map — no transformedFrom
        const writer3 = new ContentFolderWriter(tmpDir, reader, {
            dryRun: true,
            namePrefix: 'osrs_',
            groupFile: 'td_stub_dryrun',
            overwrite: false
        });
        const result3: ImportResult = writer3.importNpc(9001, depsMap3);

        assert(
            result3.written.length === 5,
            `Run 3 (dry-run) reported 5 would-write entries (got ${result3.written.length})`
        );
        assert(
            result3.written.every(w => w.path === '<dryrun>'),
            'Run 3 (dry-run): every written.path is "<dryrun>"'
        );

        // Verify the dry-run group's files were NOT created.
        const dryModelFile = path.join(tmpDir, 'models', 'td_stub_dryrun', 'osrs_model_45000.ob2');
        assert(
            !fs.existsSync(dryModelFile),
            'Run 3 (dry-run): no file written for dry-run group'
        );
    } finally {
        // Best-effort cleanup.
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup failures.
        }
    }
}

// ---- Run ----

printInfo('=== Task 8 SelfTestImport: starting ===');
runTest();
printInfo(failures === 0 ? '=== All Task 8 self-test assertions passed. ===' : `=== ${failures} Task 8 self-test failure(s). ===`);
if (failures > 0) {
    process.exit(1);
}
