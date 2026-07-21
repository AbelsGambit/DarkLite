/**
 * Prove the end-to-end pipeline works on the real flat cache:
 * 1. Pick a demon NPC (e.g. NPC 1272 which contains "demon")
 * 2. Decode its config to get model IDs
 * 3. Read the model from idx7 (modern models)
 * 4. Decode it with OsrsModel
 * 5. Write the .ob2 file
 *
 * Also: search all indexes for a known model ID to determine which index
 * is the "models" index in modern OSRS.
 */
import fs from 'fs';
import path from 'path';
import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import OsrsModel from '#/cache/osrs/OsrsModel.js';
import Model from '#/cache/graphics/Model.js';
import Packet from '#/io/Packet.js';

const reader = new FlatFileCacheReader('data/osrs-cache-flat');
const npcResult = reader.readArchive(2, 9);
if (!npcResult) {
    console.error('Failed to split npc.dat');
    process.exit(1);
}

// Find demon NPCs and extract their model IDs
console.log('=== Scanning for demon NPCs with models ===');
const demonNpcs: { id: number; name: string; models: number[] }[] = [];

for (const [npcId, buf] of npcResult.children) {
    if (buf.length < 4) continue;
    // Quick check: does it contain "demon" or "Demon"?
    const str = Buffer.from(buf).toString('ascii');
    if (!str.includes('demon') && !str.includes('Demon')) continue;

    // Decode
    try {
        const npc = new OsrsNpcType(npcId);
        const p = new Packet(buf);
        npc.decodeType(p);
        if (npc.models && npc.models.length > 0) {
            demonNpcs.push({
                id: npcId,
                name: npc.name || '(unnamed)',
                models: Array.from(npc.models)
            });
        }
    } catch {}
}

console.log(`Found ${demonNpcs.length} demon NPCs with models`);
for (const d of demonNpcs.slice(0, 10)) {
    console.log(`  NPC ${d.id}: "${d.name}" models=[${d.models.join(', ')}]`);
}

// Pick the first demon NPC and extract its model
if (demonNpcs.length === 0) {
    console.log('No demon NPCs found, trying dragons...');
    for (const [npcId, buf] of npcResult.children) {
        if (buf.length < 4) continue;
        const str = Buffer.from(buf).toString('ascii');
        if (!str.includes('Dragon') && !str.includes('dragon')) continue;
        try {
            const npc = new OsrsNpcType(npcId);
            const p = new Packet(buf);
            npc.decodeType(p);
            if (npc.models && npc.models.length > 0) {
                demonNpcs.push({
                    id: npcId,
                    name: npc.name || '(unnamed)',
                    models: Array.from(npc.models)
                });
            }
        } catch {}
    }
    console.log(`Found ${demonNpcs.length} dragon NPCs with models`);
    for (const d of demonNpcs.slice(0, 10)) {
        console.log(`  NPC ${d.id}: "${d.name}" models=[${d.models.join(', ')}]`);
    }
}

if (demonNpcs.length === 0) {
    console.error('No NPCs with models found!');
    process.exit(1);
}

// Try to extract the first demon's model
const target = demonNpcs[0];
console.log(`\n=== Extracting model for NPC ${target.id} ("${target.name}") ===`);
console.log(`Model IDs: [${target.models.join(', ')}]`);

const outputDir = '/tmp/osrs-extracted-models';
fs.mkdirSync(outputDir, { recursive: true });

for (const modelId of target.models) {
    console.log(`\nModel ${modelId}:`);

    // Try each index
    for (let idx = 0; idx <= 21; idx++) {
        if (!reader.has(idx, modelId)) continue;
        const data = reader.read(idx, modelId);
        if (!data) continue;

        console.log(`  idx${idx}: ${data.length} bytes`);
        console.log(`  First 16: ${Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        console.log(`  Last 24: ${Array.from(data.slice(-24)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

        // Try OsrsModel
        try {
            const model = OsrsModel.decode(modelId, data);
            if (model) {
                console.log(`  OsrsModel.decode: SUCCESS vc=${model.vertexCount} fc=${model.faceCount} tfc=${model.texturedFaceCount}`);
                // Write the raw model data as .ob2
                const outPath = path.join(outputDir, `npc_${target.id}_model_${modelId}_idx${idx}.ob2`);
                fs.writeFileSync(outPath, data);
                console.log(`  Wrote .ob2 to ${outPath}`);
                break;
            } else {
                console.log(`  OsrsModel.decode: null`);
            }
        } catch (err) {
            console.log(`  OsrsModel.decode FAILED: ${(err as Error).message}`);
        }

        // Try 377 Model.unpack
        try {
            Model.meta = [];
            Model.unpack(modelId, data);
            const m = Model.meta[modelId];
            if (m && m.vertexCount > 0 && m.vertexCount < 100000) {
                console.log(`  377 Model.unpack: vc=${m.vertexCount} fc=${m.faceCount} tfc=${m.texturedFaceCount} ✓`);
                const outPath = path.join(outputDir, `npc_${target.id}_model_${modelId}_idx${idx}.ob2`);
                fs.writeFileSync(outPath, data);
                console.log(`  Wrote .ob2 to ${outPath}`);
                break;
            }
        } catch (err) {
            console.log(`  377 Model.unpack FAILED: ${(err as Error).message}`);
        }
    }
}

// Also try the TD model IDs from the old cache (53287, 53285, 6318) — maybe they exist here
console.log('\n=== Checking old-cache TD model IDs ===');
for (const modelId of [53287, 53285, 6318]) {
    for (let idx = 0; idx <= 21; idx++) {
        if (!reader.has(idx, modelId)) continue;
        const data = reader.read(idx, modelId);
        if (!data) continue;
        console.log(`Model ${modelId} in idx${idx}: ${data.length} bytes`);

        try {
            const model = OsrsModel.decode(modelId, data);
            if (model) {
                console.log(`  OsrsModel: vc=${model.vertexCount} fc=${model.faceCount}`);
                const outPath = path.join(outputDir, `td_old_model_${modelId}_idx${idx}.ob2`);
                fs.writeFileSync(outPath, data);
                console.log(`  Wrote to ${outPath}`);
                break;
            }
        } catch (err) {
            console.log(`  OsrsModel FAILED: ${(err as Error).message}`);
        }

        try {
            Model.meta = [];
            Model.unpack(modelId, data);
            const m = Model.meta[modelId];
            if (m && m.vertexCount > 0 && m.vertexCount < 100000) {
                console.log(`  377 Model: vc=${m.vertexCount} fc=${m.faceCount} ✓`);
                const outPath = path.join(outputDir, `td_old_model_${modelId}_idx${idx}.ob2`);
                fs.writeFileSync(outPath, data);
                console.log(`  Wrote to ${outPath}`);
                break;
            }
        } catch (err) {
            console.log(`  377 Model FAILED: ${(err as Error).message}`);
        }
    }
}

console.log(`\n=== Done. Extracted models in ${outputDir} ===`);
reader.close();
