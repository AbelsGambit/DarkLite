/**
 * Generate dependency maps for ALL NPCs in the OSRS cache.
 *
 * For each NPC, records:
 *   - id, name, debugname
 *   - model IDs (from opcode 1)
 *   - chathead model IDs (from opcode 60)
 *   - animation IDs (stand, walk, run, crawl, rotations)
 *   - combat stats
 *   - category, size, vislevel
 *
 * Writes to: content/deps/all_npcs.deps.json
 *
 * Run: `cd /home/z/my-project/lostcity/engine && bun run tools/osrs/GenerateDepMaps.ts`
 */
import fs from 'fs';
import path from 'path';
import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import Packet from '#/io/Packet.js';

const reader = new FlatFileCacheReader('data/osrs-cache-flat');
if (!reader.isAvailable) {
    console.error('Flat cache not available');
    process.exit(1);
}

console.log('=== Generating NPC Dependency Maps ===\n');

// Split npc.dat
const result = reader.readArchive(2, 9);
if (!result) {
    console.error('Failed to split npc.dat');
    process.exit(1);
}
console.log(`Split npc.dat into ${result.children.size} NPC configs`);

// Decode every NPC and build the dependency map
const depMap: Record<number, any> = {};
let decoded = 0;
let failed = 0;
let withModels = 0;
let withAnims = 0;

for (const [npcId, buf] of result.children) {
    try {
        const npc = new OsrsNpcType(npcId);
        const p = new Packet(buf);
        npc.decodeType(p);

        const entry: any = {
            id: npcId,
            name: npc.name,
            size: npc.size,
            vislevel: npc.vislevel,
            category: npc.category,
            stats: npc.stats.slice(),
            models: npc.models ? Array.from(npc.models) : [],
            heads: npc.heads ? Array.from(npc.heads) : [],
        };

        // Collect all animation IDs
        const anims: number[] = [];
        if (npc.readyanim >= 0) anims.push(npc.readyanim);
        if (npc.walkanim >= 0) anims.push(npc.walkanim);
        if (npc.walkanim_b >= 0) anims.push(npc.walkanim_b);
        if (npc.walkanim_l >= 0) anims.push(npc.walkanim_l);
        if (npc.walkanim_r >= 0) anims.push(npc.walkanim_r);
        if (npc.runanim >= 0) anims.push(npc.runanim);
        if (npc.runanim_b >= 0) anims.push(npc.runanim_b);
        if (npc.runanim_l >= 0) anims.push(npc.runanim_l);
        if (npc.runanim_r >= 0) anims.push(npc.runanim_r);
        if (npc.crawlanim >= 0) anims.push(npc.crawlanim);
        if (npc.crawlanim_b >= 0) anims.push(npc.crawlanim_b);
        if (npc.crawlanim_l >= 0) anims.push(npc.crawlanim_l);
        if (npc.crawlanim_r >= 0) anims.push(npc.crawlanim_r);
        if (npc.idleRotateLeftAnim >= 0) anims.push(npc.idleRotateLeftAnim);
        if (npc.idleRotateRightAnim >= 0) anims.push(npc.idleRotateRightAnim);

        if (anims.length > 0) {
            entry.animations = [...new Set(anims)];
            withAnims++;
        }

        if (entry.models.length > 0) withModels++;
        if (npc.op) entry.actions = npc.op.filter(a => a !== null);

        depMap[npcId] = entry;
        decoded++;
    } catch (err) {
        failed++;
        depMap[npcId] = { id: npcId, error: (err as Error).message };
    }
}

console.log(`\nDecoded: ${decoded} / ${result.children.size}`);
console.log(`Failed: ${failed}`);
console.log(`NPCs with models: ${withModels}`);
console.log(`NPCs with animations: ${withAnims}`);

// Write the dependency map
const outputDir = path.resolve('../../content/deps');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'all_npcs.deps.json');
fs.writeFileSync(outputPath, JSON.stringify({
    cacheRevision: 4529,
    cacheDate: '2024-11-27',
    totalNpcs: result.children.size,
    decoded,
    failed,
    npcs: depMap,
}, null, 2));

console.log(`\nDependency map written to: ${outputPath}`);
console.log(`File size: ${fs.statSync(outputPath).size} bytes`);

// Print some interesting stats
const allModelIds = new Set<number>();
const allAnimIds = new Set<number>();
for (const entry of Object.values(depMap)) {
    if (entry.models) for (const m of entry.models) allModelIds.add(m);
    if (entry.animations) for (const a of entry.animations) allAnimIds.add(a);
}
console.log(`\nUnique model IDs referenced: ${allModelIds.size}`);
console.log(`Unique animation IDs referenced: ${allAnimIds.size}`);

// Find the NPC with the most models
let maxModels = 0;
let maxModelsNpc = '';
for (const [id, entry] of Object.entries(depMap)) {
    if (entry.models && entry.models.length > maxModels) {
        maxModels = entry.models.length;
        maxModelsNpc = `${id} (${entry.name || 'unnamed'})`;
    }
}
console.log(`NPC with most models: ${maxModelsNpc} (${maxModels} models)`);

reader.close();
console.log('\n=== Done ===');
