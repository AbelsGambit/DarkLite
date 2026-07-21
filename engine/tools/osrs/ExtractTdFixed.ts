/**
 * Extract Tormented Demon models from the flat cache.
 * Now that the split bug is fixed, NPC 13599-13606 should decode correctly.
 */
import fs from 'fs';
import path from 'path';
import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import Packet from '#/io/Packet.js';

const reader = new FlatFileCacheReader('data/osrs-cache-flat');
const result = reader.readArchive(2, 9);
if (!result) {
    console.error('Failed to split npc.dat');
    process.exit(1);
}

const tdIds = [13599, 13600, 13601, 13602, 13603, 13604, 13605, 13606];
const allModelIds = new Set<number>();

console.log('=== Tormented Demon NPC Configs (FIXED!) ===\n');
for (const tdId of tdIds) {
    const buf = result.children.get(tdId);
    if (!buf) {
        console.log(`NPC ${tdId}: NOT FOUND`);
        continue;
    }

    const npc = new OsrsNpcType(tdId);
    try {
        npc.decodeType(new Packet(buf));
        const models = npc.models ? Array.from(npc.models) : [];
        console.log(`NPC ${tdId}: name="${npc.name}", models=[${models.join(', ')}], size=${npc.size}, vislevel=${npc.vislevel}, stats=[${npc.stats.join(',')}]`);
        console.log(`  actions: [${npc.op ? npc.op.filter(a => a !== null).map(a => `"${a}"`).join(', ') : 'none'}]`);
        console.log(`  readyanim=${npc.readyanim}, walkanim=${npc.walkanim}`);
        for (const m of models) allModelIds.add(m);
    } catch (err) {
        console.log(`NPC ${tdId}: DECODE ERROR: ${(err as Error).message}`);
    }
}

console.log(`\n=== All TD Model IDs: [${Array.from(allModelIds).join(', ')}] ===`);

// Extract models
const outputDir = '/tmp/osrs-td-models-fixed';
fs.mkdirSync(outputDir, { recursive: true });

console.log(`\n=== Extracting TD Models ===`);
for (const modelId of allModelIds) {
    console.log(`\nModel ${modelId}:`);
    for (let idx = 0; idx <= 21; idx++) {
        if (!reader.has(idx, modelId)) continue;
        const data = reader.read(idx, modelId);
        if (!data) continue;

        console.log(`  Found in idx${idx}: ${data.length} bytes`);
        console.log(`  First 16: ${Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        console.log(`  Last 24: ${Array.from(data.slice(-24)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

        // Write as .ob2
        const outPath = path.join(outputDir, `td_model_${modelId}_idx${idx}.ob2`);
        fs.writeFileSync(outPath, data);
        console.log(`  Wrote .ob2 to ${outPath}`);
        break;
    }
}

console.log(`\n=== Done. TD models extracted to ${outputDir} ===`);
reader.close();
