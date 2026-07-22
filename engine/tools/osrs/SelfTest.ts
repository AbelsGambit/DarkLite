/**
 * Stub-driven self-test for DependencyTracer.
 *
 * Verifies the transitive walk actually descends into models / seqs /
 * anims / params when a stub CacheReader returns mocked objects.
 * Not part of the shipped tooling — run with:
 *   bun tools/osrs/SelfTest.ts
 */
import fs from 'fs';

import AnimBase from '#/cache/graphics/AnimBase.js';
import OsrsModel from '#/cache/osrs/OsrsModel.js';
import OsrsAnimFrame from '#/cache/osrs/OsrsAnimFrame.js';
import OsrsSeqType from '#/cache/osrs/OsrsSeqType.js';
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import ParamType from '#/cache/config/ParamType.js';
import StructType from '#/cache/config/StructType.js';

import { CacheReader, DependencyTracer } from './DependencyTracer.js';
import { NodeKind } from './DepsSchema.js';

// Synthetic OSRS NPC: id=9001, name='tormented_demon_stub'
//   models=[45000], heads=[45001], readyanim=9100, walkanim=9101
//   params={ 999 (attack_anim, type=seq) -> 9200 }
const npc = new OsrsNpcType(9001);
npc.name = 'tormented_demon_stub';
npc.models = new Uint16Array([45000]);
npc.heads = new Uint16Array([45001]);
npc.readyanim = 9100;
npc.walkanim = 9101;
npc.runanim = 9102;
npc.params = new Map([[999, 9200]]);

// Synthetic OSRS seqs
const seq9100 = new OsrsSeqType(9100);
seq9100.debugname = 'td_stand';
seq9100.frames = new Int32Array([2001, 2002]);
seq9100.iframes = new Int32Array([-1, -1]);
seq9100.delay = new Int32Array([2, 2]);

const seq9101 = new OsrsSeqType(9101);
seq9101.debugname = 'td_walk';
seq9101.frames = new Int32Array([2003]);

const seq9102 = new OsrsSeqType(9102);
seq9102.debugname = 'td_run';
seq9102.frames = new Int32Array([2004]);

const seq9200 = new OsrsSeqType(9200);
seq9200.debugname = 'td_attack';
seq9200.frames = new Int32Array([2005]);

// Synthetic OSRS model (no real bytes — we skip OsrsModel.decode).
// Cast through unknown to bypass the private constructor.
const model = new (OsrsModel as unknown as new (id: number) => OsrsModel)(45000);
(model as unknown as { triangleSkin: Int32Array | null }).triangleSkin = null;
(model as unknown as { vertexSkin: Int32Array | null }).vertexSkin = null;

const modelHeads = new (OsrsModel as unknown as new (id: number) => OsrsModel)(45001);
(modelHeads as unknown as { triangleSkin: Int32Array | null }).triangleSkin = null;
(modelHeads as unknown as { vertexSkin: Int32Array | null }).vertexSkin = null;

// Synthetic OSRS anim frames — base=36 for all.
const animFrame = (id: number): OsrsAnimFrame => {
    const f = new OsrsAnimFrame();
    f.base = 36;
    f.frameId = id;
    return f;
};

// Synthetic AnimBase (skeleton).
const animBase = new AnimBase(36);
animBase.length = 1;

// Synthetic param: id=999, type=seq, debugname='attack_anim'
const param999 = new ParamType(999);
param999.debugname = 'attack_anim';
// Set type via the field (private setter not exposed — use cast).
(param999 as unknown as { type: number }).type = 65; // ScriptVarType.SEQ

class StubReader implements CacheReader {
    readModel(id: number): OsrsModel | null {
        if (id === 45000) return model;
        if (id === 45001) return modelHeads;
        return null;
    }
    readAnim(id: number): OsrsAnimFrame | null {
        if ([2001, 2002, 2003, 2004, 2005].includes(id)) return animFrame(id);
        return null;
    }
    readAnimBase(id: number): AnimBase | null {
        return id === 36 ? animBase : null;
    }
    readSeq(id: number): OsrsSeqType | null {
        switch (id) {
            case 9100: return seq9100;
            case 9101: return seq9101;
            case 9102: return seq9102;
            case 9200: return seq9200;
            default: return null;
        }
    }
    readNpc(id: number): OsrsNpcType | null {
        return id === 9001 ? npc : null;
    }
    readObj(): ObjType | null { return null; }
    readParam(id: number): ParamType | null {
        return id === 999 ? param999 : null;
    }
    readStruct(): StructType | null { return null; }
    readTexture(): Uint8Array | null { return null; }
    readParticle(): Uint8Array | null { return null; }
    readSound(): Uint8Array | null { return null; }
    getName(kind: NodeKind, id: number | string): string | null {
        if (kind === 'npc' && id === 9001) return 'tormented_demon_stub';
        return null;
    }
}

const tracer = new DependencyTracer(new StubReader(), { scriptDir: '/tmp/nonexistent-scripts' });
const deps = tracer.trace(9001);
const json = tracer.serialize(deps);
fs.writeFileSync('/tmp/test-deps-stub.json', json);

console.log('--- STUB TRACE SUMMARY ---');
console.log(`root: ${deps.root.kind}:${deps.root.id} (${deps.root.name})`);
console.log(`nodes: ${Object.keys(deps.nodes).length}`);
console.log(`cycles: ${deps.cycles.length}`);
console.log(`missing: ${deps.missing.length}`);
console.log('node keys:');
for (const k of Object.keys(deps.nodes).sort()) {
    const n = deps.nodes[k];
    console.log(`  ${k}  name=${n.name ?? '-'}  missing=${n.missing ?? false}  deps=${n.deps.length}  ${n.note ?? ''}`);
}
console.log('--- END ---');
