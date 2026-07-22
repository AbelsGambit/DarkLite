#!/usr/bin/env bun
/**
 * PilotKalphiteQueen.ts — Part B of the Kalphite Queen end-to-end pilot
 * (Task 11 of the OSRS → 377 model pipeline).
 *
 * ----------------------------------------------------------------------------
 * What this script does
 * ----------------------------------------------------------------------------
 *
 * Wires together EVERY piece of the OSRS → 377 import pipeline (Tasks 5-9)
 * plus the Task 11 form-swap linkage extension, end-to-end against a
 * synthesized Kalphite Queen fixture (2 NPC forms). Asserts that every
 * stage produces the expected output. Proves the pipeline handles the
 * "tricky test" the user picked — a multi-form NPC with cross-form
 * dependencies.
 *
 * The 8 stages exercised:
 *
 *   1. FIXTURE   — `generateKalphiteQueenFixture()` writes a temp dir
 *                  with a fake combat script + the
 *                  `KalphiteQueenStubReader` synthesizes OSRS-shaped
 *                  bytes (2 models, 1 anim-base, 4 anim frames, 6 seqs,
 *                  2 NPC configs) in memory using the REAL OSRS decoders.
 *
 *   2. TRACE     — `DependencyTracer.trace(form1Id)` walks form 1's
 *                  transitive deps AND follows `multinpc[1]` to form 2
 *                  (the tracer walks multinpc separately from
 *                  `extractDependencyRefs()` — see Task 5-c worklog).
 *                  The result is a single DepsMap containing nodes for
 *                  BOTH forms. The script scanner discovers the `kq_head`
 *                  obj ref via `inv_has(worn, kq_head)` and records it as
 *                  a MISSING dep (proving the tracer walks the script →
 *                  obj edge for KQ too).
 *
 *   3. DEPS WRITE — DepsMap written to
 *                  `<contentDir>/deps/osrs_kalphite_queen.deps.json`.
 *
 *   4. IMPORT    — `ContentFolderWriter.importMany([form1Id, form2Id],
 *                  depsMap)` walks the deps map (which contains BOTH
 *                  forms), transforms each OSRS asset to 377 bytes, and
 *                  writes the result to the content folder + pack files.
 *                  Critical: form 1's NPC config has a `multinpc=1,<id>`
 *                  line that must be rewritten to `multinpc=1,<form2_debugname>`
 *                  — the writer's `topoSortNpcByMultinpc()` ensures form 2
 *                  is processed BEFORE form 1 so its debugname is in the
 *                  NameResolver when form 1's config is emitted.
 *
 *   5. REGISTER  — `VariantRegistry.registerVariant(-1, form1NewId, ...)`
 *                  AND `registerVariant(-1, form2NewId, ..., form2OsrsId)`
 *                  — adds TWO entries to `variants.json`, one per form.
 *                  Both have `legacyNpcId: -1` (no legacy twin in the
 *                  fixture's stub NpcType registry).
 *
 *   6. LINK      — `VariantRegistry.linkVariants(form1NewId, form2NewId)`
 *                  records the form-swap linkage. Persisted to
 *                  `variants.json` under `linkages: [[form1NewId,
 *                  form2NewId]]`. After this, `resolveNpcVariant` on
 *                  EITHER form consults the OTHER's per-NPC override too.
 *
 *   7. INDEX     — `regenerateIndex(contentDir)` regenerates the
 *                  variants.json from deps files. The Task 11 extension
 *                  to `processDepsFile` extracts ALL NPC nodes with
 *                  `transformedFrom` set (not just the root), so both
 *                  forms produce variant entries. Linkages are preserved
 *                  across regeneration (the index reads the existing
 *                  `linkages` field and writes it back).
 *
 *   8. ASSERT    — Run assertions on every stage's output. The critical
 *                  assertions:
 *                    - deps map has 18 nodes (2 NPCs + 2 models + 1
 *                      anim-base + 4 anims + 6 seqs + 2 params + 1 script)
 *                    - form 1's NPC config block in osrs_imports.npc has
 *                      `multinpc=1,osrs_kalphite_queen_2` (rewritten to
 *                      form 2's NEW debugname, NOT the OSRS ID 1159)
 *                    - variants.json has 2 entries (one per form)
 *                    - variants.json has a `linkages: [[0, 1]]` field
 *                      (assuming form1NewId=0, form2NewId=1)
 *                    - resolveNpcVariant(form1NewId, player_with_allOSRS)
 *                      → 'osrs'
 *                    - resolveNpcVariant(form2NewId, player_with_allOSRS)
 *                      → 'osrs' (both forms move together via eraPreset)
 *                    - resolveNpcVariant(form1NewId, player_with_override)
 *                      → 'legacy377' (direct override on form 1)
 *                    - resolveNpcVariant(form2NewId, player_with_override)
 *                      → 'legacy377' (via linkage — form 2 inherits
 *                      form 1's override; this is the key new assertion
 *                      that proves `linkVariants` works)
 *
 *   Prints a clean "PILOT PASS — ..." summary line. Exit 0 on pass, 1 on
 *   any assertion failure.
 *
 * ----------------------------------------------------------------------------
 * Why this pilot matters
 * ----------------------------------------------------------------------------
 *
 * The TD pilot (Task 10) proved the pipeline works for a single-form
 * brand-new NPC. The KQ pilot proves it ALSO works for:
 *
 *   - Multi-form NPCs (form-swap via opcode 106 multinpc).
 *   - Cross-form dep tracing (the tracer walks multinpc → form 2).
 *   - Cross-form ID rewriting (the writer rewrites `multinpc=1,<id>` to
 *     `multinpc=1,<debugname>` using form 2's NEW debugname).
 *   - Cross-form anim dedup (form 1 and form 2 share anim frames 22001
 *     and 22004; the writer's NameResolver dedupes them — they're only
 *     written ONCE).
 *   - Linked variant resolution (a player who picks 'legacy377' for
 *     form 1 gets 'legacy377' for form 2 too — both forms move together
 *     as a unit, can't pick "OSRS form 1 + legacy form 2").
 *
 * ----------------------------------------------------------------------------
 * Don't pollute the real content folder
 * ----------------------------------------------------------------------------
 *
 * The pilot writes to a TEMP content directory at
 * `<os.tmpdir()>/osrs-kq-pilot-content/` (NOT the real `lostcity/content/`).
 * The temp content dir is cleaned up on exit unless `--keep-content` is
 * passed.
 *
 * ----------------------------------------------------------------------------
 * Usage
 * ----------------------------------------------------------------------------
 *
 *   bun tools/osrs/PilotKalphiteQueen.ts [--keep-fixture] [--keep-content]
 *
 * Flags:
 *   --keep-fixture   Don't delete the fixture's temp dir on exit.
 *   --keep-content   Don't delete the temp content dir on exit.
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
import { PlayerVariantState } from '#/engine/variant/PlayerVariantState.js';
import { nodeKey } from './DepsSchema.js';

import {
    cleanupFixture,
    generateKalphiteQueenFixture,
    KalphiteQueenStubReader,
    KalphiteQueenFixture,
    KQ_FORM1_NPC_ID,
    KQ_FORM2_NPC_ID
} from './fixtures/KalphiteQueenFixture.js';

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
        'PilotKalphiteQueen.ts — end-to-end pilot for the Kalphite Queen NPC (2 forms)',
        '',
        'Usage:',
        '  bun tools/osrs/PilotKalphiteQueen.ts [--keep-fixture] [--keep-content]',
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
    printInfo('=== Stage 1: Generate Kalphite Queen fixture ===');
    const fixture: KalphiteQueenFixture = generateKalphiteQueenFixture();
    printInfo(`  Form 1 NPC ID: ${fixture.form1Id}`);
    printInfo(`  Form 2 NPC ID: ${fixture.form2Id} (referenced by form 1's multinpc[1])`);
    printInfo(`  Script dir: ${fixture.scriptDir}`);
    printInfo(`  Expected dep nodes: ${fixture.expectedDeps}`);

    // Create the temp content dir (where the writer will write files).
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osrs-kq-pilot-content-'));
    printInfo(`  Temp content dir: ${contentDir}`);

    // ---- Stage 2: Construct stub reader + tracer, run trace ----
    printInfo('=== Stage 2: Trace Kalphite Queen dependencies (both forms via multinpc walk) ===');
    const reader = new KalphiteQueenStubReader();
    const tracer = new DependencyTracer(reader, { scriptDir: fixture.scriptDir });
    // Trace form 1 — the tracer follows multinpc[1] to form 2 automatically.
    // No need for traceMany here; the dep map will contain both forms.
    const depsMap = tracer.trace(fixture.form1Id);

    const nodeKeys = Object.keys(depsMap.nodes);
    printInfo(`  Traced ${nodeKeys.length} nodes, ${depsMap.cycles.length} cycles, ${depsMap.missing.length} missing refs`);

    // ---- Stage 3: Write the deps.json to the temp content dir ----
    printInfo('=== Stage 3: Write deps.json ===');
    const depsDir = path.join(contentDir, 'deps');
    fs.mkdirSync(depsDir, { recursive: true });
    const depsFilePath = path.join(depsDir, 'osrs_kalphite_queen.deps.json');
    fs.writeFileSync(depsFilePath, JSON.stringify(depsMap, null, 2), 'utf8');
    printInfo(`  Wrote ${depsFilePath}`);

    // ---- Assertions on the deps map ----
    printInfo('=== Assert: deps map contents ===');

    assert(
        nodeKeys.length === fixture.expectedDeps,
        `Deps map has ${fixture.expectedDeps} nodes (got ${nodeKeys.length}: ${nodeKeys.join(', ')})`
    );

    // Each expected node key must be present.
    const expectedKeys = [
        nodeKey('npc', KQ_FORM1_NPC_ID),
        nodeKey('npc', KQ_FORM2_NPC_ID),
        'model:51001',
        'model:51002',
        'anim-base:52001',
        'anim:22001',
        'anim:22003',
        'anim:22004',
        'anim:22006',
        'seq:9601',
        'seq:9602',
        'seq:9603',
        'seq:9604',
        'seq:9605',
        'seq:9606',
        'param:1234',
        'param:1235',
        'script:kalphite_queen'
    ];
    for (const key of expectedKeys) {
        assert(depsMap.nodes[key] !== undefined, `Deps map contains node '${key}'`);
    }

    // The kq_head obj ref should appear in missing[] (discovered by the
    // script scanner via the `inv_has(worn, kq_head)` call site).
    const kqHeadMissing = depsMap.missing.find(
        m => m.kind === 'obj' && m.id === 'kq_head'
    );
    assert(
        kqHeadMissing !== undefined,
        `Deps map missing[] contains 'obj:kq_head' (script → obj edge walked) — got ${depsMap.missing.length} missing refs: ${depsMap.missing.map(m => `${m.kind}:${m.id}`).join(', ')}`
    );

    // The script node should have the kq_head as a dep (with missing: true).
    const scriptNode = depsMap.nodes['script:kalphite_queen'];
    assert(
        scriptNode !== undefined && scriptNode.kind === 'script',
        'Script node \'script:kalphite_queen\' exists with kind=script'
    );
    if (scriptNode) {
        const scriptObjDeps = scriptNode.deps.filter(d => d.kind === 'obj');
        assert(
            scriptObjDeps.some(d => d.id === 'kq_head'),
            'Script node deps[] contains obj:kq_head (via inv_has call site)'
        );
    }

    // Form 1 NPC node should reference form 2 via multinpc[1].
    const form1Node = depsMap.nodes[nodeKey('npc', KQ_FORM1_NPC_ID)];
    assert(form1Node !== undefined, 'Form 1 NPC node exists');
    if (form1Node) {
        const multinpcRefs = form1Node.deps.filter(d => d.via && d.via.startsWith('multinpc['));
        assert(
            multinpcRefs.length === 1,
            `Form 1 NPC node has 1 multinpc dep ref — got ${multinpcRefs.length}: ${multinpcRefs.map(r => `${r.kind}:${r.id} via ${r.via}`).join(', ')}`
        );
        if (multinpcRefs.length === 1) {
            assert(
                multinpcRefs[0].id === KQ_FORM2_NPC_ID,
                `Form 1's multinpc[1] ref points at form 2's OSRS ID ${KQ_FORM2_NPC_ID} (got ${multinpcRefs[0].id})`
            );
        }

        const viaKinds = form1Node.deps.map(d => d.kind);
        assert(viaKinds.includes('model'), 'Form 1 NPC node has model dep');
        assert(viaKinds.includes('seq'), 'Form 1 NPC node has seq dep');
        assert(viaKinds.includes('param'), 'Form 1 NPC node has param dep');
        assert(viaKinds.includes('script'), 'Form 1 NPC node has script dep (combat script discovered)');
        assert(viaKinds.includes('npc'), 'Form 1 NPC node has npc dep (form 2 via multinpc)');
    }

    // Form 2 NPC node should exist and have its own deps (no multinpc back-ref).
    const form2Node = depsMap.nodes[nodeKey('npc', KQ_FORM2_NPC_ID)];
    assert(form2Node !== undefined, 'Form 2 NPC node exists');
    if (form2Node) {
        const viaKinds = form2Node.deps.map(d => d.kind);
        assert(viaKinds.includes('model'), 'Form 2 NPC node has model dep');
        assert(viaKinds.includes('seq'), 'Form 2 NPC node has seq dep');
        assert(viaKinds.includes('script'), 'Form 2 NPC node has script dep (combat script discovered)');
        // Form 2 should NOT have any multinpc refs back to form 1.
        const form2MultinpcRefs = form2Node.deps.filter(d => d.via && d.via.startsWith('multinpc['));
        assert(
            form2MultinpcRefs.length === 0,
            `Form 2 NPC node has NO multinpc refs (it's a leaf in the form-swap graph) — got ${form2MultinpcRefs.length}`
        );
    }

    // ---- Stage 4: Run the ContentFolderWriter (importMany for both forms) ----
    printInfo('=== Stage 4: Import via ContentFolderWriter.importMany ===');
    const writer = new ContentFolderWriter(contentDir, reader, {
        dryRun: false,
        namePrefix: 'osrs_',
        groupFile: 'osrs_imports',
        overwrite: false
    });

    let result: ImportResult;
    try {
        result = writer.importMany([fixture.form1Id, fixture.form2Id], depsMap);
    } catch (err) {
        printError(`ContentFolderWriter.importMany threw: ${(err as Error).message}`);
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

    // Written assets:
    //   2 models (form1 body + form2 body)
    //   4 anims (22001 shared idle, 22003 form1 attack, 22004 shared death,
    //            22006 form2 attack — deduped from 6 seq refs by NameResolver)
    //   1 anim-base (shared skeleton)
    //   6 seqs (9601..9606)
    //   2 NPCs (form1 + form2 — topo-sorted so form 2 is processed BEFORE form 1
    //           so form 1's multinpc rewrite can look up form 2's debugname)
    //   = 2 + 4 + 1 + 6 + 2 = 15
    assert(
        written.length === 15,
        `Writer wrote 15 assets (2 models + 4 anims + 1 anim-base + 6 seqs + 2 npcs) — got ${written.length}`
    );

    // 3 skipped: 1 script + 2 params (kinds not yet supported by ContentFolderWriter).
    assert(
        skipped.length === 3,
        `Writer skipped 3 assets (script + 2 params — kinds not yet supported) — got ${skipped.length}: ${skipped.map(s => `${s.kind}:${s.osrsId}`).join(', ')}`
    );

    // 0 failed.
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
    //   model:    2 (form1 body + form2 body)
    //   anim:     4 (22001, 22003, 22004, 22006 — deduped from 6 seq refs)
    //   animset:  4 (same as anim — both packs share the same ID↔name mapping)
    //   base:     1 (shared skeleton)
    //   seq:      6 (kq1_idle, kq1_attack, kq1_death, kq2_idle, kq2_attack, kq2_death)
    //   npc:      2 (form1 + form2)
    const packAddedCounts: Record<string, number> = { model: 2, anim: 4, animset: 4, base: 1, seq: 6, npc: 2 };
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
        modelFiles.some(f => f.endsWith('.ob2') && f.includes('osrs_model_51001')),
        `Form 1 body model .ob2 file exists (got: ${modelFiles.join(', ')})`
    );
    assert(
        modelFiles.some(f => f.endsWith('.ob2') && f.includes('osrs_model_51002')),
        'Form 2 body model .ob2 file exists'
    );
    // Anims — 4 unique .anim files (shared frames deduped by NameResolver).
    assert(
        modelFiles.some(f => f.endsWith('.anim') && f.includes('osrs_anim_22001')),
        'Shared idle anim .anim file exists (22001 — used by both form1 and form2 seqs)'
    );
    assert(
        modelFiles.some(f => f.endsWith('.anim') && f.includes('osrs_anim_22003')),
        'Form 1 attack anim .anim file exists (22003)'
    );
    assert(
        modelFiles.some(f => f.endsWith('.anim') && f.includes('osrs_anim_22004')),
        'Shared death anim .anim file exists (22004 — used by both form1 and form2 seqs)'
    );
    assert(
        modelFiles.some(f => f.endsWith('.anim') && f.includes('osrs_anim_22006')),
        'Form 2 attack anim .anim file exists (22006)'
    );
    assert(
        modelFiles.some(f => f.endsWith('.base') && f.includes('osrs_base_52001')),
        'Shared AnimBase .base file exists (52001)'
    );

    // Critical: confirm cross-form anim dedup — the writer should have
    // written 4 .anim files, NOT 6 (frames 22001 and 22004 are referenced
    // by 2 seqs each but written ONCE thanks to NameResolver).
    const animFiles = modelFiles.filter(f => f.endsWith('.anim'));
    assert(
        animFiles.length === 4,
        `Exactly 4 .anim files written (cross-form anim dedup via NameResolver) — got ${animFiles.length}: ${animFiles.join(', ')}`
    );

    const npcConfigPath = path.join(contentDir, 'scripts', 'npc', 'configs', 'osrs_imports.npc');
    assert(fs.existsSync(npcConfigPath), `NPC config file exists at ${npcConfigPath}`);

    const seqConfigPath = path.join(contentDir, 'scripts', 'seq', 'configs', 'osrs_imports.seq');
    assert(fs.existsSync(seqConfigPath), `Seq config file exists at ${seqConfigPath}`);

    // ---- Verify NPC config content (CRITICAL: multinpc rewrite) ----
    printInfo('=== Assert: NPC config content (form-swap reference rewrite) ===');
    if (fs.existsSync(npcConfigPath)) {
        const npcContent = fs.readFileSync(npcConfigPath, 'utf8');

        // Both forms should have their own [debugname] block.
        assert(
            npcContent.includes('[osrs_kalphite_queen]'),
            'NPC config has [osrs_kalphite_queen] header (form 1)'
        );
        assert(
            npcContent.includes('[osrs_kalphite_queen_2]'),
            'NPC config has [osrs_kalphite_queen_2] header (form 2)'
        );

        // Form 1's model1 should be rewritten to the model debugname.
        assert(
            npcContent.includes('model1=osrs_model_51001'),
            'Form 1 NPC config rewrites model1=osrs_model_51001 (via NameResolver)'
        );
        // Form 1's readyanim should be rewritten to the seq debugname.
        assert(
            npcContent.includes('readyanim=osrs_kq1_idle'),
            'Form 1 NPC config rewrites readyanim=osrs_kq1_idle (via NameResolver)'
        );

        // Form 2's model1 + readyanim.
        assert(
            npcContent.includes('model1=osrs_model_51002'),
            'Form 2 NPC config rewrites model1=osrs_model_51002 (via NameResolver)'
        );
        assert(
            npcContent.includes('readyanim=osrs_kq2_idle'),
            'Form 2 NPC config rewrites readyanim=osrs_kq2_idle (via NameResolver)'
        );

        // The CRITICAL assertion: form 1's `multinpc=` line must reference
        // form 2's NEW debugname (`osrs_kalphite_queen_2`), NOT the raw
        // OSRS ID (`1159`). This proves the writer's `topoSortNpcByMultinpc`
        // processed form 2 BEFORE form 1, so form 2's debugname was in the
        // NameResolver when form 1's `multinpc=1,1159` line was rewritten.
        assert(
            npcContent.includes('multinpc=1,osrs_kalphite_queen_2'),
            'CRITICAL: Form 1 NPC config has multinpc=1,osrs_kalphite_queen_2 (cross-form ref rewritten to NEW debugname, NOT raw OSRS ID 1159)'
        );
        assert(
            !npcContent.includes('multinpc=1,1159'),
            'Form 1 NPC config does NOT contain raw OSRS ID in multinpc= line (rewrite succeeded)'
        );

        // Form 1 should have a multivar= line (emitted because opcode 106 set multivarbit).
        assert(
            npcContent.includes('multivar=varbit:'),
            'Form 1 NPC config has multivar=varbit:<id> line (form-swap trigger)'
        );
    }

    // ---- Verify seq config content ----
    printInfo('=== Assert: seq config content ===');
    if (fs.existsSync(seqConfigPath)) {
        const seqContent = fs.readFileSync(seqConfigPath, 'utf8');
        // All 6 seqs should have their own [debugname] block.
        for (const seqName of ['osrs_kq1_idle', 'osrs_kq1_attack', 'osrs_kq1_death',
            'osrs_kq2_idle', 'osrs_kq2_attack', 'osrs_kq2_death']) {
            assert(
                seqContent.includes(`[${seqName}]`),
                `Seq config has [${seqName}] header`
            );
        }
        // Form 1 idle seq's frame should be rewritten to the shared idle anim debugname.
        assert(
            seqContent.includes('frame1=osrs_anim_22001'),
            'Seq config rewrites frame1=osrs_anim_22001 (shared idle frame)'
        );
        // Form 1 death seq's frame should be rewritten to the shared death anim debugname.
        assert(
            seqContent.includes('frame1=osrs_anim_22004'),
            'Seq config rewrites frame1=osrs_anim_22004 (shared death frame)'
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
            if (packName === 'model') {
                assert(content.includes('osrs_model_51001'), 'model.pack contains osrs_model_51001');
                assert(content.includes('osrs_model_51002'), 'model.pack contains osrs_model_51002');
            } else if (packName === 'anim' || packName === 'animset') {
                assert(content.includes('osrs_anim_22001'), `${packName}.pack contains osrs_anim_22001 (shared idle)`);
                assert(content.includes('osrs_anim_22003'), `${packName}.pack contains osrs_anim_22003`);
                assert(content.includes('osrs_anim_22004'), `${packName}.pack contains osrs_anim_22004 (shared death)`);
                assert(content.includes('osrs_anim_22006'), `${packName}.pack contains osrs_anim_22006`);
            } else if (packName === 'base') {
                assert(content.includes('osrs_base_52001'), 'base.pack contains osrs_base_52001');
            } else if (packName === 'seq') {
                for (const seqName of ['osrs_kq1_idle', 'osrs_kq1_attack', 'osrs_kq1_death',
                    'osrs_kq2_idle', 'osrs_kq2_attack', 'osrs_kq2_death']) {
                    assert(content.includes(seqName), `seq.pack contains ${seqName}`);
                }
            } else if (packName === 'npc') {
                assert(content.includes('osrs_kalphite_queen'), 'npc.pack contains osrs_kalphite_queen');
                assert(content.includes('osrs_kalphite_queen_2'), 'npc.pack contains osrs_kalphite_queen_2');
            }
        }
    }

    // ---- Verify depMapUpdated has transformedFrom populated ----
    printInfo('=== Assert: depMapUpdated transformedFrom ===');
    const updatedNodes = result.depMapUpdated.nodes;
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

    // ---- Stage 5: Register variants for BOTH forms ----
    printInfo('=== Stage 5: Register variants (form 1 + form 2) ===');

    const variantsPath = path.join(contentDir, 'deps', 'variants.json');

    // Update both NPC nodes' names to their SANITIZED debugnames (matching the TD pilot's pattern).
    const writtenNpcEntries = result.written.filter(w => w.kind === 'npc');
    const updatedForm1Node = updatedNodes[nodeKey('npc', KQ_FORM1_NPC_ID)];
    const updatedForm2Node = updatedNodes[nodeKey('npc', KQ_FORM2_NPC_ID)];
    const form1Written = writtenNpcEntries.find(w => w.osrsId === KQ_FORM1_NPC_ID);
    const form2Written = writtenNpcEntries.find(w => w.osrsId === KQ_FORM2_NPC_ID);
    if (form1Written && updatedForm1Node) {
        updatedForm1Node.name = form1Written.debugname;
    }
    if (form2Written && updatedForm2Node) {
        updatedForm2Node.name = form2Written.debugname;
    }

    // Persist the updated deps.json (with transformedFrom + sanitized names)
    // so the UpdateVariantsIndex script can read it.
    fs.writeFileSync(depsFilePath, JSON.stringify(result.depMapUpdated, null, 2), 'utf8');
    printInfo(`  Re-wrote updated deps.json with transformedFrom fields: ${depsFilePath}`);

    // Reset the registry singleton + load with our temp variants path.
    VariantRegistry.resetForTest();
    const registry = VariantRegistry.getInstance();
    VariantRegistry.load(variantsPath);

    // Find the new NPC IDs assigned by the writer.
    assert(
        updatedForm1Node !== undefined && typeof updatedForm1Node.transformedFrom === 'number',
        'Form 1 updated NPC node has numeric transformedFrom (the new 377 NPC ID)'
    );
    assert(
        updatedForm2Node !== undefined && typeof updatedForm2Node.transformedFrom === 'number',
        'Form 2 updated NPC node has numeric transformedFrom (the new 377 NPC ID)'
    );

    const form1NewId = updatedForm1Node?.transformedFrom as number;
    const form2NewId = updatedForm2Node?.transformedFrom as number;
    printInfo(`  Form 1 new NPC ID: ${form1NewId} (debugname: ${form1Written?.debugname})`);
    printInfo(`  Form 2 new NPC ID: ${form2NewId} (debugname: ${form2Written?.debugname})`);

    const relDepsPath = path.relative(process.cwd(), depsFilePath).replace(/\\/g, '/');

    // Register form 1 (uses depsMap.root.id = form1OsrsId by default).
    registry.registerVariant(
        -1,                       // legacyNpcId (no legacy twin in fixture)
        form1NewId,               // osrsImportedNpcId (new 377 NPC ID for form 1)
        result.depMapUpdated,     // updated deps map (for osrsDebugname lookup)
        relDepsPath               // path to the persisted deps.json
    );

    // Register form 2 — uses the new `osrsSourceNpcId` param (Task 11
    // extension) to look up the form 2 NPC node by its OSRS source ID,
    // instead of the deps map's root.id (which is form 1's OSRS ID).
    registry.registerVariant(
        -1,                       // legacyNpcId
        form2NewId,               // osrsImportedNpcId (new 377 NPC ID for form 2)
        result.depMapUpdated,     // updated deps map
        relDepsPath,              // path to the persisted deps.json
        KQ_FORM2_NPC_ID           // osrsSourceNpcId — Task 11 extension
    );

    // Verify variants.json was written to disk with 2 entries.
    assert(fs.existsSync(variantsPath), `variants.json written to ${variantsPath}`);

    if (fs.existsSync(variantsPath)) {
        const variantsContent = fs.readFileSync(variantsPath, 'utf8');
        const variantsJson = JSON.parse(variantsContent);
        assert(
            Array.isArray(variantsJson.variants) && variantsJson.variants.length === 2,
            `variants.json has exactly 2 variant entries (one per form) — got ${variantsJson.variants?.length ?? 0}`
        );
        if (Array.isArray(variantsJson.variants)) {
            const form1Entry = variantsJson.variants.find((v: { osrsNpcId: number }) => v.osrsNpcId === form1NewId);
            const form2Entry = variantsJson.variants.find((v: { osrsNpcId: number }) => v.osrsNpcId === form2NewId);
            assert(form1Entry !== undefined, `variants.json contains form 1 entry (osrsNpcId=${form1NewId})`);
            assert(form2Entry !== undefined, `variants.json contains form 2 entry (osrsNpcId=${form2NewId})`);
            if (form1Entry) {
                assert(form1Entry.legacyNpcId === -1, 'Form 1 variant has legacyNpcId=-1 (no legacy twin)');
                assert(
                    form1Entry.osrsDebugname === 'osrs_kalphite_queen',
                    `Form 1 variant has osrsDebugname='osrs_kalphite_queen' (got '${form1Entry.osrsDebugname}')`
                );
            }
            if (form2Entry) {
                assert(form2Entry.legacyNpcId === -1, 'Form 2 variant has legacyNpcId=-1 (no legacy twin)');
                assert(
                    form2Entry.osrsDebugname === 'osrs_kalphite_queen_2',
                    `Form 2 variant has osrsDebugname='osrs_kalphite_queen_2' (got '${form2Entry.osrsDebugname}')`
                );
            }
        }
    }

    // ---- Stage 6: Link the two forms (form-swap linkage) ----
    printInfo('=== Stage 6: Link form 1 + form 2 (form-swap linkage) ===');
    registry.linkVariants(form1NewId, form2NewId);

    // Verify the linkage was persisted to variants.json.
    if (fs.existsSync(variantsPath)) {
        const variantsContent = fs.readFileSync(variantsPath, 'utf8');
        const variantsJson = JSON.parse(variantsContent);
        assert(
            Array.isArray(variantsJson.linkages) && variantsJson.linkages.length === 1,
            `variants.json has 1 linkage entry — got ${variantsJson.linkages?.length ?? 0}`
        );
        if (Array.isArray(variantsJson.linkages) && variantsJson.linkages.length === 1) {
            const linkage = variantsJson.linkages[0];
            assert(
                Array.isArray(linkage) && linkage.length === 2 &&
                ((linkage[0] === form1NewId && linkage[1] === form2NewId) ||
                    (linkage[0] === form2NewId && linkage[1] === form1NewId)),
                `Linkage entry is [${form1NewId}, ${form2NewId}] (in any order) — got [${linkage[0]}, ${linkage[1]}]`
            );
        }
    }

    // Verify getLinkedGroup returns both forms for either ID.
    const form1Group = registry.getLinkedGroup(form1NewId);
    const form2Group = registry.getLinkedGroup(form2NewId);
    assert(
        form1Group.length === 2 && form1Group.includes(form1NewId) && form1Group.includes(form2NewId),
        `getLinkedGroup(form1NewId=${form1NewId}) returns both forms — got [${form1Group.join(', ')}]`
    );
    assert(
        form2Group.length === 2 && form2Group.includes(form1NewId) && form2Group.includes(form2NewId),
        `getLinkedGroup(form2NewId=${form2NewId}) returns both forms — got [${form2Group.join(', ')}]`
    );

    // ---- Stage 7: Variant resolution assertions (the critical linkage test) ----
    printInfo('=== Stage 7: Variant resolution assertions (form-swap linkage) ===');

    const playerId = 42;

    // Test 1: player with eraPreset='allOSRS'. Both forms should resolve to 'osrs'.
    // The eraPreset path doesn't even need the linkage — both forms have
    // 'osrs' as an available variant, so 'allOSRS' picks 'osrs' for each.
    // But this still validates the basic per-form resolution works.
    const allOsrsState = new PlayerVariantState(playerId);
    allOsrsState.setEra('allOSRS');
    registry.setPlayerState(playerId, allOsrsState);

    const form1OsrsVariant = registry.resolveNpcVariant(form1NewId, playerId);
    assert(
        form1OsrsVariant === 'osrs',
        `resolveNpcVariant(form1NewId, player=allOSRS) → 'osrs' (got '${form1OsrsVariant}')`
    );
    const form2OsrsVariant = registry.resolveNpcVariant(form2NewId, playerId);
    assert(
        form2OsrsVariant === 'osrs',
        `resolveNpcVariant(form2NewId, player=allOSRS) → 'osrs' — both forms move together (got '${form2OsrsVariant}')`
    );

    // Test 2: player sets per-NPC override on form 1 to 'legacy377'.
    // Form 1 should resolve to 'legacy377' (direct override).
    // Form 2 should ALSO resolve to 'legacy377' (via linkage — this is the
    // KEY assertion that proves `linkVariants` works).
    allOsrsState.setNpcOverride(form1NewId, 'legacy377');

    const form1OverrideVariant = registry.resolveNpcVariant(form1NewId, playerId);
    assert(
        form1OverrideVariant === 'legacy377',
        `resolveNpcVariant(form1NewId, player=override-form1-legacy377) → 'legacy377' (direct override, got '${form1OverrideVariant}')`
    );
    const form2LinkedVariant = registry.resolveNpcVariant(form2NewId, playerId);
    assert(
        form2LinkedVariant === 'legacy377',
        `CRITICAL: resolveNpcVariant(form2NewId, player=override-form1-legacy377) → 'legacy377' via linkage (form 2 inherits form 1's override — got '${form2LinkedVariant}')`
    );

    // Test 3: clear form 1's override, set override on form 2 instead.
    // Same assertion in the other direction — form 1 should inherit form 2's override.
    allOsrsState.clearNpcOverride(form1NewId);
    allOsrsState.setNpcOverride(form2NewId, 'legacy377');

    const form2OverrideVariant = registry.resolveNpcVariant(form2NewId, playerId);
    assert(
        form2OverrideVariant === 'legacy377',
        `resolveNpcVariant(form2NewId, player=override-form2-legacy377) → 'legacy377' (direct override, got '${form2OverrideVariant}')`
    );
    const form1LinkedVariant = registry.resolveNpcVariant(form1NewId, playerId);
    assert(
        form1LinkedVariant === 'legacy377',
        `CRITICAL: resolveNpcVariant(form1NewId, player=override-form2-legacy377) → 'legacy377' via linkage (form 1 inherits form 2's override — got '${form1LinkedVariant}')`
    );

    // ---- Stage 8: Regenerate the variants.json index from deps files ----
    printInfo('=== Stage 8: Regenerate variants.json index (preserve linkages) ===');

    // Clear the override before regenerating (so the persisted player state
    // doesn't affect the index — there's no persisted player state anyway,
    // but defensive).
    allOsrsState.clearNpcOverride(form2NewId);

    const variantCount = regenerateIndex(contentDir);
    assert(
        variantCount === 2,
        `regenerateIndex() returned 2 variants (one per form) — got ${variantCount}`
    );

    // Verify the regenerated variants.json still has 2 entries + 1 linkage.
    if (fs.existsSync(variantsPath)) {
        const regenContent = fs.readFileSync(variantsPath, 'utf8');
        const regenJson = JSON.parse(regenContent);
        assert(
            Array.isArray(regenJson.variants) && regenJson.variants.length === 2,
            `Regenerated variants.json has 2 variant entries (one per form) — got ${regenJson.variants?.length ?? 0}`
        );
        assert(
            Array.isArray(regenJson.linkages) && regenJson.linkages.length === 1,
            `Regenerated variants.json PRESERVED the linkage entry (Task 11 extension) — got ${regenJson.linkages?.length ?? 0}`
        );
        if (Array.isArray(regenJson.variants)) {
            const form1Entry = regenJson.variants.find((v: { osrsNpcId: number }) => v.osrsNpcId === form1NewId);
            const form2Entry = regenJson.variants.find((v: { osrsNpcId: number }) => v.osrsNpcId === form2NewId);
            assert(form1Entry !== undefined, `Regenerated variants.json contains form 1 entry (osrsNpcId=${form1NewId})`);
            assert(form2Entry !== undefined, `Regenerated variants.json contains form 2 entry (osrsNpcId=${form2NewId})`);
        }
    }

    // Reload the registry from the regenerated variants.json and verify
    // the linkage is still active.
    VariantRegistry.load(variantsPath);
    const reloadedForm1Group = registry.getLinkedGroup(form1NewId);
    assert(
        reloadedForm1Group.length === 2 && reloadedForm1Group.includes(form2NewId),
        `After reload from disk, getLinkedGroup(form1NewId=${form1NewId}) still includes form2NewId=${form2NewId} — got [${reloadedForm1Group.join(', ')}]`
    );

    // ---- Stage 9: Final summary ----
    printInfo('=== Stage 9: Final summary ===');
    printInfo(`  Total assertions: ${passes} passed, ${failures} failed`);
    printInfo(`  Fixture dir: ${fixture.cacheDir}`);
    printInfo(`  Content dir: ${contentDir}`);
    printInfo(`  Deps file: ${depsFilePath}`);
    printInfo(`  Variants index: ${variantsPath}`);

    if (failures === 0) {
        const summary =
            'PILOT PASS — Kalphite Queen (2 forms) imported: ' +
            `${nodeKeys.length} nodes traced, ` +
            `${written.length} files written, ` +
            `${result.packUpdates.reduce((sum, p) => sum + p.added.length, 0)} pack entries added, ` +
            '2 variants registered, form-swap linkage preserved.';
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
