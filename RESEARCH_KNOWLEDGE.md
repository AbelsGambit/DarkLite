
---

## 11. OSRS seq.dat Format — CORRECTED (verified by byte analysis)

### Key Difference from 377
- **Op 1 (frame group)**: uses **g2 count** (not g1 like 377)
- Everything else is the same as 377

### Format (verified against real cache bytes)
```
Op 1: g2 count N, then N × (g2 frameID, g2 iframeID, g2 delay)
Op 2: g2 (loops)
Op 3: g1 count + g1 array (walkmerge)
Op 4: flag (stretches)
Op 5: g1 (priority)
Op 6: g2 (lefthand item)
Op 7: g2 (righthand item)
Op 8: g1 (maxloops)
Op 9: g1 (preanim_move)
Op 10: g1 (postanim_move)
Op 11: g1 (duplicatebehavior)
Op 250: gjstr (debugname)
Op 0: terminator
```

### TD Animation Frame IDs (decoded)
- **readyanim (seq 11391)**: 32 frames, priority=4
  - Frame IDs: [3, 4, 4, 4, 4, 3, 4, 4, 4, 4, 3, 18, 14, 28, 4, 8, 31, 9, 3, 13, 25, 16, ...]
  - These are unique TD animation frames (different from existing demon anims)
- **walkanim (seq 11390)**: 32 frames, priority=5
  - Frame IDs: [3, 3, 2, 3, 3, 3, 2, 3, 3, 3, 3, 18, 21, 27, 5, 12, 4, 6, 28, 9, 0, 1, ...]

### Existing Demon Animations (for comparison)
| Seq | Name | Frames | First IDs |
|-----|------|--------|-----------|
| 63 | demon_walk | 20 | [4, 4, 4, 4, 4, 4, 8, 278] |
| 64 | demon_attack | 18 | [3, 10, 1, 1, 5, 3, 21, 33] |
| 65 | demon_block | 20 | [3, 3, 3, 3, 3, 3, 3, 107] |
| 66 | demon_ready | 11 | [4, 4, 4, 4, 237, 240, 243, 236] |
| 67 | demon_death | 37 | [10, 2, 5, 5, 5, 5, 5, 5] |

---

## 12. TD Combat Script Implementation

### Script: `content/scripts/npc/scripts/osrs_tormented_demon.rs2`

The combat script implements all 4 TD mechanics using LostCity's runescript:

1. **Prayer Switching** (ai_queue10):
   - Tracks damage since last switch (`%td_damage_since_switch`)
   - At 150+ damage: triggers prayer switch, stops attacking 6 ticks

2. **Fire Shield** (proc `td_fire_shield_check`):
   - 20% damage reduction when shield is up
   - Shield drops after first attack and after fire bombs
   - Shield regenerates when demon is attacked again

3. **Fire Bombs** (ai_queue11):
   - Every 60 ticks (36s): binds player, launches 2 fire bombs
   - 2-tick dodge window (1.2s)
   - 30-50 damage if player doesn't move

4. **Defencelessness** (ai_queue12):
   - 30 ticks after fight start
   - 100% player accuracy (flames extinguished)
   - Lasts until first hit after next fire bomb

### Current State
- TD uses existing demon animations (demon_walk, demon_ready, demon_attack, etc.)
- These are placeholder animations — the TD has unique frames in the OSRS cache
- To import unique TD animations: need to extract OSRS anim files + create new seq configs
- This is a future enhancement (the existing demon anims are visually similar)
