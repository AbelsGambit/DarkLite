/**
 * Fixed TD Dependency Tracer
 *
 * Two critical fixes:
 * 1. seq.dat is archive 12 (not archive 10 as previously assumed)
 * 2. OSRS seq opcode set is completely different from RS3/317:
 *    - Op 1: frame group (g2 count + 3 arrays: lengths, frameIDs-low, frameIDs-high)
 *    - Op 2: replay offset (g2)
 *    - Op 3: interleave-leave (g1 count + g1 array)
 *    - Op 4: stretches (flag)
 *    - Op 5: forced priority (g1)
 *    - Op 6/7: left/right hand item (g2)
 *    - Op 8: max loops (g1)
 *    - Op 9/10: pre/post-anim move (g1)
 *    - Op 11: reply mode (g1)
 *    - Op 12: chat frame IDs (g1 count + g2 pairs)
 *    - Op 13: animMayaID (g4)
 *    - Op 14: Maya frame sounds (g2 count + 8-byte entries)
 *    - Op 15: keyframe range (g2 start + g2 end)
 *    - Op 17: animMayaMasks (g1 count + g1 array)
 *    - Op 18: debug name (gjstr)
 *    - Op 19: cross-world sound (flag)
 *
 * Frame ID = low + (high << 16), where high16 = frames archive, low16 = frame index
 */
import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
import Packet from '#/io/Packet.js';

const reader = new FlatFileCacheReader('data/osrs-cache-flat');

// Split npc.dat (archive 9) and seq.dat (archive 12 — NOT 10!)
const npcResult = reader.readArchive(2, 9);
const seqResult = reader.readArchive(2, 12);

if (!npcResult || !seqResult) {
    console.error('Failed to split npc.dat or seq.dat');
    process.exit(1);
}

console.log(`seq.dat (archive 12): ${seqResult.children.size} seq configs`);

// Decode seq with the CORRECT OSRS opcode set
function decodeSeq(seqId: number): {
    frames: number[];
    delays: number[];
    primaryFrames: number[];
    leftHandItem: number;
    rightHandItem: number;
    forcedPriority: number;
    maxLoops: number;
    debugname: string | null;
} {
    const buf = seqResult.children.get(seqId);
    if (!buf) return { frames: [], delays: [], primaryFrames: [], leftHandItem: -1, rightHandItem: -1, forcedPriority: -1, maxLoops: -1, debugname: null };

    const p = new Packet(buf);
    const frames: number[] = [];
    const primaryFrames: number[] = [];
    let leftHandItem = -1, rightHandItem = -1, forcedPriority = -1, maxLoops = -1;
    let debugname: string | null = null;

    while (p.available > 0) {
        const op = p.g1();
        if (op === 0) break;

        if (op === 1) {
            // Frame group: g2 count N, then N×g2 lengths, N×g2 frameIDs-low, N×g2 frameIDs-high
            // Frame ID = low + (high << 16)
            const count = p.g2();
            const lengths: number[] = [];
            const frameIdsLow: number[] = [];
            const frameIdsHigh: number[] = [];
            for (let i = 0; i < count; i++) lengths.push(p.g2());
            for (let i = 0; i < count; i++) frameIdsLow.push(p.g2());
            for (let i = 0; i < count; i++) frameIdsHigh.push(p.g2());
            for (let i = 0; i < count; i++) {
                const fid = frameIdsLow[i] + (frameIdsHigh[i] << 16);
                frames.push(fid);
                primaryFrames.push(fid);
            }
        }
        else if (op === 2) { p.g2(); } // replay offset
        else if (op === 3) { const c = p.g1(); for (let i = 0; i < c; i++) p.g1(); } // interleave-leave
        else if (op === 4) { /* stretches flag */ }
        else if (op === 5) { forcedPriority = p.g1(); } // forced priority
        else if (op === 6) { leftHandItem = p.g2(); } // left hand item
        else if (op === 7) { rightHandItem = p.g2(); } // right hand item
        else if (op === 8) { maxLoops = p.g1(); } // max loops
        else if (op === 9) { p.g1(); } // pre-anim move
        else if (op === 10) { p.g1(); } // post-anim move
        else if (op === 11) { p.g1(); } // reply mode
        else if (op === 12) { const c = p.g1(); for (let i = 0; i < c; i++) { p.g2(); p.g2(); } } // chat frame IDs
        else if (op === 13) { p.g4(); } // animMayaID
        else if (op === 14) {
            // Maya frame sounds: g2 count, each entry: g2 frameIdx + g2 soundType + g1 weight + g1 loops + g1 range + g1 retain
            const c = p.g2();
            for (let i = 0; i < c; i++) { p.g2(); p.g2(); p.g1(); p.g1(); p.g1(); p.g1(); }
        }
        else if (op === 15) { p.g2(); p.g2(); } // keyframe range
        else if (op === 17) { const c = p.g1(); for (let i = 0; i < c; i++) p.g1(); } // animMayaMasks
        else if (op === 18) { debugname = p.gjstr(0); } // debug name
        else if (op === 19) { /* cross-world sound flag */ }
        else {
            console.log(`    Unknown seq op ${op} at pos ${p.pos - 1}`);
            break;
        }
    }

    return { frames, delays: [], primaryFrames, leftHandItem, rightHandItem, forcedPriority, maxLoops, debugname };
}

// Test: decode seq 0 (should work now)
console.log('\n=== Test: Seq 0 ===');
const seq0 = decodeSeq(0);
console.log(`  Frames: [${seq0.frames.slice(0, 10).join(', ')}${seq0.frames.length > 10 ? '...' : ''}] (${seq0.frames.length} total)`);

// Decode existing demon animations
console.log('\n=== Existing Demon Animations ===');
for (const [name, id] of [['demon_walk', 63], ['demon_attack', 64], ['demon_block', 65], ['demon_ready', 66], ['demon_death', 67]]) {
    const decoded = decodeSeq(id);
    console.log(`  ${name} (seq ${id}): ${decoded.frames.length} frames, leftHand=${decoded.leftHandItem}, rightHand=${decoded.rightHandItem}`);
    if (decoded.frames.length > 0) {
        console.log(`    Frame IDs: [${decoded.frames.slice(0, 8).join(', ')}${decoded.frames.length > 8 ? '...' : ''}]`);
    }
}

// Decode TD sequences
console.log('\n=== Tormented Demon Sequences ===');
const tdSeqs: Record<string, number> = { readyanim: 11391, walkanim: 11390 };
for (const [name, id] of Object.entries(tdSeqs)) {
    const decoded = decodeSeq(id);
    console.log(`  ${name} (seq ${id}): ${decoded.frames.length} frames`);
    if (decoded.frames.length > 0) {
        console.log(`    Frame IDs: [${decoded.frames.slice(0, 10).join(', ')}${decoded.frames.length > 10 ? '...' : ''}]`);
    }
}

// Full trace
console.log('\n=== TD Full Dependency Chain ===');
console.log('NPC 13599 (Tormented Demon)');
console.log('├── Models: [53287] (from idx7)');
console.log('├── Seqs:');
for (const [name, id] of Object.entries(tdSeqs)) {
    const decoded = decodeSeq(id);
    console.log(`│   ├── ${name} (seq ${id}): ${decoded.frames.length} anim frames`);
    if (decoded.frames.length > 0) {
        console.log(`│   │   └── Frame IDs: [${decoded.frames.slice(0, 8).join(', ')}${decoded.frames.length > 8 ? '...' : ''}]`);
        console.log(`│   │   └── Each frame → anim file (has base ID in trailer)`);
    }
}
console.log('├── Stats: [255, 150, 255, 600, 255, 255]');
console.log('├── Size: 3, Combat: 450');
console.log('└── Actions: [Attack]');

// Combat mechanics summary
console.log('\n=== TD Combat Mechanics (from OSRS Wiki) ===');
console.log('1. Prayer Switching: Every 150 HP lost, switches protection prayer to last combat style used. Stops attacking 6 ticks.');
console.log('2. Fire Shield: 20% damage reduction. Drops after first attack and after fire bombs. Bonus damage window when down.');
console.log('3. Fire Bombs: Every 60 ticks (36s). Binds player, 2 bombs (1 tile + 3x3 AoE). 2 ticks to dodge. 40+ damage.');
console.log('4. Defencelessness: 30 ticks after fight start. 100% player accuracy until first hit after fire bomb.');
console.log('5. Attack Styles: Uses all 3 styles (melee/ranged/magic). Switches based on player prayer.');

reader.close();
