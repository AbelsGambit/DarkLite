/**
 * Demo seed data for the variant registry.
 *
 * The real variants.json is populated by `engine/tools/osrs/Import.ts` +
 * `engine/tools/osrs/UpdateVariantsIndex.ts` when the user runs the pipeline
 * against a real OSRS cache. Since the user hasn't dropped a cache in yet,
 * this seed provides realistic demo entries so the configuration UI is
 * fully demoable.
 *
 * All entries are clearly marked with `demo: true` so they can be distinguished
 * from real imports and easily cleared.
 *
 * The entries mirror the two pilot NPCs (Tormented Demon + Kalphite Queen)
 * plus a handful of common NPCs that would realistically get OSRS upgrades.
 */

export type DemoVariantEntry = {
  legacyNpcId: number;
  osrsNpcId: number;
  osrsDebugname: string;
  legacyDebugname: string;
  depMapPath: string;
  importedAt: string;
  demo: true;
  osrsSourceNpcId: number;
  displayName: string;
  category: "new" | "upgrade" | "boss";
  yearAdded: number;
  region?: string;
};

export const DEMO_VARIANTS: DemoVariantEntry[] = [
  {
    legacyNpcId: -1,
    osrsNpcId: 9001,
    osrsDebugname: "osrs_tormented_demon",
    legacyDebugname: "",
    depMapPath: "content/deps/osrs_tormented_demon.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9501,
    displayName: "Tormented Demon",
    category: "new",
    yearAdded: 2024,
    region: "Ancient Guthixian Temple",
  },
  {
    legacyNpcId: 1158,
    osrsNpcId: 9002,
    osrsDebugname: "osrs_kalphite_queen",
    legacyDebugname: "kalphite_queen",
    depMapPath: "content/deps/osrs_kalphite_queen.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9502,
    displayName: "Kalphite Queen (form 1)",
    category: "boss",
    yearAdded: 2006,
    region: "Kalphite Lair",
  },
  {
    legacyNpcId: 1159,
    osrsNpcId: 9003,
    osrsDebugname: "osrs_kalphite_queen_2",
    legacyDebugname: "kalphite_queen_2",
    depMapPath: "content/deps/osrs_kalphite_queen_2.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9503,
    displayName: "Kalphite Queen (form 2)",
    category: "boss",
    yearAdded: 2006,
    region: "Kalphite Lair",
  },
  {
    legacyNpcId: 110,
    osrsNpcId: 9004,
    osrsDebugname: "osrs_giant_mole",
    legacyDebugname: "giant_mole",
    depMapPath: "content/deps/osrs_giant_mole.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9504,
    displayName: "Giant Mole",
    category: "boss",
    yearAdded: 2006,
    region: "Falador Mole Lair",
  },
  {
    legacyNpcId: 82,
    osrsNpcId: 9005,
    osrsDebugname: "osrs_lesser_demon",
    legacyDebugname: "lesser_demon",
    depMapPath: "content/deps/osrs_lesser_demon.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9505,
    displayName: "Lesser Demon",
    category: "upgrade",
    yearAdded: 2001,
    region: "Karamja Volcano",
  },
  {
    legacyNpcId: 83,
    osrsNpcId: 9006,
    osrsDebugname: "osrs_greater_demon",
    legacyDebugname: "greater_demon",
    depMapPath: "content/deps/osrs_greater_demon.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9506,
    displayName: "Greater Demon",
    category: "upgrade",
    yearAdded: 2001,
    region: "Wilderness / demonic ruins",
  },
  {
    legacyNpcId: 54,
    osrsNpcId: 9007,
    osrsDebugname: "osrs_black_dragon",
    legacyDebugname: "black_dragon",
    depMapPath: "content/deps/osrs_black_dragon.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9507,
    displayName: "Black Dragon",
    category: "upgrade",
    yearAdded: 2001,
    region: "Taverley Dungeon",
  },
  {
    legacyNpcId: 1,
    osrsNpcId: 9008,
    osrsDebugname: "osrs_man",
    legacyDebugname: "man",
    depMapPath: "content/deps/osrs_man.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9508,
    displayName: "Man",
    category: "upgrade",
    yearAdded: 2001,
    region: "Lumbridge",
  },
  {
    legacyNpcId: 941,
    osrsNpcId: 9009,
    osrsDebugname: "osrs_green_dragon",
    legacyDebugname: "green_dragon",
    depMapPath: "content/deps/osrs_green_dragon.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9509,
    displayName: "Green Dragon",
    category: "upgrade",
    yearAdded: 2001,
    region: "Wilderness",
  },
  {
    legacyNpcId: 117,
    osrsNpcId: 9010,
    osrsDebugname: "osrs_hill_giant",
    legacyDebugname: "hill_giant",
    depMapPath: "content/deps/osrs_hill_giant.deps.json",
    importedAt: "2025-11-04T00:00:00Z",
    demo: true,
    osrsSourceNpcId: 9510,
    displayName: "Hill Giant",
    category: "upgrade",
    yearAdded: 2001,
    region: "Edgeville Dungeon",
  },
];

export const DEMO_LINKAGES: [number, number][] = [
  [9002, 9003], // KQ form 1 ↔ form 2
];

/**
 * NPCs that exist in the legacy 377 cache but have NO OSRS variant imported.
 * These show up in the advanced mode list as "legacy only" (greyed out,
 * not toggleable). Useful for demonstrating the search/filter UX.
 */
export const DEMO_LEGACY_ONLY_NPCS: {
  legacyNpcId: number;
  legacyDebugname: string;
  displayName: string;
  region: string;
}[] = [
  { legacyNpcId: 0, legacyDebugname: "hans", displayName: "Hans", region: "Lumbridge Castle" },
  { legacyNpcId: 9, legacyDebugname: "guard1", displayName: "Guard", region: "Varrock" },
  { legacyNpcId: 10, legacyDebugname: "guard2", displayName: "Guard", region: "Varrock" },
  { legacyNpcId: 11, legacyDebugname: "tramp", displayName: "Tramp", region: "Varrock" },
  { legacyNpcId: 12, legacyDebugname: "barbarian", displayName: "Barbarian", region: "Barbarian Village" },
  { legacyNpcId: 13, legacyDebugname: "wizard", displayName: "Wizard", region: "Wizard's Tower" },
  { legacyNpcId: 15, legacyDebugname: "warrior_woman", displayName: "Warrior Woman", region: "Al Kharid" },
  { legacyNpcId: 19, legacyDebugname: "white_knight", displayName: "White Knight", region: "Falador" },
  { legacyNpcId: 20, legacyDebugname: "black_knight", displayName: "Black Knight", region: "Black Knights' Fortress" },
  { legacyNpcId: 21, legacyDebugname: "paladin", displayName: "Paladin", region: "Ardougne" },
  { legacyNpcId: 23, legacyDebugname: "hero", displayName: "Hero", region: "Ardougne" },
  { legacyNpcId: 494, legacyDebugname: "banker", displayName: "Banker", region: "Various banks" },
  { legacyNpcId: 519, legacyDebugname: "shopkeeper", displayName: "Shopkeeper", region: "Various shops" },
  { legacyNpcId: 520, legacyDebugname: "shop_assistant", displayName: "Shop Assistant", region: "Various shops" },
  { legacyNpcId: 708, legacyDebugname: "imp", displayName: "Imp", region: "Lumbridge / Varrock" },
  { legacyNpcId: 733, legacyDebugname: "thief", displayName: "Thief", region: "Ardougne" },
  { legacyNpcId: 735, legacyDebugname: "monk", displayName: "Monk", region: "Edgeville Monastery" },
];

/**
 * Era preset definitions — mirrors the LostCity engine's `EraPreset` type
 * at `engine/src/engine/variant/PlayerVariantState.ts`.
 */
export const ERA_PRESETS = [
  {
    id: "05era" as const,
    label: "2005 Era",
    subtitle: "Original 377 models",
    description:
      "The classic 377-era models for everything. This is the default — matches the pre-OSRS-pipeline behavior. NPCs with no legacy equivalent (like the Tormented Demon) still use their OSRS model.",
    accent: "amber",
    badge: "DEFAULT",
    yearRange: "2005",
  },
  {
    id: "07era" as const,
    label: "2007 Era",
    subtitle: "Pre-HD update models",
    description:
      "377-era models for content added before 2007, OSRS models for content added in 2007 or later. The cutoff moves as more OSRS imports land.",
    accent: "rose",
    badge: "TRANSITIONAL",
    yearRange: "2005–2007",
  },
  {
    id: "allOSRS" as const,
    label: "All OSRS",
    subtitle: "Modern models everywhere",
    description:
      "Use the OSRS variant for every NPC that has one registered. Falls back to legacy for the rest. Great for seeing the upgraded art style across the whole game.",
    accent: "emerald",
    badge: "MODERN",
    yearRange: "2024+",
  },
  {
    id: "mixed" as const,
    label: "Mixed / Advanced",
    subtitle: "Per-NPC control",
    description:
      "Start from the 05-era baseline and apply per-NPC overrides. This unlocks the advanced mode where you can toggle individual NPCs between legacy and OSRS.",
    accent: "teal",
    badge: "CUSTOM",
    yearRange: "your choice",
  },
];
