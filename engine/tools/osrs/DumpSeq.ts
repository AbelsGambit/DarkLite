import FlatFileCacheReader from "#/cache/osrs/FlatFileCacheReader.js";
import Packet from "#/io/Packet.js";
const reader = new FlatFileCacheReader("data/osrs-cache-flat");
const seqResult = reader.readArchive(2, 12);
if (!seqResult) { console.error("Failed"); process.exit(1); }

// Try the 377 format: op1 = g1 count + count*(g2 frame + g2 iframe + g2 delay)
for (const seqId of [11391, 11390, 63, 66, 0]) {
    const buf = seqResult.children.get(seqId);
    if (!buf) { console.log(`Seq ${seqId}: NOT FOUND`); continue; }
    console.log(`\nSeq ${seqId}: ${buf.length} bytes`);
    console.log(`  Raw: ${Array.from(buf.slice(0, 40)).map(b => b.toString(16).padStart(2, "0")).join(" ")}`);

    // Try 377 format
    const p = new Packet(buf);
    const op = p.g1();
    if (op !== 1) {
        console.log(`  First op = ${op} (not 1, trying as direct opcode)`);
        // Maybe it starts with a different opcode
        // Try reading as 377 with op != 1
        p.pos = 0;
        while (p.available > 0) {
            const code = p.g1();
            if (code === 0) { console.log(`  op 0 (end)`); break; }
            if (code === 1) {
                const count = p.g1();
                console.log(`  op 1: count=${count}`);
                for (let i = 0; i < count; i++) {
                    const frame = p.g2();
                    const iframe = p.g2();
                    const delay = p.g2();
                    console.log(`    frame[${i}]: id=${frame}, iframe=${iframe === 65535 ? -1 : iframe}, delay=${delay}`);
                }
            } else if (code === 2) { console.log(`  op 2: loops=${p.g2()}`); }
            else if (code === 3) { const c = p.g1(); console.log(`  op 3: walkmerge count=${c}`); for (let i=0;i<c;i++) p.g1(); }
            else if (code === 4) { console.log(`  op 4: stretches`); }
            else if (code === 5) { console.log(`  op 5: priority=${p.g1()}`); }
            else if (code === 6) { console.log(`  op 6: lefthand=${p.g2()}`); }
            else if (code === 7) { console.log(`  op 7: righthand=${p.g2()}`); }
            else if (code === 8) { console.log(`  op 8: maxloops=${p.g1()}`); }
            else if (code === 9) { console.log(`  op 9: preanim_move=${p.g1()}`); }
            else if (code === 10) { console.log(`  op 10: postanim_move=${p.g1()}`); }
            else if (code === 11) { console.log(`  op 11: duplicatebehavior=${p.g1()}`); }
            else if (code === 250) { console.log(`  op 250: debugname=${p.gjstr()}`); }
            else { console.log(`  UNKNOWN op ${code} at pos ${p.pos-1}, stopping`); break; }
        }
    }
}
reader.close();
