# LostCity OSRS Pipeline — Research & Knowledge Progress

**Last Updated**: 2026-07-22  
**Branch**: wip/osrs-pipeline  
**Status**: Core pipeline working, TD extraction verified, Launcher UI functional

---

## 1. Project Architecture

### Directory Layout
```
/home/z/my-project/           # Next.js launcher dashboard
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main dashboard (6 tabs)
│   │   └── api/
│   │       ├── crc-bypass/   # CRC check toggle API
│   │       ├── debug-npc/    # Map file patcher (Hans swap)
│   │       ├── github-download/  # GitHub file downloader
│   │       ├── launcher/     # Shell command executor
│   │       ├── models-import/    # Model/NPC import manager
│   │       ├── pipeline-status/
│   │       ├── variants/
│   │       └── player-preferences/
│   └── components/dashboard/
│       ├── models-tab.tsx    # Models tab (CRC bypass + mod management)
│       ├── debug-tab.tsx     # Debug tab (Quick Debug tests)
│       ├── play-tab.tsx      # Play tab (launcher buttons)
│       └── ...
├── electron/                 # Electron standalone wrapper
│   ├── main.js               # Electron main process
│   ├── preload.js            # Preload script
│   └── package.json          # Electron build config
└── lostcity/
    ├── engine/               # LostCity TypeScript engine
    │   ├── src/cache/osrs/   # OSRS cache decoders
    │   ├── tools/osrs/       # Import pipeline tools
    │   └── data/osrs-cache-flat/  # OSRS flat cache (not in repo)
    ├── content/              # Game content folder
    │   ├── models/npc/       # NPC model .ob2 files
    │   ├── pack/             # Pack files (model.pack, npc.pack, etc.)
    │   ├── scripts/npc/configs/  # NPC config .npc files
    │   └── maps/             # Map .jm2 files (ASCII text format)
    └── client/               # Java game client (gradle)
```

### Dashboard Tabs (keyboard shortcuts 1-6)
1. **Overview** (amber) — Pipeline status
2. **Configuration** (emerald) — Settings
3. **Dependency graph** (rose) — NPC dependency visualization
4. **Models** (cyan) — CRC bypass + model import management
5. **Debug** (violet) — Quick Debug tests (Hans swap, admin, god mode)
6. **Play** (blue) — Launcher (Play, Build, Clean Build buttons)

---

## 2. OSRS Cache Format Research

### Cache Structure (227 revision, Nov 2024)
- **Format**: Flat files (`<index>/<file>.dat`) — each file is a container
- **Container format**: `u8 compression + u32 compressedSize + [u32 decomcompressedSize] + payload`
- **Compression**: 0=NONE, 1=BZIP2 (stripped "BZh1" header), 2=GZIP

### Index Assignments
| Index | Content | File count |
|---|---|---|
| 0 | Old models (18-byte trailer, version=0) | 4,546 |
| 2 | Config (npc.dat=archive 9, seq.dat=archive 10) | 37 archives |
| 7 | Modern models (high-poly) | 55,819 |
| 255 | Reference tables (one per index) | 21 |

### Key Config Archives (Index 2)
| Archive | Content | Child count |
|---|---|---|
| 6 | Items? | 55,908 |
| 9 | npc.dat | 14,142 |
| 10 | seq.dat | 30,479 |
| 12 | ? | 11,938 |
| 14 | ? | 17,199 |

### Reference Table Format (Protocol 7)
- `readBigSmart()`: if first byte >= 128, read u32 & 0x7FFFFFFF; else read u16
- Per-index: `idx255[index]` contains the ref table for that index
- Fields grouped: all CRCs, then all versions, then all child counts, then child IDs

### Archive Split Format (RuneLite ArchiveFiles.loadContents)
```
[striped data section]
[size table: chunks × childCount × 4 bytes (signed int32 deltas)]
[u8 chunkCount]
```

**CRITICAL**: The size table stores SIGNED deltas. The cumulative sum IS the file's actual size. For chunks=1:
- `delta[0] = file[0].size`
- `delta[1] = file[1].size - file[0].size`
- `cumulative[0] = delta[0] = file[0].size`
- `cumulative[1] = delta[0] + delta[1] = file[1].size`

Read the CUMULATIVE (not the delta) when extracting file data.

---

## 3. NPC Config Decoder (OsrsNpcType.ts)

### Complete Opcode Set (RuneLite NpcLoader.java rev 237)
| Opcode | Payload | Field |
|---|---|---|
| 1 | g1 N + N×g2 | models[] (16-bit) |
| 2 | gjstr(0) | name |
| 12 | g1 | size |
| 13 | g2 | standingAnimation |
| 14 | g2 | walkingAnimation |
| 15 | g2 | idleRotateLeft |
| 16 | g2 | idleRotateRight (NOT no-payload!) |
| 17 | 4×g2 | walk, back, left, right |
| 18 | g2 | category |
| 30-34 | gjstr(0) | op1-op5 |
| 40 | g1 N + N×(g2,g2) | recolors |
| 41 | g1 N + N×(g2,g2) | texture recolors |
| 60 | g1 N + N×g2 | chatheadModels[] (16-bit) |
| 61 | g1 N + N×g4 | models[] (32-bit) |
| 62 | g1 N + N×g4 | chatheadModels[] (32-bit) |
| 74-79 | g2 | stats[0-5] |
| 93 | — | minimap=false |
| 95 | g2 | combatLevel |
| 97-98 | g2 | widthScale/heightScale |
| 99 | — | renderPriority=1 |
| 100-101 | g1b | ambient/contrast |
| 102 | bitfield form | head icons (rev210+) |
| 103 | g2 | rotationSpeed |
| 106 | g2+g2+g1+(N+1)×g2 | varbit, varp, configs[] |
| 107 | — | isInteractable=false |
| 109 | — | rotationFlag=false |
| 111 | — | renderPriority=2 |
| 114-117 | g2 or 4×g2 | run/crawl animations |
| 118 | g2+g2+g2+g1+(N+1)×g2 | varbit with fallback |
| 122-123 | — | follower flags |
| 124 | g2 | height |
| 126 | g2 | footprintSize |
| 129-130 | — | flags |
| 145-147 | — or g2 | overlap/zbuf flags |
| 249 | params | parameter map |
| 250 | gjstr(0) | debugname |

### Key Fixes Applied
1. **gjstr(0)** — OSRS strings are null-terminated, not newline-terminated
2. **Opcode 16 reads g2** — was treated as no-payload flag (2-byte desync)
3. **Opcode 124 reads g2** — was g1

---

## 4. Dependency Map

### Generated Map: `content/deps/all_npcs_full.deps.json` (10MB)
- **14,097/14,142 NPCs decoded** (99.7%)
- **12,069 NPCs with models** (8,476 unique model IDs)
- **12,468 NPCs with sequences** (1,940 unique seq IDs)
- **4,934 NPCs with params**

### Dependency Types Traced
- **Direct**: models, heads, seqs (stand/walk/run/crawl/rotate), recolors, head icons, stats, actions, params
- **Multivar**: varbit, varp, multinpc list
- **External (heuristic)**: area:barrows, area:kalphite, category:demon, slayer:category

### TD Dependency Chain
```
NPC 13599 (Tormented Demon)
├── models: [53287] (from idx7, 16,521 bytes)
├── seqs: {readyanim: 11391, walkanim: 11390}
│   ├── Seq 11391: 244 bytes (in archive 10)
│   └── Seq 11390: 7 bytes (in archive 10)
├── stats: [255, 150, 255, 600, 255, 255]
├── size: 3, vislevel: 450
└── actions: ["Attack"]
```

### TODO: Complete Nested Tracing
- [ ] Parse seq configs to extract anim frame IDs
- [ ] Trace anim frame → anim base dependencies
- [ ] Import TD animations (not just reuse existing demon_walk etc.)

---

## 5. Launcher Architecture

### CRC Bypass System
- **File**: `engine/src/io/Packet.ts` line 63
- **ON**: `return true;` — accepts any cache file (required for modding)
- **OFF**: `return Packet.getcrc(src, offset, length) == expected;` — standard integrity
- **Unknown**: anything else — show warning, allow modding anyway

### Model Import Flow
1. User enables CRC bypass (Models tab)
2. User clicks "Download Models" → GitHub API fetches .ob2 files from repo
3. User clicks "Apply Import" → API writes .npc config + updates pack files
4. User clicks "Build Game" (Play tab) → `bun run build` packs the cache
5. User clicks "Play" → client launches with modified cache

### Map File Format (.jm2)
- ASCII text, not binary!
- Sections: `==== MAP ====`, `==== LOC ====`, `==== NPC ====`, `==== OBJ ====`
- NPC spawn: `<level> <x> <z>: <npcId>`
- Hans is at `0 7 33: 0` in m50_50.jm2 (Lumbridge castle courtyard)

---

## 6. GitHub Integration

### Download API (`/api/github-download`)
- Uses `raw.githubusercontent.com` for file downloads (no rate limit)
- Uses `api.github.com` for directory listings (rate limited)
- Tracks `X-RateLimit-Remaining` header
- Authenticated: 5000/hr, Unauthenticated: 60/hr (conservative: 4000/40)
- Downloads only needed files (not the whole repo)

### Files Stored in Repo (wip/osrs-pipeline branch)
- `engine/src/cache/osrs/` — 9 source files (decoders)
- `engine/tools/osrs/` — 18 tool files (import scripts)
- `content/models/npc/osrs_td_*.ob2` — 3 TD model files
- `content/scripts/npc/configs/osrs_tormented_demon.npc` — TD NPC config
- `dashboard/` — Dashboard source (page.tsx, tabs, APIs)
- `electron/` — Electron wrapper

### Files NOT in Repo
- `engine/data/osrs-cache-flat/` — 487MB OSRS cache (too large, user downloads separately)
- `engine/data/pack/` — Generated by `bun run build`
- `node_modules/` — Installed by `bun install`

---

## 7. Electron Standalone App

### Structure (`electron/`)
- `main.js` — Spawns Next.js server, creates BrowserWindow, handles cleanup
- `preload.js` — Minimal context bridge
- `package.json` — electron-builder config (NSIS for Windows, AppImage for Linux)

### Build Instructions
```bash
cd electron/
npm install
npm run build-win    # Windows .exe (NSIS installer)
npm run build-linux  # Linux AppImage
```

### Release v0.1 Plan
- GitHub Release with built .exe + game files
- User downloads, installs, launches
- Launcher auto-starts Next.js dashboard
- User enables CRC bypass, downloads models, imports, builds, plays

---

## 8. Future Work

### Next Priorities
1. **Complete TD animation import** — parse seq.dat to extract anim frames, import them
2. **Client visual changes** — sprite modifications (documented for future, not started)
3. **More model imports** — Barrows brothers, metal dragons, etc.
4. **Tauri wrapper** — lighter than Electron (~5MB vs ~80MB)

### Client Visual Research (for future)
- Client sprites are in `content/sprites/` and `content/title/`
- Client reads from cache archive 8 (sprites)
- Sprite format: `.sprite` files packed via `tools/pack/sprite/`
- To change visuals: modify sprite files → rebuild cache → client loads new sprites
- "Buttons which no longer exist visually" can be filled with 0x00 or 0xFF and locked behind if statements in the Java client

---

## 9. OSRS seq.dat Format (CRITICAL — Fixed)

### Archive Assignment
- **seq.dat = archive 12** (NOT archive 10 as previously assumed)
- Archive 12 has 11,938 seq configs (rev 227)

### seq Opcode Set (rev 226+, verified against real cache)
| Op | Hex | Field | Payload |
|----|-----|-------|---------|
| 0 | 00 | terminator | — |
| 1 | 01 | frame group | g2 count N, N×g2 lengths, N×g2 frameIDs-low, N×g2 frameIDs-high |
| 2 | 02 | replay offset | g2 |
| 3 | 03 | interleave-leave | g1 count + g1 array |
| 4 | 04 | stretches | flag |
| 5 | 05 | forced priority | g1 |
| 6 | 06 | left-hand item | g2 |
| 7 | 07 | right-hand item | g2 |
| 8 | 08 | max loops | g1 |
| 9 | 09 | pre-anim move | g1 |
| 10 | 0A | post-anim move | g1 |
| 11 | 0B | reply mode | g1 |
| 12 | 0C | chat frame IDs | g1 count + g2 pairs |
| 13 | 0D | animMayaID | g4 |
| 14 | 0E | Maya frame sounds | g2 count + 8-byte entries |
| 15 | 0F | keyframe range | g2 start + g2 end |
| 17 | 11 | animMayaMasks | g1 count + g1 array |
| 18 | 12 | debug name | gjstr(0) |
| 19 | 13 | cross-world sound | flag |

### Frame ID Format
`frameID = frameIdsLow[i] + (frameIdsHigh[i] << 16)`
- High 16 bits = frames archive index
- Low 16 bits = frame index within that file

### TD Animation Trace (VERIFIED)
- **TD readyanim (seq 11391)**: 32 frames, IDs start at 269680640+
- **TD walkanim (seq 11390)**: 32 frames, IDs start at 269352960+
- Each frame ID → anim file (has base ID in 2-byte trailer)

### Existing Demon Animations (for comparison)
| Seq | Name | Frames | Frame IDs |
|-----|------|--------|-----------|
| 63 | demon_walk | 20 | 79167755+ |
| 64 | demon_attack | 18 | 79167509+ |
| 65 | demon_block | 20 | 79167592+ |
| 66 | demon_ready | 11 | 79167722+ |
| 67 | demon_death | 37 | 79167561+ |

---

## 10. TD Combat Mechanics (from OSRS Wiki)

### Prayer Switching
- Every **150 HP lost** (25% of 600 max HP), switches protection prayer
- Switches to the **last combat style** used by the player
- Stops attacking for **6 ticks (3.6s)** during the switch

### Fire Shield
- Reduces non-demonbane/abyssal damage by **20%**
- Drops after **first attack** AND after each **fire bomb attack**
- Shield down = bonus damage window (damage formula: X²−16)
- Drops with animation (flames descend and blow away)
- Shield remains down until the demon is attacked once

### Fire Bombs
- Every **60 ticks (36s / 10 attacks)**
- Binds player in place, disables run
- Releases **2 fire bombs**: one on player's tile, one 3×3 AoE
- Player has **2 ticks (1.2s)** to move to a safe tile
- **40+ damage** if hit
- Fire bombs still damage even if demon is killed mid-air

### Defencelessness
- **30 ticks (18s)** after fight start
- **100% player accuracy** (flames on demon's back extinguished)
- Lasts until player's **first hit after the fire bomb attack**
- Encourages damage-boosting gear during this window

### Attack Styles
- Uses **all 3 combat styles** (melee, ranged, magic)
- Switches based on player's protection prayer
- Unlike demonic gorillas, stays on one style for **150 HP** (not 70)

### Implementation Strategy
These mechanics can be **invented from scratch** rather than extracted from the cache:
1. **Combat script**: Write a runescript `.rs2` file with the prayer switching logic
2. **Fire shield**: Implement as a damage reduction modifier + visual particle effect
3. **Fire bombs**: Implement as AoE projectile + tile markers
4. **Defencelessness**: Implement as an accuracy modifier timer
5. **Particle system**: Can be coded from scratch — the fire shield visual is a flame effect
