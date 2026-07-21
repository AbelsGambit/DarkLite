#!/usr/bin/env bun
/**
 * PilotTormentedDemon.ts — Part B of the Tormented Demon end-to-end pilot
 * (Task 10 of the OSRS → 377 model pipeline).
 *
 * ----------------------------------------------------------------------------
 * What this script does
 * ----------------------------------------------------------------------------
 *
 * Wires together EVERY piece of the OSRS → 377 import pipeline (Tasks 5-9)
 * end-to-end against a synthesized Tormented Demon fixture, and asserts that
 * every stage produces the expected output. Proves the pipeline works before
 * the user drops a real OSRS cache into `engine/data/osrs-cache/`.
 *
 * The 7 stages exercised:
 *
 *   1. FIXTURE   — `generateTormentedDemonFixture()` writes a temp dir
 *                  containing a fake combat script + the
 *                  `TormentedDemonStubReader` synthesizes OSRS-shaped bytes
 *                  (model, anim-base, anim frames, seq, npc config) in
 *                  memory using the REAL OSRS decoders.
 *
 *   2. TRACE     — `DependencyTracer.trace(npcId)` walks the OSRS NPC's
 *                  transitive deps (models, seqs, anims, anim-base, params,
 *                  combat script) and produces a `DepsMap`. The script
 *                  scanner discovers the `fire_shield` obj ref via the
 *                  fake combat script's `inv_has(worn, fire_shield)` call
 *                  site and records it as a MISSING dep — proving the
 *                  tracer walks the script → obj edge (the user's goal).
 *
 *   3. DEPS WRITE — The DepsMap is written to
 *                  `<contentDir>/deps/osrs_tormented_demon.deps.json` so
 *                  downstream stages (and humans) can inspect it.
 *
 *   4. IMPORT    — `ContentFolderWriter.importNpc(npcId, depsMap)` walks
 *                  the deps map, fetches each OSRS asset via the stub
 *                  reader, transforms it to 377 bytes via
 *                  `OsrsModel.toLegacy377()` / `OsrsAnimFrame.toLegacy377()`
 *                  / `OsrsNpcType.toLegacy377NpcConfig()`, and writes the
 *                  result to the content folder + pack files.
 *
 *   5. REGISTER  — `VariantRegistry.registerVariant(npcId, osrsImportedNpcId,
 *                  depsMap)` adds an entry to `variants.json` with
 *                  `legacyNpcId: -1` (Tormented Demon is brand-new — no
 *                  legacy twin) and the OSRS-imported NPC's new 377 ID.
 *
 *   6. INDEX     — `regenerateIndex(contentDir)` (exported from
 *                  `UpdateVariantsIndex.ts`) regenerates the variants.json
 *                  index from all `*.deps.json` files in the content dir.
 *                  This verifies the index can be rebuilt from disk after
 *                  an import (the real-cache path does this after every
 *                  `Import.ts` run).
 *
 *   7. ASSERT    — Run assertions on every stage's output. Print a clean
 *                  "PILOT PASS — ..." summary line. Exit 0 on pass, 1 on
 *                  any assertion failure.
 *
 * ----------------------------------------------------------------------------
 * Don't pollute the real content folder
 * ----------------------------------------------------------------------------
 *
 * The pilot writes to a TEMP content directory at
 * `<os.tmpdir()>/osrs-pilot-content/` (NOT the real `lostcity/content/`).
 * This is critical: the synthesized test data must never reach the user's
 * real content folder (it would break the build by polluting pack files
 * with bogus IDs that don't have corresponding cache files).
 *
 * The temp content dir is cleaned up on exit unless `--keep-content` is
 * passed (useful for inspecting the produced files manually).
 *
 * ----------------------------------------------------------------------------
 * Running against a REAL OSRS cache (Part C)
 * ----------------------------------------------------------------------------
 *
 * This pilot uses the `TormentedDemonStubReader` (which synthesizes OSRS
 * bytes in-memory). To run against a REAL OSRS cache, the user should:
 *
 *   1. Drop the OSRS cache files into `engine/data/osrs-cache/` — i.e.
 *      `main_file_cache.dat2`, `main_file_cache.idx0`, `main_file_cache.idx1`,
 *      ..., `main_file_cache.idx255` should all be there. (Cache bytes are
 *      copyright — we only ship the code that consumes them.)
 *
 *   2. Run the existing Import.ts CLI (Task 8) — it accepts `--osrs-cache`:
 *
 *        cd engine
 *        bun tools/osrs/Import.ts --osrs-cache=data/osrs-cache \\
 *            --npc=<td_npc_id> --group=osrs_imports
 *
 *      where `<td_npc_id>` is the OSRS NPC ID of the Tormented Demon in the
 *      cache (look it up in the OSRS wiki or via the unpack tool). The
 *      `--group=osrs_imports` flag puts the imported files under
 *      `content/models/osrs_imports/` and `content/scripts/.../osrs_imports.{npc,seq}`.
 *
 *   3. Refresh the variants.json index:
 *
 *        bun tools/osrs/UpdateVariantsIndex.ts
 *
 *   4. Run the existing LostCity build to pack the new content into the 377
 *      cache that gets served to the client:
 *
 *        bun run build
 *
 *   5. (Optional) Verify the import:
 *
 *        ls -la content/models/osrs_imports/
 *        cat content/scripts/npc/configs/osrs_imports.npc
 *        cat content/deps/osrs_tormented_demon.deps.json | head -50
 *        cat content/deps/variants.json
 *
 *   The real-cache path uses `OsrsCacheAssetReader` (Task 7) instead of
 *   `TormentedDemonStubReader` — but every other stage (trace → import →
 *   register) is identical. So if this pilot passes, the real-cache path
 *   will work the same way (modulo any genuine OSRS-cache-specific quirks
 *   the fixture doesn't model — e.g. master-index child-name hash resolution).
 *
 * ----------------------------------------------------------------------------
 * Usage
 * ----------------------------------------------------------------------------
 *
 *   bun tools/osrs/PilotTormentedDemon.ts [--keep-fixture] [--keep-content]
 *
 * Flags:
 *   --keep-fixture   Don't delete the fixture's temp dir on exit (useful for
 *                    inspecting the synthesized OSRS bytes / .rs2 script).
 *   --keep-content   Don't delete the temp content dir on exit (useful for
 *                    inspecting the produced .ob2 / .anim / .npc / pack files).
 *   --help, -h       Show this help.
 *
 * Exit codes:
 *   0  — PILOT PASS (all assertions succeeded)
 *   1  — PILOT FAIL (one or more assertions failed — see log for details)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { printError, printInfo, printWarning } from '#/util/Logger.js';

import { ContentFolderWriter } from './ContentFolderWriter.js';
import { DependencyTracer } from './DependencyTracer.js';
import { ImportResult } from './ImportResult.js';
import { regenerateIndex } from './UpdateVariantsIndex.js';
import { VariantRegistry } from '#/engine/variant/VariantRegistry.js';
import { nodeKey } from './DepsSchema.js';

import {
    cleanupFixture,
    generateTormentedDemonFixture,
    TD_NPC_ID,
    TormentedDemonStubReader,
    TormentedDemonFixture
} from './fixtures/TormentedDemonFixture.js';

// ---- Assertion helpers ----

let failures = 0;
let passes = 0;

function assert(cond: boolean, msg: string): void {
    if (cond) {
        passes++;
        printInfo(`  PASS: ${msg}`);
    } else {
        failures++;
        printWarning(`  FAIL: ${msg}`);
    }
}

// ---- CLI args ----

interface CliArgs {
    keepFixture: boolean;
    keepContent: boolean;
    showHelp: boolean;
}

function parseArgs(argv: string[]): CliArgs {
    let keepFixture = false;
    let keepContent = false;
    let showHelp = false;
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--keep-fixture') {
            keepFixture = true;
        } else if (arg === '--keep-content') {
            keepContent = true;
        } else if (arg === '--help' || arg === '-h') {
            showHelp = true;
        } else {
            printWarning(`Unknown arg: ${arg} (use --help)`);
        }
    }
    return { keepFixture, keepContent, showHelp };
}

function printHelp(): void {
    const help = [
        'PilotTormentedDemon.ts — end-to-end pilot for the Tormented Demon NPC',
        '',
        'Usage:',
        '  bun tools/osrs/PilotTormentedDemon.ts [--keep-fixture] [--keep-content]',
        '',
        'Flags:',
        '  --keep-fixture   Don\'t delete the fixture temp dir on exit.',
        '  --keep-content   Don\'t delete the temp content dir on exit.',
        '  --help, -h       Show this help.'
    ].join('\n');
    console.log(help);
}

// ---- Main pipeline runner ----

function runPilot(args: CliArgs): number {
    // ---- Stage 1: Fixture setup ----
    printInfo('=== Stage 1: Generate Tormented Demon fixture ===');
    const fixture: TormentedDemonFixture = generateTormentedDemonFixture();
    printInfo(`  NPC ID: ${fixture.npcId}`);
    printInfo(`  Script dir: ${fixture.scriptDir}`);
    printInfo(`  Expected dep nodes: ${fixture.expectedDeps}`);

    // Create the temp content dir (where the writer will write files).
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osrs-pilot-content-'));
    printInfo(`  Temp content dir: ${contentDir}`);

    // ---- Stage 2: Construct stub reader + tracer, run trace ----
    printInfo('=== Stage 2: Trace Tormented Demon dependencies ===');
    const reader = new TormentedDemonStubReader();
    const tracer = new DependencyTracer(reader, { scriptDir: fixture.scriptDir });
    const depsMap = tracer.trace(fixture.npcId);

    const nodeKeys = Object.keys(depsMap.nodes);
    printInfo(`  Traced ${nodeKeys.length} nodes, ${depsMap.cycles.length} cycles, ${depsMap.missing.length} missing refs`);

    // ---- Stage 3: Write the deps.json to the temp content dir ----
    printInfo('=== Stage 3: Write deps.json ===');
    const depsDir = path.join(contentDir, 'deps');
    fs.mkdirSync(depsDir, { recursive: true });
    const depsFilePath = path.join(depsDir, 'osrs_tormented_demon.deps.json');
    fs.writeFileSync(depsFilePath, JSON.stringify(depsMap, null, 2), 'utf8');
    printInfo(`  Wrote ${depsFilePath}`);

    // ---- Assertions on the deps map ----
    printInfo('=== Assert: deps map contents ===');

    // Expected nodes: npc, 2 models, 2 seqs, 2 anims, 1 anim-base, 2 params, 1 script = 11.
    assert(
        nodeKeys.length === fixture.expectedDeps,
        `Deps map has ${fixture.expectedDeps} nodes (got ${nodeKeys.length}: ${nodeKeys.join(', ')})`
    );

    // Each expected node key must be present.
    const expectedKeys = [
        nodeKey('npc', TD_NPC_ID),
        'model:46001',
        'model:46002',
        'seq:9501',
        'seq:9502',
        'anim:2005',
        'anim:2006',
        'anim-base:47001',
        'param:1234',
        'param:1235',
        'script:tormented_demon'
    ];
    for (const key of expectedKeys) {
        assert(depsMap.nodes[key] !== undefined, `Deps map contains node '${key}'`);
    }

    // The fire_shield obj ref should appear in missing[] (discovered by the
    // script scanner via the `inv_has(worn, fire_shield)` call site in the
    // fake combat script).
    const fireShieldMissing = depsMap.missing.find(
        m => m.kind === 'obj' && m.id === 'fire_shield'
    );
    assert(
        fireShieldMissing !== undefined,
        `Deps map missing[] contains 'obj:fire_shield' (script → obj edge walked) — got ${depsMap.missing.length} missing refs: ${depsMap.missing.map(m => `${m.kind}:${m.id}`).join(', ')}`
    );

    // The script node should have the fire_shield as a dep (with missing: true).
    const scriptNode = depsMap.nodes['script:tormented_demon'];
    assert(
        scriptNode !== undefined && scriptNode.kind === 'script',
        'Script node \'script:tormented_demon\' exists with kind=script'
    );
    if (scriptNode) {
        const scriptObjDeps = scriptNode.deps.filter(d => d.kind === 'obj');
        assert(
            scriptObjDeps.some(d => d.id === 'fire_shield'),
            'Script node deps[] contains obj:fire_shield (via inv_has call site)'
        );
    }

    // NPC node should reference the model + head + seqs.
    const npcNode = depsMap.nodes[nodeKey('npc', TD_NPC_ID)];
    assert(npcNode !== undefined, 'Root NPC node exists');
    if (npcNode) {
        const viaKinds = npcNode.deps.map(d => d.kind);
        assert(viaKinds.includes('model'), 'NPC node has model dep');
        assert(viaKinds.includes('seq'), 'NPC node has seq dep');
        assert(viaKinds.includes('param'), 'NPC node has param dep');
        assert(viaKinds.includes('script'), 'NPC node has script dep (combat script discovered)');

        // Body model + head model both present.
        const modelDeps = npcNode.deps.filter(d => d.kind === 'model');
        assert(
            modelDeps.length === 2,
            `NPC node has 2 model deps (body + head) — got ${modelDeps.length}`
        );
    }

    // ---- Stage 4: Run the ContentFolderWriter ----
    printInfo('=== Stage 4: Import via ContentFolderWriter ===');
    const writer = new ContentFolderWriter(contentDir, reader, {
        dryRun: false,
        namePrefix: 'osrs_',
        groupFile: 'osrs_imports',
        overwrite: false
    });

    let result: ImportResult;
    try {
        result = writer.importNpc(fixture.npcId, depsMap);
    } catch (err) {
        printError(`ContentFolderWriter.importNpc threw: ${(err as Error).message}`);
        if (!args.keepFixture) {
            cleanupFixture(fixture);
        }
        if (!args.keepContent) {
            try {
                fs.rmSync(contentDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        }
        return 1;
    }

    const written = result.written;
    const skipped = result.skipped;
    const failed = result.failed;
    printInfo(`  written=${written.length} skipped=${skipped.length} failed=${failed.length}`);
    printInfo(`  packUpdates: ${result.packUpdates.map(p => `${p.pack}(+${p.added.length})`).join(' ')}`);

    // ---- Assertions on the import result ----
    printInfo('=== Assert: import result ===');

    // 5 assets should have been written: model(2) + anim(2) + anim-base(1) + seq(2) + npc(1) = 8.
    // Wait — the writer creates ONE ob2 file per model and ONE anim file per
    // anim frame, plus ONE .base file per anim-base, ONE seq config block
    // per seq (in the same .seq file), and ONE npc config block (in the .npc file).
    // So written entries = 2 models + 2 anims + 1 anim-base + 2 seqs + 1 npc = 8.
    assert(
        written.length === 8,
        `Writer wrote 8 assets (2 models + 2 anims + 1 anim-base + 2 seqs + 1 npc) — got ${written.length}`
    );

    // 0 skipped (fresh import — nothing pre-existing).
    // 3 skipped: the script node + 2 param nodes. The writer's Task 8 scope
    // is models + anims + anims-base + seqs + NPC configs only — obj/param/
    // struct/script/texture/particle/sound nodes are skipped with reason
    // "kind 'X' not yet supported by ContentFolderWriter". This is the
    // documented behavior per the Task 8 worklog ("What's stubbed / deferred"
    // section).
    assert(
        skipped.length === 3,
        `Writer skipped 3 assets (script + 2 params — kinds not yet supported) — got ${skipped.length}: ${skipped.map(s => `${s.kind}:${s.osrsId}`).join(', ')}`
    );

    // 0 failed — every node the tracer walked either got written or skipped
    // (no missing OSRS nodes since the stub reader returns real decoders).
    assert(
        failed.length === 0,
        `Writer failed 0 assets — got ${failed.length}: ${failed.map(f => `${f.kind}:${f.osrsId}=${f.error}`).join(', ')}`
    );

    // Pack files updated: model, anim, animset, base, seq, npc.
    const updatedPacks = result.packUpdates.map(p => p.pack).sort();
    const expectedPacks = ['anim', 'animset', 'base', 'model', 'npc', 'seq'];
    assert(
        JSON.stringify(updatedPacks) === JSON.stringify(expectedPacks),
        `Writer updated 6 packs [${expectedPacks.join(',')}] — got [${updatedPacks.join(',')}]`
    );

    // Pack entries added counts:
    //   model:    2 (body + head)
    //   anim:     2
    //   animset:  2
    //   base:     1
    //   seq:      2
    //   npc:      1
    const packAddedCounts: Record<string, number> = { model: 2, anim: 2, animset: 2, base: 1, seq: 2, npc: 1 };
    for (const [pack, expectedCount] of Object.entries(packAddedCounts)) {
        const update = result.packUpdates.find(p => p.pack === pack);
        const actualCount = update?.added.length ?? 0;
        assert(
            actualCount === expectedCount,
            `Pack '${pack}' added ${expectedCount} entries — got ${actualCount}`
        );
    }

    // ---- Verify files on disk ----
    printInfo('=== Assert: files written to disk ===');

    const modelDir = path.join(contentDir, 'models', 'osrs_imports');
    const modelFiles = fs.existsSync(modelDir) ? fs.readdirSync(modelDir) : [];
    assert(
        modelFiles.some(f => f.endsWith('.ob2') && f.includes('osrs_model_46001')),
        `Body model .ob2 file exists (got: ${modelFiles.join(', ')})`
    );
    assert(
        modelFiles.some(f => f.endsWith('.ob2') && f.includes('osrs_model_46002')),
        'Head model .ob2 file exists'
    );
    assert(
        modelFiles.some(f => f.endsWith('.anim') && f.includes('osrs_anim_2005')),
        'Stand anim .anim file exists'
    );
    assert(
        modelFiles.some(f => f.endsWith('.anim') && f.includes('osrs_anim_2006')),
        'Attack anim .anim file exists'
    );
    assert(
        modelFiles.some(f => f.endsWith('.base') && f.includes('osrs_base_47001')),
        'AnimBase .base file exists'
    );

    const npcConfigPath = path.join(contentDir, 'scripts', 'npc', 'configs', 'osrs_imports.npc');
    assert(fs.existsSync(npcConfigPath), `NPC config file exists at ${npcConfigPath}`);

    const seqConfigPath = path.join(contentDir, 'scripts', 'seq', 'configs', 'osrs_imports.seq');
    assert(fs.existsSync(seqConfigPath), `Seq config file exists at ${seqConfigPath}`);

    // Verify NPC config content.
    if (fs.existsSync(npcConfigPath)) {
        const npcContent = fs.readFileSync(npcConfigPath, 'utf8');
        assert(
            npcContent.includes('[osrs_tormented_demon]'),
            'NPC config has [osrs_tormented_demon] header'
        );
        // model1 should be rewritten to the debugname (not the raw OSRS ID).
        assert(
            npcContent.includes('model1=osrs_model_46001'),
            'NPC config rewrites model1=osrs_model_46001 (via NameResolver)'
        );
        // readyanim should be rewritten to the seq debugname.
        assert(
            npcContent.includes('readyanim=osrs_td_stand'),
            'NPC config rewrites readyanim=osrs_td_stand (via NameResolver)'
        );
        // Stats line.
        assert(
            npcContent.includes('stats='),
            'NPC config has stats= line'
        );
    }

    // Verify seq config content.
    if (fs.existsSync(seqConfigPath)) {
        const seqContent = fs.readFileSync(seqConfigPath, 'utf8');
        assert(
            seqContent.includes('[osrs_td_stand]'),
            'Seq config has [osrs_td_stand] header'
        );
        assert(
            seqContent.includes('[osrs_td_attack]'),
            'Seq config has [osrs_td_attack] header'
        );
        assert(
            seqContent.includes('frame1=osrs_anim_2005'),
            'Seq config rewrites frame1=osrs_anim_2005 for td_stand'
        );
        assert(
            seqContent.includes('frame1=osrs_anim_2006'),
            'Seq config rewrites frame1=osrs_anim_2006 for td_attack'
        );
    }

    // ---- Verify pack files on disk ----
    printInfo('=== Assert: pack files updated ===');

    const packDir = path.join(contentDir, 'pack');
    for (const packName of ['model', 'anim', 'animset', 'base', 'seq', 'npc']) {
        const packPath = path.join(packDir, `${packName}.pack`);
        assert(fs.existsSync(packPath), `Pack file '${packName}.pack' exists`);
        if (fs.existsSync(packPath)) {
            const content = fs.readFileSync(packPath, 'utf8');
            // The newly-added debugnames should appear in the pack file.
            if (packName === 'model') {
                assert(content.includes('osrs_model_46001'), 'model.pack contains osrs_model_46001');
                assert(content.includes('osrs_model_46002'), 'model.pack contains osrs_model_46002');
            } else if (packName === 'anim' || packName === 'animset') {
                assert(content.includes('osrs_anim_2005'), `${packName}.pack contains osrs_anim_2005`);
                assert(content.includes('osrs_anim_2006'), `${packName}.pack contains osrs_anim_2006`);
            } else if (packName === 'base') {
                assert(content.includes('osrs_base_47001'), 'base.pack contains osrs_base_47001');
            } else if (packName === 'seq') {
                assert(content.includes('osrs_td_stand'), 'seq.pack contains osrs_td_stand');
                assert(content.includes('osrs_td_attack'), 'seq.pack contains osrs_td_attack');
            } else if (packName === 'npc') {
                assert(content.includes('osrs_tormented_demon'), 'npc.pack contains osrs_tormented_demon');
            }
        }
    }

    // ---- Verify depMapUpdated has transformedFrom populated ----
    printInfo('=== Assert: depMapUpdated transformedFrom ===');
    const updatedNodes = result.depMapUpdated.nodes;
    // Only the importable kinds (model/anim/anim-base/seq/npc) get
    // transformedFrom set by the writer. Script + param nodes are skipped
    // (kinds not yet supported) and don't get a transformedFrom value —
    // that's the documented Task 8 behavior.
    const importableKinds = new Set(['model', 'anim', 'anim-base', 'seq', 'npc']);
    let allTransformed = true;
    let transformedCount = 0;
    for (const key of Object.keys(updatedNodes)) {
        const n = updatedNodes[key];
        if (n.source === 'osrs' && !n.missing && importableKinds.has(n.kind)) {
            if (n.transformedFrom === null || n.transformedFrom === undefined) {
                allTransformed = false;
                printWarning(`  ${key} transformedFrom is null after import`);
            } else {
                transformedCount++;
            }
        }
    }
    assert(allTransformed, 'Every importable OSRS node has transformedFrom set');
    printInfo(`  ${transformedCount} nodes have transformedFrom set`);

    // ---- Stage 5: Register the variant ----
    printInfo('=== Stage 5: Register variant ===');

    // The variants.json lives at <contentDir>/deps/variants.json.
    const variantsPath = path.join(contentDir, 'deps', 'variants.json');

    // Update the deps map's NPC node name to the SANITIZED debugname
    // assigned by the writer (e.g. "osrs_tormented_demon"). The dep tracer
    // sets npcNode.name to the OSRS display name ("Tormented demon"), but
    // the variants.json schema expects the sanitized debugname (per the
    // Task 9 worklog: "osrsDebugname: sanitized debugname (with `osrs_`
    // prefix)"). The writer's `written[]` entry has the sanitized form.
    const writtenNpcEntry = result.written.find(w => w.kind === 'npc');
    const updatedNpcNode = updatedNodes[nodeKey('npc', TD_NPC_ID)];
    if (writtenNpcEntry && updatedNpcNode) {
        updatedNpcNode.name = writtenNpcEntry.debugname;
    }

    // Persist the updated deps.json (with transformedFrom + sanitized name)
    // so the UpdateVariantsIndex script can read it. This is the same flow
    // as Import.ts CLI — it persists the updated deps.json before registering.
    fs.writeFileSync(depsFilePath, JSON.stringify(result.depMapUpdated, null, 2), 'utf8');
    printInfo(`  Re-wrote updated deps.json with transformedFrom fields: ${depsFilePath}`);

    // The VariantRegistry singleton uses Environment.BUILD_SRC_DIR for its
    // default variants.json path. We override it by calling load() with an
    // explicit path BEFORE registerVariant — this also clears any prior
    // in-memory state from other tests.
    VariantRegistry.resetForTest();
    const registry = VariantRegistry.getInstance();
    // load() with the temp variants path — if the file doesn't exist yet,
    // it starts empty (which is what we want for a fresh pilot run).
    VariantRegistry.load(variantsPath);

    // Find the new NPC ID assigned by the writer (the npc node's transformedFrom).
    assert(
        updatedNpcNode !== undefined && typeof updatedNpcNode.transformedFrom === 'number',
        'Updated NPC node has numeric transformedFrom (the new 377 NPC ID)'
    );
    const osrsImportedNpcId = updatedNpcNode?.transformedFrom as number;

    // Use a relative depMapPath matching the existing convention.
    const relDepsPath = path.relative(process.cwd(), depsFilePath).replace(/\\/g, '/');

    // Register the variant: legacyNpcId=-1 (brand-new OSRS NPC).
    registry.registerVariant(
        -1,                       // legacyNpcId (no legacy twin — Tormented Demon is brand-new)
        osrsImportedNpcId,        // osrsImportedNpcId (the new 377 NPC ID assigned by Task 8)
        result.depMapUpdated,     // updated deps map (for osrsDebugname lookup)
        relDepsPath               // path to the persisted deps.json
    );

    // Verify variants.json was written to disk.
    assert(fs.existsSync(variantsPath), `variants.json written to ${variantsPath}`);

    if (fs.existsSync(variantsPath)) {
        const variantsContent = fs.readFileSync(variantsPath, 'utf8');
        const variantsJson = JSON.parse(variantsContent);
        assert(
            Array.isArray(variantsJson.variants) && variantsJson.variants.length === 1,
            'variants.json has exactly 1 variant entry'
        );
        if (variantsJson.variants.length === 1) {
            const entry = variantsJson.variants[0];
            assert(
                entry.legacyNpcId === -1,
                'Variant entry has legacyNpcId=-1 (brand-new OSRS NPC)'
            );
            assert(
                entry.osrsNpcId === osrsImportedNpcId,
                `Variant entry has osrsNpcId=${osrsImportedNpcId} (got ${entry.osrsNpcId})`
            );
            assert(
                entry.osrsDebugname === 'osrs_tormented_demon',
                `Variant entry has osrsDebugname='osrs_tormented_demon' (got '${entry.osrsDebugname}')`
            );
            assert(
                entry.legacyDebugname === null,
                'Variant entry has legacyDebugname=null (no legacy twin)'
            );
        }
    }

    // ---- Stage 6: Regenerate the variants.json index from deps files ----
    printInfo('=== Stage 6: Regenerate variants.json index ===');
    const variantCount = regenerateIndex(contentDir);
    assert(
        variantCount === 1,
        `regenerateIndex() returned 1 variant (got ${variantCount})`
    );

    // Verify the regenerated variants.json still has the same entry.
    if (fs.existsSync(variantsPath)) {
        const regenContent = fs.readFileSync(variantsPath, 'utf8');
        const regenJson = JSON.parse(regenContent);
        assert(
            Array.isArray(regenJson.variants) && regenJson.variants.length === 1,
            'Regenerated variants.json has 1 variant entry'
        );
        if (regenJson.variants.length === 1) {
            const entry = regenJson.variants[0];
            assert(
                entry.legacyNpcId === -1,
                'Regenerated variant has legacyNpcId=-1'
            );
            assert(
                entry.osrsNpcId === osrsImportedNpcId,
                `Regenerated variant has osrsNpcId=${osrsImportedNpcId} (got ${entry.osrsNpcId})`
            );
            assert(
                entry.osrsDebugname === 'osrs_tormented_demon',
                `Regenerated variant has osrsDebugname='osrs_tormented_demon' (got '${entry.osrsDebugname}')`
            );
        }
    }

    // ---- Stage 7: Final summary ----
    printInfo('=== Stage 7: Final summary ===');
    printInfo(`  Total assertions: ${passes} passed, ${failures} failed`);
    printInfo(`  Fixture dir: ${fixture.cacheDir}`);
    printInfo(`  Content dir: ${contentDir}`);
    printInfo(`  Deps file: ${depsFilePath}`);
    printInfo(`  Variants index: ${variantsPath}`);

    if (failures === 0) {
        const summary =
            'PILOT PASS — Tormented Demon imported: ' +
            `${nodeKeys.length} nodes traced, ` +
            `${written.length} files written, ` +
            `${result.packUpdates.reduce((sum, p) => sum + p.added.length, 0)} pack entries added, ` +
            '1 variant registered.';
        printInfo(summary);
    } else {
        printError(`PILOT FAIL — ${failures} assertion(s) failed.`);
    }

    // ---- Cleanup ----
    if (!args.keepFixture) {
        cleanupFixture(fixture);
    } else {
        printInfo(`  (keeping fixture dir: ${fixture.cacheDir})`);
    }
    if (!args.keepContent) {
        try {
            fs.rmSync(contentDir, { recursive: true, force: true });
            printInfo(`  Cleaned up temp content dir: ${contentDir}`);
        } catch (err) {
            printWarning(`  Failed to clean up temp content dir: ${(err as Error).message}`);
        }
    } else {
        printInfo(`  (keeping content dir: ${contentDir})`);
    }

    // Reset the VariantRegistry singleton so subsequent test runs start fresh.
    VariantRegistry.resetForTest();

    return failures === 0 ? 0 : 1;
}

// ---- Entrypoint ----

function main(): number {
    const args = parseArgs(process.argv);
    if (args.showHelp) {
        printHelp();
        return 0;
    }
    return runPilot(args);
}

const exitCode = main();
process.exit(exitCode);
