/**
 * Player preference store — simulates the LostCity engine's
 * `PlayerModelPreference` Prisma table for the dashboard demo.
 *
 * In production, this would be handled by the engine's
 * `VariantPersistence.ts` talking to the real database. Since the
 * dashboard runs as a separate Next.js app (not the engine itself),
 * we use a simple file-based JSON store at
 * `/home/z/my-project/.data/player-preferences.json`.
 *
 * The shape mirrors `engine/src/engine/variant/PlayerVariantState.ts`
 * exactly, so swapping this out for a real API call to the engine is
 * a drop-in replacement.
 *
 * Also maintains an in-memory edit history per player (not persisted)
 * for the undo/redo stack + timeline UI.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = "/home/z/my-project/.data";
const STORE_FILE = path.join(DATA_DIR, "player-preferences.json");

export type EraPreset = "05era" | "07era" | "allOSRS" | "mixed";
export type NpcVariant = "legacy377" | "osrs";

export type PlayerPreference = {
  playerId: number;
  eraPreset: EraPreset;
  npcOverrides: Record<string, NpcVariant>;
  regionOverrides: Record<string, NpcVariant>;
  favorites: number[]; // legacyNpcIds the player pinned to the top
  updatedAt: string;
};

type Store = {
  players: Record<number, PlayerPreference>;
  // Recently-viewed dep maps (shared across all players — it's a browser-level
  // "recently opened" list, not per-player). Stored as debugname strings,
  // most-recent-first, max 8 entries.
  recentDepMaps: string[];
};

// ---------- Edit history (in-memory, not persisted) ----------
export type HistoryEntry = {
  id: string;
  playerId: number;
  timestamp: string;
  action: string;
  description: string;
  before: PlayerPreference;
  after: PlayerPreference;
};

// In-memory edit history per player (most recent first). Not persisted
// across server restarts — that's intentional for the demo. A real
// implementation would store this in a DB table.
const historyByPlayer: Map<number, HistoryEntry[]> = new Map();
const MAX_HISTORY = 50;

function pushHistory(playerId: number, entry: HistoryEntry): void {
  let list = historyByPlayer.get(playerId);
  if (!list) {
    list = [];
    historyByPlayer.set(playerId, list);
  }
  list.unshift(entry);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
}

export function getHistory(playerId: number): HistoryEntry[] {
  return historyByPlayer.get(playerId) ?? [];
}

export function undoLast(playerId: number): PlayerPreference | null {
  const list = historyByPlayer.get(playerId);
  if (!list || list.length === 0) return null;
  const entry = list[0];
  // Restore the "before" state
  const restored = putPlayerPreference(playerId, {
    eraPreset: entry.before.eraPreset,
    npcOverrides: entry.before.npcOverrides,
    regionOverrides: entry.before.regionOverrides,
  });
  // Remove this entry from history (don't record the undo itself)
  list.shift();
  return restored;
}

function ensureStore(): Store {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    const empty: Store = { players: {}, recentDepMaps: [] };
    fs.writeFileSync(STORE_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
    // Migrate old stores that don't have recentDepMaps or favorites
    if (!parsed.recentDepMaps) parsed.recentDepMaps = [];
    if (parsed.players) {
      for (const id of Object.keys(parsed.players)) {
        if (!parsed.players[id].favorites) parsed.players[id].favorites = [];
      }
    }
    return parsed as Store;
  } catch {
    const empty: Store = { players: {}, recentDepMaps: [] };
    fs.writeFileSync(STORE_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
}

function writeStore(store: Store): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

export function getPlayerPreference(playerId: number): PlayerPreference {
  const store = ensureStore();
  const existing = store.players[playerId];
  if (existing) return existing;
  // Default state — matches LostCity's DEFAULT_ERA_PRESET = '05era'
  return {
    playerId,
    eraPreset: "05era",
    npcOverrides: {},
    regionOverrides: {},
    favorites: [],
    updatedAt: new Date().toISOString(),
  };
}

export function putPlayerPreference(
  playerId: number,
  patch: Partial<Pick<PlayerPreference, "eraPreset" | "npcOverrides" | "regionOverrides" | "favorites">>
): PlayerPreference {
  const store = ensureStore();
  const current = store.players[playerId] ?? {
    playerId,
    eraPreset: "05era" as EraPreset,
    npcOverrides: {},
    regionOverrides: {},
    favorites: [] as number[],
    updatedAt: new Date().toISOString(),
  };
  const updated: PlayerPreference = {
    ...current,
    ...patch,
    playerId,
    updatedAt: new Date().toISOString(),
  };
  store.players[playerId] = updated;
  writeStore(store);
  return updated;
}

/**
 * Like putPlayerPreference, but also records an entry in the edit history.
 * Use this for user-initiated changes that should appear in the timeline
 * and be undoable. Use `putPlayerPreference` directly for system-level
 * writes (like undo itself, which restores without recording a new entry).
 */
export function putPlayerPreferenceWithHistory(
  playerId: number,
  patch: Partial<Pick<PlayerPreference, "eraPreset" | "npcOverrides" | "regionOverrides">>,
  before: PlayerPreference,
  action: string,
  description: string
): PlayerPreference {
  const updated = putPlayerPreference(playerId, patch);
  const entry: HistoryEntry = {
    id: `${playerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    playerId,
    timestamp: new Date().toISOString(),
    action,
    description,
    before,
    after: updated,
  };
  pushHistory(playerId, entry);
  return updated;
}

export function listPlayers(): PlayerPreference[] {
  const store = ensureStore();
  return Object.values(store.players).sort((a, b) => a.playerId - b.playerId);
}

/**
 * Resolve which variant a specific NPC would use, given the player's state.
 * Mirrors the 4-step precedence in LostCity's `VariantResolver.ts`:
 *   1. Per-NPC player override
 *   2. Per-region player override (stubbed — always misses)
 *   3. Player era preset
 *   4. Server default ('05era' → 'legacy377')
 *
 * Also consults the variant registry to check availability — if a player
 * picks 'osrs' for an NPC that has no OSRS variant, falls back to 'legacy377'.
 */
export function resolveNpcVariant(
  pref: PlayerPreference,
  legacyNpcId: number,
  osrsNpcId: number | null,
  hasOsrsVariant: boolean
): NpcVariant {
  // Step 1: per-NPC override
  const override = pref.npcOverrides[String(legacyNpcId)];
  if (override) {
    // If the override is 'osrs' but no OSRS variant exists, fall back
    if (override === "osrs" && !hasOsrsVariant) return "legacy377";
    return override;
  }

  // Step 2: per-region override — stubbed (no region context here)

  // Step 3: era preset
  switch (pref.eraPreset) {
    case "allOSRS":
      return hasOsrsVariant ? "osrs" : "legacy377";
    case "07era":
      // For the demo: 07era behaves like allOSRS for content added in 2007+
      // The real engine checks a per-NPC "yearAdded" field; we simulate it
      // by treating all demo variants as 2007-era content.
      return hasOsrsVariant ? "osrs" : "legacy377";
    case "05era":
    case "mixed":
    default:
      // NPCs with no legacy twin (legacyNpcId === -1) MUST use OSRS
      if (legacyNpcId === -1 && osrsNpcId !== null) return "osrs";
      return "legacy377";
  }
}

// ---------- Recently-viewed dep maps (shared across players) ----------

export function getRecentDepMaps(): string[] {
  const store = ensureStore();
  return store.recentDepMaps ?? [];
}

export function addRecentDepMap(debugname: string): string[] {
  const store = ensureStore();
  const list = store.recentDepMaps ?? [];
  // Remove if already present, then prepend
  const filtered = list.filter((n) => n !== debugname);
  filtered.unshift(debugname);
  // Cap at 8
  if (filtered.length > 8) filtered.length = 8;
  store.recentDepMaps = filtered;
  writeStore(store);
  return filtered;
}

// ---------- Favorites (per-player, persisted) ----------

export function toggleFavorite(playerId: number, legacyNpcId: number): PlayerPreference {
  const current = getPlayerPreference(playerId);
  const favorites = current.favorites ?? [];
  const idx = favorites.indexOf(legacyNpcId);
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push(legacyNpcId);
  }
  return putPlayerPreference(playerId, { favorites });
}

