/**
 * End-to-end test using FlatFileCacheReader on the user's complete 227 cache.
 *
 * 1. Read npc.dat (index 2, archive 9) → 14,142 NPC configs
 * 2. Find Tormented Demon (NPC IDs 13599-13606) → extract model IDs
 * 3. Read each model from the models index → decode with OsrsModel
 * 4. Write the TD model as a .ob2 file (377-compatible gzip)
 *
 * Run: `cd /home/z/my-project/lostcity/engine && bun run tools/osrs/TestFlatCache.ts`
 */
import fs from 'fs';
import path from 'path';
import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import OsrsModel from '#/cache/osrs/OsrsModel.js';
import Model from '#/cache/graphics/Model.js';
import Packet from '#/io/Packet.js';

const cacheDir = 'data/osrs-cache-flat';
const reader = new FlatFileCacheReader(cacheDir);

if (!reader.isAvailable) {
    console.error('Flat cache not available at', cacheDir);
    process.exit(1);
}

console.log('=== Flat-File OSRS Cache Reader Test ===\n');

// Index summary
console.log('Index summary:');
for (let i = 0; i <= 21; i++) {
    const count = reader.count(i);
    if (count > 0) console.log(`  idx${i}: ${count} files`);
}
console.log(`  idx255: ${reader.count(255)} ref tables`);

// Read config reference table
console.log('\n=== Reading config reference table (idx255 file 2) ===');
const configRef = reader.readIndex255(2);
console.log(`Config index has ${configRef.length} archives`);
const npcArchive = configRef.find(e => e.archive === 9);
console.log(`Archive 9 (npc.dat): ${npcArchive?.childCount} children`);

// Split npc.dat
console.log('\n=== Splitting npc.dat (index 2, archive 9) ===');
const npcResult = reader.readArchive(2, 9);
if (!npcResult) {
    console.error('Failed to split npc.dat');
    process.exit(1);
}
console.log(`Split into ${npcResult.children.size} NPC configs`);

// Extract TD configs
console.log('\n=== Tormented Demon NPC configs ===');
const tdIds = [13599, 13600, 13601, 13602, 13603, 13604, 13605, 13606];
const tdModelIds = new Set<number>();

for (const tdId of tdIds) {
    const buf = npcResult.children.get(tdId);
    if (!buf) {
        console.log(`NPC ${tdId}: NOT FOUND`);
        continue;
    }

    const npc = new OsrsNpcType(tdId);
    const p = new Packet(buf);
    try {
        npc.decodeType(p);
        const models = npc.models ? Array.from(npc.models) : [];
        console.log(`NPC ${tdId}: name="${npc.name}", models=[${models.join(', ')}], size=${npc.size}, stats=[${npc.stats.join(',')}]`);
        for (const m of models) tdModelIds.add(m);
    } catch (err) {
        console.log(`NPC ${tdId}: DECODE ERROR: ${(err as Error).message}`);
    }
}

console.log(`\nUnique TD model IDs: [${Array.from(tdModelIds).join(', ')}]`);

// Try to find and decode each model
console.log('\n=== Reading + decoding TD models ===');
const outputDir = '/tmp/osrs-td-models';
fs.mkdirSync(outputDir, { recursive: true });

for (const modelId of tdModelIds) {
    console.log(`\nModel ${modelId}:`);

    // Try each index that might contain models
    let found = false;
    for (const idx of [0, 1, 7]) {
        if (!reader.has(idx, modelId)) continue;
        const data = reader.read(idx, modelId);
        if (!data) continue;

        console.log(`  Found in idx${idx}: ${data.length} bytes (decompressed)`);
        console.log(`  First 16 bytes: ${Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        console.log(`  Last 24 bytes: ${Array.from(data.slice(-24)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

        // Try OsrsModel decoder
        try {
            const model = OsrsModel.decode(modelId, data);
            if (model) {
                console.log(`  OsrsModel.decode: SUCCESS vc=${model.vertexCount} fc=${model.faceCount} tfc=${model.texturedFaceCount}`);
                found = true;
            } else {
                console.log(`  OsrsModel.decode: returned null`);
            }
        } catch (err) {
            console.log(`  OsrsModel.decode FAILED: ${(err as Error).message}`);
        }

        // Try 377 Model.unpack
        try {
            Model.meta = [];
            Model.unpack(modelId, data);
            const m = Model.meta[modelId];
            if (m) {
                console.log(`  377 Model.unpack: vc=${m.vertexCount} fc=${m.faceCount} tfc=${m.texturedFaceCount}`);
            }
        } catch (err) {
            console.log(`  377 Model.unpack FAILED: ${(err as Error).message}`);
        }

        // Detect format
        try {
            const fmt = OsrsModel.detect(data);
            console.log(`  OsrsModel.detect: ${fmt}`);
        } catch (err) {
            console.log(`  OsrsModel.detect FAILED: ${(err as Error).message}`);
        }

        // Write raw model data to /tmp
        const outPath = path.join(outputDir, `model_${modelId}_from_idx${idx}.dat`);
        fs.writeFileSync(outPath, data);
        console.log(`  Wrote raw bytes to ${outPath}`);
        break;
    }

    if (!found) {
        console.log(`  NOT FOUND in any model index`);
    }
}

console.log(`\n=== Done. Model files written to ${outputDir} ===`);
reader.close();
