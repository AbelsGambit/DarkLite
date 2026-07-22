import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
import Packet from '#/io/Packet.js';

const reader = new FlatFileCacheReader('data/osrs-cache-flat');
const seqResult = reader.readArchive(2, 12);
if (!seqResult) { console.error('Failed'); process.exit(1); }

// OSRS seq format: same as 377 but op 1 uses g2 count (not g1)
function decodeSeq(seqId: number) {
    const buf = seqResult.children.get(seqId);
    if (!buf) return null;
    const p = new Packet(buf);
    const frames: { id: number; iframe: number; delay: number }[] = [];
    let priority = -1, debugname: string | null = null;

    while (p.available > 0) {
        const op = p.g1();
        if (op === 0) break;
        if (op === 1) {
            const count = p.g2(); // g2 in OSRS (g1 in 377)
            for (let i = 0; i < count; i++) {
                const frame = p.g2();
                const iframe = p.g2();
                const delay = p.g2();
                frames.push({ id: frame, iframe: iframe === 65535 ? -1 : iframe, delay });
            }
        } else if (op === 2) { p.g2(); }
        else if (op === 3) { const c = p.g1(); for (let i = 0; i < c; i++) p.g1(); }
        else if (op === 4) {}
        else if (op === 5) { priority = p.g1(); }
        else if (op === 6) { p.g2(); }
        else if (op === 7) { p.g2(); }
        else if (op === 8) { p.g1(); }
        else if (op === 9) { p.g1(); }
        else if (op === 10) { p.g1(); }
        else if (op === 11) { p.g1(); }
        else if (op === 250) { debugname = p.gjstr(0); }
        else { console.log(`  Unknown op ${op}`); break; }
    }
    return { frames, priority, debugname };
}

console.log('=== TD Animation Frame IDs ===\n');
for (const [name, id] of [['readyanim', 11391], ['walkanim', 11390]]) {
    const d = decodeSeq(id);
    if (d) {
        console.log(`${name} (seq ${id}): ${d.frames.length} frames, priority=${d.priority}`);
        console.log(`  Frame IDs: [${d.frames.map(f => f.id).join(', ')}]`);
        console.log(`  Delays: [${d.frames.map(f => f.delay).join(', ')}]`);
    }
}

console.log('\n=== Existing Demon Animations ===');
for (const [name, id] of [['demon_walk', 63], ['demon_attack', 64], ['demon_block', 65], ['demon_ready', 66], ['demon_death', 67]]) {
    const d = decodeSeq(id);
    if (d) {
        console.log(`${name} (seq ${id}): ${d.frames.length} frames, IDs=[${d.frames.slice(0, 8).map(f => f.id).join(', ')}${d.frames.length > 8 ? '...' : ''}]`);
    }
}

reader.close();
