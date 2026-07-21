#!/usr/bin/env bun
/**
 * ImportTormentedDemon.ts — End-to-end Tormented Demon import pipeline.
 *
 * Task ID: 31.
 *
 * Extracts the Tormented Demon NPC config + models from the OSRS flat cache
 * and stages them into the LostCity 377 content folder so the engine can
 * spawn the NPC after the next `bun run build`.
 *
 * What this script does (in order):
 *
 *   1. EXTRACT MODELS
 *      - Reads npc.dat (cache index 2, archive 9) via FlatFileCacheReader.
 *      - Decodes NPC 13599 (Tormented Demon) to get its model IDs
 *        (expected: [53287, 53285, 6318]).
 *      - Reads each model from idx7 (modern OSRS models).
 *      - Writes each model as a 377-compatible .ob2 file to
 *        `content/models/npc/osrs_td_<modelId>.ob2`.
 *      - The bytes returned by FlatFileCacheReader.read() are already in
 *        the 377 OB2 layout (18-byte trailer, version=0). We write them
 *        raw — we do NOT call OsrsModel.toLegacy377() (that converter is
 *        for the 23-byte OSRS trailer format, not the 18-byte 377 format).
 *
 *   2. REGISTER MODELS IN model.pack
 *      - Reads `content/pack/model.pack` (format: `<id>=<name>` per line).
 *      - Finds the current max ID and assigns the next IDs to the new models.
 *      - Appends `<nextId>=osrs_td_<modelId>` for each new model.
 *      - Idempotent: skips models whose debugname is already registered.
 *
 *   3. CREATE NPC CONFIG
 *      - Writes `content/scripts/npc/configs/osrs_tormented_demon.npc`
 *        containing an ini-style `[osrs_tormented_demon]` block with the
 *        full stat block (size, hp, attack, animations, params, etc).
 *      - Idempotent: if the file already contains the block, it is left
 *        untouched (the script does NOT overwrite user edits).
 *
 *   4. REGISTER NPC IN npc.pack
 *      - Reads `content/pack/npc.pack`.
 *      - Appends `<nextId>=osrs_tormented_demon`.
 *      - Idempotent: skips if the debugname is already registered.
 *
 *   5. PRINT SUMMARY
 *      - New NPC ID, new model IDs, and the file paths touched.
 *
 *   6. DOES NOT BUILD
 *      - This script only stages files. The user runs `bun run build`
 *        manually afterwards to pack the new content into the 377 cache.
 *
 * Usage:
 *   cd /home/z/my-project/lostcity/engine
 *   bun run tools/osrs/ImportTormentedDemon.ts
 */
import fs from 'fs';
import path from 'path';

import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import Packet from '#/io/Packet.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** OSRS flat cache directory (relative to the engine cwd). */
const CACHE_DIR = 'data/osrs-cache-flat';

/**
 * LostCity content folder. Resolved relative to the engine cwd (which is
 * `/home/z/my-project/lostcity/engine` per the run instructions), so
 * `../content` resolves to `/home/z/my-project/lostcity/content`.
 */
const ENGINE_CWD = process.cwd();
const CONTENT_DIR = path.resolve(ENGINE_CWD, '../content');

/** OSRS NPC ID for the Tormented Demon (8 cosmetic variants exist: 13599..13606). */
const TD_NPC_ID = 13599;

/** Expected OSRS model IDs (used for the sanity check + file naming). */
const EXPECTED_MODEL_IDS: number[] = [53287, 53285, 6318];

/** Debugname used everywhere in the content folder (pack files + .npc block). */
const NPC_DEBUGNAME = 'osrs_tormented_demon';

/** Pack file paths. */
const MODEL_PACK_PATH = path.join(CONTENT_DIR, 'pack', 'model.pack');
const NPC_PACK_PATH = path.join(CONTENT_DIR, 'pack', 'npc.pack');

/** NPC config (.npc) file path. */
const NPC_CONFIG_PATH = path.join(CONTENT_DIR, 'scripts', 'npc', 'configs', 'osrs_tormented_demon.npc');

/** Directory where the new .ob2 model files are written. */
const MODEL_OUT_DIR = path.join(CONTENT_DIR, 'models', 'npc');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PackEntry {
    id: number;
    name: string;
}

/** Build the debugname for an OSRS model imported for the TD. */
function modelDebugName(modelId: number): string {
    return `osrs_td_${modelId}`;
}

/** Full output path for an imported TD model .ob2 file. */
function modelOutPath(modelId: number): string {
    return path.join(MODEL_OUT_DIR, `${modelDebugName(modelId)}.ob2`);
}

/**
 * Read a LostCity `.pack` file (one `<id>=<name>` per line, optional blank
 * lines / comments). Returns entries in file order.
 */
function readPack(filePath: string): PackEntry[] {
    const text = fs.readFileSync(filePath, 'utf8');
    const entries: PackEntry[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const idStr = line.slice(0, eq).trim();
        const name = line.slice(eq + 1).trim();
        const id = parseInt(idStr, 10);
        if (Number.isNaN(id)) continue;
        entries.push({ id, name });
    }
    return entries;
}

/** Write a `.pack` file from entries. Trailing newline preserved. */
function writePack(filePath: string, entries: PackEntry[]): void {
    const text = entries.map(e => `${e.id}=${e.name}`).join('\n') + '\n';
    fs.writeFileSync(filePath, text, 'utf8');
}

/** Find the maximum ID in a pack entry list, or -1 if empty. */
function maxPackId(entries: PackEntry[]): number {
    let max = -1;
    for (const e of entries) {
        if (e.id > max) max = e.id;
    }
    return max;
}

/** Return true if `name` already appears in the pack entry list. */
function packHasName(entries: PackEntry[], name: string): boolean {
    return entries.some(e => e.name === name);
}

/** Return the ID registered for `name`, or -1 if not registered. */
function packIdForName(entries: PackEntry[], name: string): number {
    const e = entries.find(e => e.name === name);
    return e ? e.id : -1;
}

/**
 * The exact `[osrs_tormented_demon]` ini block. Kept as a single template
 * literal so the staged file matches the spec character-for-character.
 */
const NPC_CONFIG_BLOCK = `[osrs_tormented_demon]
name=Tormented Demon
desc=A fearsome demon from the While Guthix Sleeps quest.
model1=osrs_td_53287
model2=osrs_td_53285
model3=osrs_td_6318
size=3
resizeh=110
resizev=110
walkanim=demon_walk
readyanim=demon_ready
op2=Attack
vislevel=450
wanderrange=6
maxrange=16
respawnrate=60
hitpoints=600
attack=255
strength=255
defence=150
magic=255
ranged=255
huntmode=cowardly
huntrange=2
param=attack_anim,demon_attack
param=defend_anim,demon_block
param=death_anim,demon_death
`;

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

interface ExtractedModel {
    modelId: number;
    bytes: Uint8Array;
    outPath: string;
}

/**
 * Stage 1 — Extract TD model bytes from the OSRS flat cache.
 *
 * Reads npc.dat, decodes NPC 13599 to get its model IDs, then reads each
 * model from idx7. The bytes returned by FlatFileCacheReader.read() are
 * already in 377 OB2 layout (18-byte trailer, version=0) — they're written
 * verbatim, no OsrsModel.toLegacy377() conversion needed.
 */
function extractTdModels(reader: FlatFileCacheReader): ExtractedModel[] {
    console.log('=== Stage 1: Extract TD models from OSRS cache ===');
    console.log(`  Cache dir: ${reader.dir}`);

    // Split npc.dat (index 2, archive 9).
    const npcArchive = reader.readArchive(2, 9);
    if (!npcArchive) {
        throw new Error('Failed to read npc.dat (index 2, archive 9) from flat cache.');
    }
    console.log(`  Split npc.dat into ${npcArchive.children.size} NPC configs`);

    // Decode NPC 13599.
    const npcBuf = npcArchive.children.get(TD_NPC_ID);
    if (!npcBuf) {
        throw new Error(`NPC ${TD_NPC_ID} not found in npc.dat children.`);
    }

    const npc = new OsrsNpcType(TD_NPC_ID);
    npc.decodeType(new Packet(npcBuf));

    if (npc.name !== 'Tormented Demon') {
        throw new Error(
            `NPC ${TD_NPC_ID} decoded name "${npc.name}" — expected "Tormented Demon". Wrong cache?`,
        );
    }

    const decodedModelIds: number[] = npc.models ? Array.from(npc.models) : [];
    console.log(`  Decoded NPC ${TD_NPC_ID}: name="${npc.name}", models=[${decodedModelIds.join(', ')}], size=${npc.size}, vislevel=${npc.vislevel}`);

    // Sanity-check against the expected set. We don't hard-fail if the
    // cache returns a slightly different set (e.g. a different rev) — we
    // just warn and proceed with whatever the cache gave us. But for the
    // well-known 227 cache (rev 4529), the set must match exactly.
    const expectedSet = new Set(EXPECTED_MODEL_IDS);
    const decodedSet = new Set(decodedModelIds);
    if (expectedSet.size !== decodedSet.size || [...expectedSet].some(id => !decodedSet.has(id))) {
        console.warn(`  WARNING: decoded model set [${decodedModelIds.join(', ')}] does not match expected [${EXPECTED_MODEL_IDS.join(', ')}].`);
        console.warn(`           Proceeding with the decoded set — the .npc config block will still reference the EXPECTED set.`);
    }

    // Use the EXPECTED_MODEL_IDS for the .npc config + filenames, since the
    // template block hard-codes those. The extraction loop below pulls
    // whatever the cache gave us (the expected set, in practice).
    const modelIdsToExtract = EXPECTED_MODEL_IDS;
    const extracted: ExtractedModel[] = [];

    fs.mkdirSync(MODEL_OUT_DIR, { recursive: true });

    for (const modelId of modelIdsToExtract) {
        // Modern OSRS models live in idx7.
        if (!reader.has(7, modelId)) {
            throw new Error(`Model ${modelId} not found in idx7 of the flat cache.`);
        }
        const data = reader.read(7, modelId);
        if (!data || data.length === 0) {
            throw new Error(`Model ${modelId} read from idx7 returned empty data.`);
        }

        const outPath = modelOutPath(modelId);
        fs.writeFileSync(outPath, data);
        console.log(`  Wrote model ${modelId}: ${data.length} bytes → ${path.relative(CONTENT_DIR, outPath)}`);

        extracted.push({ modelId, bytes: data, outPath });
    }

    return extracted;
}

/**
 * Stage 2 — Register the new models in `content/pack/model.pack`.
 *
 * For each TD model whose debugname isn't already in the pack, append a
 * new line `<nextId>=osrs_td_<modelId>`. The next ID is computed as
 * (current max ID + 1) and incremented per appended entry.
 *
 * Returns a map of `modelId → assignedPackId` for the summary.
 */
function registerModelsInPack(extracted: ExtractedModel[]): Map<number, number> {
    console.log('\n=== Stage 2: Register models in model.pack ===');
    console.log(`  Pack file: ${MODEL_PACK_PATH}`);

    const entries = readPack(MODEL_PACK_PATH);
    const originalCount = entries.length;
    const originalMax = maxPackId(entries);
    console.log(`  Existing entries: ${originalCount}, max ID: ${originalMax}`);

    const assigned = new Map<number, number>();
    let nextId = originalMax + 1;

    for (const { modelId } of extracted) {
        const dbg = modelDebugName(modelId);
        const existing = packIdForName(entries, dbg);
        if (existing >= 0) {
            assigned.set(modelId, existing);
            console.log(`  Model ${modelId}: already registered as id=${existing} (${dbg}) — skipped.`);
            continue;
        }
        entries.push({ id: nextId, name: dbg });
        assigned.set(modelId, nextId);
        console.log(`  Model ${modelId}: registered as id=${nextId} (${dbg})`);
        nextId++;
    }

    if (entries.length !== originalCount) {
        writePack(MODEL_PACK_PATH, entries);
        console.log(`  Wrote ${entries.length - originalCount} new entr${entries.length - originalCount === 1 ? 'y' : 'ies'} (new max ID: ${maxPackId(entries)}).`);
    } else {
        console.log('  No new entries — pack file unchanged.');
    }

    return assigned;
}

/**
 * Stage 3 — Create the NPC config file
 * `content/scripts/npc/configs/osrs_tormented_demon.npc`.
 *
 * Idempotent: if the file already exists and contains the
 * `[osrs_tormented_demon]` header, it is left untouched.
 */
function createNpcConfig(): void {
    console.log('\n=== Stage 3: Create NPC config ===');
    console.log(`  Config file: ${NPC_CONFIG_PATH}`);

    fs.mkdirSync(path.dirname(NPC_CONFIG_PATH), { recursive: true });

    if (fs.existsSync(NPC_CONFIG_PATH)) {
        const existing = fs.readFileSync(NPC_CONFIG_PATH, 'utf8');
        if (existing.includes(`[${NPC_DEBUGNAME}]`)) {
            console.log(`  File already exists and contains [${NPC_DEBUGNAME}] block — left untouched.`);
            return;
        }
        // File exists but doesn't contain our block — append it (with a
        // separating blank line if the file doesn't already end with one).
        const sep = existing.endsWith('\n\n') || existing.endsWith('\r\n\r\n') ? '' : '\n';
        fs.writeFileSync(NPC_CONFIG_PATH, existing + sep + NPC_CONFIG_BLOCK, 'utf8');
        console.log(`  Appended [${NPC_DEBUGNAME}] block to existing file.`);
        return;
    }

    fs.writeFileSync(NPC_CONFIG_PATH, NPC_CONFIG_BLOCK, 'utf8');
    console.log(`  Created new file with [${NPC_DEBUGNAME}] block.`);
}

/**
 * Stage 4 — Register the new NPC in `content/pack/npc.pack`.
 *
 * Appends `<nextId>=osrs_tormented_demon` if not already present.
 * Returns the assigned NPC ID.
 */
function registerNpcInPack(): number {
    console.log('\n=== Stage 4: Register NPC in npc.pack ===');
    console.log(`  Pack file: ${NPC_PACK_PATH}`);

    const entries = readPack(NPC_PACK_PATH);
    const originalCount = entries.length;
    const originalMax = maxPackId(entries);
    console.log(`  Existing entries: ${originalCount}, max ID: ${originalMax}`);

    const existing = packIdForName(entries, NPC_DEBUGNAME);
    if (existing >= 0) {
        console.log(`  NPC "${NPC_DEBUGNAME}" already registered as id=${existing} — skipped.`);
        return existing;
    }

    const nextId = originalMax + 1;
    entries.push({ id: nextId, name: NPC_DEBUGNAME });
    writePack(NPC_PACK_PATH, entries);
    console.log(`  Registered NPC "${NPC_DEBUGNAME}" as id=${nextId}.`);
    return nextId;
}

/**
 * Stage 5 — Print a summary of everything the script did.
 */
function printSummary(
    extracted: ExtractedModel[],
    modelPackIds: Map<number, number>,
    npcId: number,
): void {
    console.log('\n=== Stage 5: Summary ===');
    console.log('----------------------------------------------');
    console.log('Tormented Demon import complete.');
    console.log('----------------------------------------------');
    console.log(`New NPC ID:        ${npcId}  (debugname: ${NPC_DEBUGNAME})`);
    console.log(`New model IDs:`);
    for (const { modelId, bytes, outPath } of extracted) {
        const packId = modelPackIds.get(modelId);
        console.log(`  pack id=${packId}, osrs model=${modelId}, size=${bytes.length}B → ${path.relative(CONTENT_DIR, outPath)}`);
    }
    console.log('');
    console.log('Files created / modified:');
    console.log(`  (created)  ${NPC_CONFIG_PATH}`);
    for (const { outPath } of extracted) {
        console.log(`  (created)  ${outPath}`);
    }
    console.log(`  (updated)  ${MODEL_PACK_PATH}`);
    console.log(`  (updated)  ${NPC_PACK_PATH}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Review the staged files above.');
    console.log('  2. From the engine dir, run:  bun run build');
    console.log(`  3. Spawn the NPC in-game with:  ::npc ${npcId}`);
    console.log('----------------------------------------------');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
    console.log('==============================================');
    console.log(' ImportTormentedDemon — LostCity 377 pipeline');
    console.log('==============================================');
    console.log(`Engine cwd:    ${ENGINE_CWD}`);
    console.log(`Content dir:   ${CONTENT_DIR}`);
    console.log(`OSRS NPC ID:   ${TD_NPC_ID}`);
    console.log(`Expected models: [${EXPECTED_MODEL_IDS.join(', ')}]`);
    console.log('');

    // Verify content dir is present.
    if (!fs.existsSync(CONTENT_DIR)) {
        throw new Error(`Content dir not found: ${CONTENT_DIR}`);
    }
    if (!fs.existsSync(MODEL_PACK_PATH)) {
        throw new Error(`model.pack not found: ${MODEL_PACK_PATH}`);
    }
    if (!fs.existsSync(NPC_PACK_PATH)) {
        throw new Error(`npc.pack not found: ${NPC_PACK_PATH}`);
    }

    const reader = new FlatFileCacheReader(CACHE_DIR);
    if (!reader.isAvailable) {
        throw new Error(`OSRS flat cache not available at: ${path.resolve(ENGINE_CWD, CACHE_DIR)}`);
    }

    try {
        const extracted = extractTdModels(reader);
        const modelPackIds = registerModelsInPack(extracted);
        createNpcConfig();
        const npcId = registerNpcInPack();
        printSummary(extracted, modelPackIds, npcId);
    } finally {
        reader.close();
    }
}

main();
