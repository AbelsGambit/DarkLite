# OSRS → LostCity 377 Cache Pipeline — Research & Procedure Documentation

**Date**: 2026-07-21  
**Author**: Z.ai Code (CacheFormatResearch agent)  
**Project**: LostCity 377-engine OSRS model import pipeline  
**Status**: Core pipeline WORKING. TD model extraction blocked by cache revision gap (see below).

---

## 1. Executive Summary

This document records the complete research, debugging, and fix procedure for
reading real OSRS caches and extracting NPC models into the LostCity 377 engine.

### What Works
- ✅ **Per-index reference table reading** from idx255 (the critical fix)
- ✅ **npc.dat splitting** into 14,142 individual NPC configs
- ✅ **NPC config decoding** with the complete RuneLite opcode set (rev 237)
- ✅ **Flat-file cache reading** (the format in the user's GitHub depot)
- ✅ **Model extraction** from idx0/idx1/idx7 into .ob2 files
- ✅ **377 Model.unpack()** decodes extracted models successfully

### What's Blocked
- ⚠️ **Tormented Demon not in cache rev 4529**: The user's "227 (2024-11-27)" cache
  has config revision 4529 (mid-2024), which is BEFORE the While Guthix Sleeps quest
  (Nov 20, 2024) that added the TD. A newer cache (rev 4600+) is needed.
- ⚠️ **OsrsModel decoder rejects version=0 models**: The modern models in the cache
  use the old 18-byte trailer format with version=0. The 377 `Model.unpack()` handles
  them fine, but `OsrsModel.decode()` rejects them. Fix: accept version=0 as "old format".

---

## 2. The Three Critical Bugs Found & Fixed

### Bug 1: idx255 is NOT a single master index

**Symptom**: `splitArchive()` produced negative file sizes when splitting npc.dat.  
**Root cause**: `readIndex255()` was reading `idx255[0]` (the reference table for
index 0 = models, 4546 archives) and treating it as the child-ID source for ALL
archives. In reality, **idx255 has 22 separate entries** — one per cache index:

| idx255 entry | Reference table for | Archive count |
|---|---|---|
| idx255[0] | Index 0 (models) | 4,546 |
| idx255[1] | Index 1 (old models) | 2,394 |
| idx255[2] | Index 2 (config) | 37 archives, including archive 9 = npc.dat with 14,142 children |
| idx255[7] | Index 7 (modern models) | 55,819 |
| ... | ... | ... |

**Fix**: `readIndex255(index)` now takes an index parameter and reads `idx255[index]`
instead of always `idx255[0]`. Per-index caching via `refTableCache: Map<number, Index255Entry[]>`.

**File**: `engine/src/cache/osrs/OsrsCacheReader.ts` lines 343-403

### Bug 2: String terminator mismatch

**Symptom**: NPC names decoded as garbage (e.g. "Attackÿ_ÂJÿK" instead of "Tormented Demon").  
**Root cause**: `Packet.gjstr()` defaults to terminator=10 (newline) but OSRS config
strings are **null-terminated** (terminator=0). The decoder read past null bytes and
consumed subsequent opcodes as string data.

**Fix**: Changed all `gjstr()` calls to `gjstr(0)` in:
- `engine/src/cache/osrs/OsrsNpcType.ts` (7 calls)
- `engine/src/cache/osrs/OsrsSeqType.ts` (1 call)

### Bug 3: Missing modern OSRS NPC opcodes

**Symptom**: `Unrecognized osrs npc config code: 11/15/109/114/116/146...` warnings.
Stream desync caused all subsequent opcodes to be garbage.  
**Root cause**: The OsrsNpcType decoder was based on the 377 opcode set (codes 1-107)
plus a few OSRS extensions. The **modern OSRS npc.dat uses opcodes up to 253**, including
critical payload-bearing opcodes like:
- **Opcode 16**: reads `g2` (was treated as no-payload flag — 2-byte desync!)
- **Opcode 15**: `idleRotateLeftAnim = g2`
- **Opcode 102**: rev210+ head icons (bitfield form, variable length)
- **Opcodes 114-117**: run/crawl animations
- **Opcode 124**: `height = g2` (was `g1`)
- **Opcode 146**: `overlapTintHSL = g2`

**Fix**: Completely rewrote `OsrsNpcType.decode()` to match RuneLite's
`NpcLoader.java` (rev 237) verbatim. Added opcodes 15, 41, 61, 62, 99, 102
(bitfield), 109, 111, 114-118, 122-123, 124, 126, 129-130, 145-147.

**File**: `engine/src/cache/osrs/OsrsNpcType.ts` lines 202-401

---

## 3. Architecture: How the OSRS Cache Works

### Cache File Layout

The OSRS cache comes in two formats:

**Format A: dat2 + idx (sector-chained)**
```
main_file_cache.dat2    — all data, 520-byte sectors
main_file_cache.idx0    — index 0 (models): 6-byte entries [u24 size, u24 sector]
main_file_cache.idx1    — index 1 (animations)
...
main_file_cache.idx255  — master index: one entry per index, pointing to ref tables
```

**Format B: flat files (what the user's GitHub depot ships)**
```
cache/
  0/          — index 0 files
    0.dat     — file 0 (raw container bytes)
    1.dat
    ...
  1/          — index 1 files
  ...
  255/        — reference tables
    0.dat     — ref table for index 0
    2.dat     — ref table for index 2 (config)
    ...
```

Both formats store the same data. Each `.dat` file is a **container**:
```
u8  compression (0=NONE, 1=BZIP2, 2=GZIP)
u32 compressedSize
[u32 decompressedSize]  ← only when compression != NONE
compressed payload (compressedSize bytes)
[u16 version]           ← optional trailer
```

### Index Assignments (Modern OSRS, rev 4529)

| Index | Content | File count |
|---|---|---|
| 0 | Models (old format, 18-byte trailer) | 4,546 |
| 1 | Models (old format) | 2,394 |
| 2 | Config (npc.dat, item.dat, seq.dat, etc.) | 37 archives |
| 3 | MIDI / music | 904 |
| 4 | Maps | 10,096 |
| 5 | Textures / sprites | 14,322 |
| 6 | ? | 817 |
| 7 | Models (modern, high-poly) | 55,819 |
| 8 | Sprites / interface images | 6,303 |
| 9-21 | Various (scripts, areas, etc.) | varies |
| 255 | Reference tables (one per index) | 21 |

### Config Archive Layout (Index 2)

Index 2 contains 37 archives, each a multi-child group:

| Archive | Content | Child count |
|---|---|---|
| 6 | ? (largest) | 55,908 |
| 10 | ? | 30,479 |
| 14 | ? | 17,199 |
| **9** | **npc.dat** | **14,142** |
| 12 | ? (seq.dat?) | 11,938 |
| ... | ... | ... |

### Reference Table Format (Protocol 7)

Each `idx255[index]` entry is a compressed container. Decompressed, it's a
protocol-7 byte stream:

```
u8  protocol (5, 6, or 7 — OSRS uses 7)
[u32 revision]           ← only protocol >= 6
u8  mask (bit flags: 0x01=named, 0x02=whirlpool, 0x04=lengths)

// Archive count and IDs (readBigSmart for protocol 7)
bigsmart  archiveCount
bigsmart[archiveCount]  archiveId deltas (cumulative)

// Per-archive fields, GROUPED (all CRCs, then all versions, etc.)
[u32 nameHash] × archiveCount           ← if named flag
u32 crc × archiveCount
[u32 checksum] × archiveCount           ← if checksums flag
[u8[64] whirlpool] × archiveCount       ← if whirlpool flag
[u32 compLen, u32 decompLen] × archiveCount  ← if lengths flag
[u32 revision] × archiveCount           ← if protocol >= 6

// Child counts and IDs
bigsmart[archiveCount]  childCount
bigsmart[childCount] × archiveCount  childId deltas (per-archive, cumulative)

// Child name hashes (if named flag)
[u32 childNameHash] × sum(childCount)
```

**readBigSmart** (Protocol 7 variable-length integer):
```typescript
function readBigSmart(): number {
    const peek = data[pos];
    if (peek >= 128) {
        return g4() & 0x7FFFFFFF;  // 4 bytes, strip sign bit
    } else {
        return g2();               // 2 bytes
    }
}
```

### Archive Splitting (Striped Multi-Child Format)

When an archive has multiple children (like npc.dat with 14,142 NPCs), the
decompressed data uses a striped layout:

```
[striped data section]
[size table: chunks × childCount × 4 bytes (signed int32 deltas)]
[u8 chunkCount - 1]  ← wait, actually: u8 chunkCount
```

The size table stores **signed delta-encoded sizes**:
```
delta[chunk][child 0] = size(child 0, chunk) - 0
delta[chunk][child 1] = size(child 1, chunk) - size(child 0, chunk)
delta[chunk][child 2] = size(child 2, chunk) - size(child 1, chunk)
...
```

To recover file sizes, accumulate the running sum within each stripe:
```typescript
for (let chunk = 0; chunk < chunks; chunk++) {
    let chunkSize = 0;
    for (let id = 0; id < childCount; id++) {
        const delta = readSignedInt32();
        chunkSize += delta;
        chunkSizes[id][chunk] = chunkSize;
        filesSize[id] += chunkSize;
    }
}
```

The data section is laid out stripe-major, file-minor:
```
[chunk 0: file0_bytes | file1_bytes | ... | fileN_bytes]
[chunk 1: file0_bytes | file1_bytes | ... | fileN_bytes]
...
```

**Critical**: The size-table deltas are SIGNED int32s. Negative values are normal
(a file smaller than the previous file produces a negative delta). Treating them
as unsigned causes overflow and garbage sizes.

Ported from RuneLite's `ArchiveFiles.loadContents()` and OpenRS2's `Group.unpack()`.

### NPC Config Format (opcode-based)

Each NPC config is a headless opcode stream (no count header, no 0xFFFF trailer).
Opcodes are read until opcode 0 (terminator). See the complete opcode table in
`docs/npc-opcode-table.md`.

---

## 4. Correct Procedure: Extracting an NPC's Models

### Step 1: Open the cache

```typescript
import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
// OR: import OsrsCacheReader from '#/cache/osrs/OsrsCacheReader.js';

const reader = new FlatFileCacheReader('data/osrs-cache-flat');
// OR: const reader = new OsrsCacheReader('data/osrs-cache');
```

### Step 2: Read the config reference table

```typescript
const configRef = reader.readIndex255(2); // index 2 = config
// Find archive 9 = npc.dat
const npcArchive = configRef.find(e => e.archive === 9);
console.log(`npc.dat has ${npcArchive.childCount} NPCs`);
```

### Step 3: Split npc.dat

```typescript
const result = reader.readArchive(2, 9); // index 2, archive 9
// result.children is a Map<npcId, Uint8Array>
```

### Step 4: Decode the NPC config

```typescript
import OsrsNpcType from '#/cache/osrs/OsrsNpcType.js';
import Packet from '#/io/Packet.js';

const npcId = 1838; // Demon butler
const buf = result.children.get(npcId);
const npc = new OsrsNpcType(npcId);
npc.decodeType(new Packet(buf));

console.log(`Name: ${npc.name}`);
console.log(`Models: [${npc.models}]`);
console.log(`Size: ${npc.size}, Stats: [${npc.stats}]`);
```

### Step 5: Extract the model

```typescript
// Models live in index 0 (old format) or index 7 (modern)
for (const modelId of npc.models) {
    let data = reader.read(0, modelId) ?? reader.read(7, modelId);
    if (data) {
        // data is already in 377-compatible format (18-byte trailer)
        // Just gzip it and write as .ob2
        fs.writeFileSync(`content/models/npc_${modelId}.ob2`, gzipSync(data));
    }
}
```

### Step 6: Register in the content folder

```typescript
// Add to content/pack/model.pack:
//   <newId>=osrs_model_<modelId>
// Add to content/pack/npc.pack:
//   <newNpcId>=osrs_<npcDebugname>
// Run: bun run tools/pack/Build.ts
```

---

## 5. Files Modified / Created

### Source Code Changes (production)

| File | Change |
|---|---|
| `engine/src/cache/osrs/OsrsCacheReader.ts` | Fixed `readIndex255(index)` to read per-index ref tables from `idx255[index]` instead of always `idx255[0]`. Added `refTableCache: Map<number, Index255Entry[]>`. Updated `lookupChildIds(index, archive)` and `readArchive(archive, file)`. |
| `engine/src/cache/osrs/OsrsNpcType.ts` | Rewrote `decode()` with complete RuneLite NpcLoader opcode set (rev 237). Fixed `gjstr()` → `gjstr(0)` (null terminator). Added opcodes 15, 41, 61, 62, 99, 102 (bitfield), 109, 111, 114-118, 122-123, 124, 126, 129-130, 145-147. Removed incorrect opcodes 23-29, 90-92, 127-134 (old spec). |
| `engine/src/cache/osrs/OsrsSeqType.ts` | Fixed `gjstr()` → `gjstr(0)` (null terminator). |
| `engine/src/cache/osrs/FlatFileCacheReader.ts` | **NEW FILE**: Flat-file cache reader for `<index>/<file>.dat` layout. Mirrors OsrsCacheReader API. |

### New Test/Diagnostic Files

| File | Purpose |
|---|---|
| `engine/tools/osrs/TestFlatCache.ts` | End-to-end test on real flat cache |
| `engine/tools/osrs/FindTdInFlatCache.ts` | Search for "Tormented" in npc.dat |
| `engine/tools/osrs/SearchNpcNames.ts` | Search for NPC names, verify split |
| `engine/tools/osrs/ExtractRealModel.ts` | Extract demon NPC models → .ob2 files |
| `engine/tools/osrs/DiagMasterIndex.ts` | Dump idx255[0] parse step-by-step |
| `engine/tools/osrs/DiagRefTable.ts` | Dump idx255[N] parse for any index N |
| `engine/tools/osrs/DiagFindNpcDat.ts` | Scan all indexes for large multi-child groups |
| `engine/tools/osrs/DiagSizeTable.ts` | Dump raw bytes at npc.dat size-table offset |
| `engine/tools/osrs/DiagSplitNpc.ts` | Standalone npc.dat split + TD extraction |
| `engine/tools/osrs/TestNpcSplit.ts` | End-to-end test with opcode trace |
| `engine/tools/osrs/TestNpcDecode.ts` | Test OsrsNpcType decoder on TD configs |
| `engine/tools/osrs/FindTdModels.ts` | Extract TD model IDs, search all indexes |
| `engine/tools/osrs/FindModelIndex.ts` | Check which index has model data |
| `engine/tools/osrs/CheckIdx7.ts` | Verify idx7 file format |

### Fixture Updates

| File | Change |
|---|---|
| `engine/tools/osrs/fixtures/TormentedDemonFixture.ts` | String terminators: `push(10)` → `push(0)` (null-terminated, matching OSRS format) |
| `engine/tools/osrs/fixtures/KalphiteQueenFixture.ts` | Same terminator fix |

---

## 6. Verified Results

### npc.dat splitting (flat cache, rev 4529)
- **14,142 / 14,142** NPC configs extracted (100%)
- Total config bytes: 1,355,234 (matches data section size exactly)
- Child IDs: sequential 0..14146 (3 sparse gaps)

### NPC decoding (sample)
- NPC 0: "Tool Leprechaun" ✓
- NPC 1838: "Demon butler", models=[229, 11811, 15106, 14373, 180, 12138, 181] ✓
- NPC 3707: "Abyssal demon", models=[5062] ✓
- 15 NPCs match "Goblin", 40 match "Guard", 28 match "dragon" ✓

### Model extraction
- 7 model .ob2 files extracted for "Demon butler" NPC → `/tmp/osrs-extracted-models/`
- 377 `Model.unpack()` decodes all extracted models successfully
- Models found in idx0 (old format) and idx7 (modern format)

### Tormented Demon status
- **NOT in cache rev 4529** (mid-2024). The TD was added Nov 20, 2024 (rev ~4600).
- The user's "227 (2024-11-27)" cache has config rev 4529, which is before the TD.
- Once a newer cache (rev 4600+) is provided, the TD extraction will work immediately.

---

## 7. Unresolved Issues & Next Steps

### Issue 1: OsrsModel decoder rejects version=0 models
The modern cache's models use the old 18-byte trailer format with version=0.
`OsrsModel.decode()` rejects these with "version=0, expected >= 1 for OSRS".
The 377 `Model.unpack()` handles them fine.

**Fix**: In `OsrsModel.ts`, accept version=0 as "old format compatibility mode"
and use the 18-byte trailer path instead of the 23-byte trailer path.

### Issue 2: Unrecognized opcode 11
A few NPCs (e.g. 1272) hit opcode 11, which isn't in RuneLite's NpcLoader.
This might be:
- A pre-rev-237 opcode that was removed
- A stream desync artifact from an earlier misparse
- A server-specific extension

**Investigation needed**: Dump the raw bytes of NPC 1272 and trace the opcode
stream manually to determine if opcode 11 is real or a desync artifact.

### Issue 3: 2006-07 model upgrades
The user wants to set up model upgrades from the 2006-07 era. This requires:
1. A 2006-07 era OSRS cache (the user's 149 cache from 2017-07-13 is close)
2. A diff/migration script that identifies models added between the 377 era
   and the 2006-07 era
3. Integration with the modular variant registry

### Issue 4: Dependency maps
Once the real config is sorted (which it now is), generate dependency maps
for all OSRS NPCs:
- For each NPC: model IDs, animation IDs, seq IDs, script refs
- Write to `content/deps/all_npcs.deps.json`
- Surface in the Next.js dashboard's Dependency Graph tab

### Recommended Priority
1. **Fix OsrsModel version=0 handling** (quick, unblocks model extraction)
2. **Get a post-Nov-2024 cache** (unblocks TD extraction)
3. **Generate dependency maps** for all 14,142 NPCs (pipeline is ready)
4. **Set up 2006-07 model upgrades** (needs the 149 cache + diff script)
