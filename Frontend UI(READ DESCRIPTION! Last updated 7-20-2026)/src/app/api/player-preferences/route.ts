import { NextResponse } from "next/server";
import {
  getPlayerPreference,
  putPlayerPreferenceWithHistory,
  listPlayers,
  getHistory,
  undoLast,
  resolveNpcVariant,
  getRecentDepMaps,
  addRecentDepMap,
  toggleFavorite,
  type EraPreset,
  type NpcVariant,
} from "@/lib/player-preferences";
import { DEMO_VARIANTS, DEMO_LEGACY_ONLY_NPCS } from "@/lib/demo-data";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playerIdParam = url.searchParams.get("playerId");
  const action = url.searchParams.get("action");

  // GET ?action=list returns all known players (for the player switcher)
  if (action === "list") {
    const players = listPlayers();
    // Always include player 1 even if no preferences set yet
    const ids = new Set<number>([1, ...players.map((p) => p.playerId)]);
    // Add demo players 2 and 3 for the switcher
    ids.add(2);
    ids.add(3);
    const out = Array.from(ids)
      .sort((a, b) => a - b)
      .map((id) => {
        const p = players.find((x) => x.playerId === id);
        return {
          playerId: id,
          eraPreset: p?.eraPreset ?? "05era",
          totalOverrides: p ? Object.keys(p.npcOverrides).length : 0,
          favoritesCount: p?.favorites?.length ?? 0,
          updatedAt: p?.updatedAt ?? null,
        };
      });
    return NextResponse.json({ players: out });
  }

  // GET ?action=history&playerId=N returns the edit history for a player
  if (action === "history") {
    const playerId = playerIdParam ? parseInt(playerIdParam) : 1;
    const history = getHistory(playerId);
    return NextResponse.json({ playerId, history });
  }

  // GET ?action=recent-dep-maps returns the shared recently-viewed list
  if (action === "recent-dep-maps") {
    return NextResponse.json({ recent: getRecentDepMaps() });
  }

  const playerId = playerIdParam ? parseInt(playerIdParam) : 1;
  const pref = getPlayerPreference(playerId);

  // Compute resolved variant for every NPC (for the UI preview)
  const resolutions: {
    legacyNpcId: number;
    osrsNpcId: number | null;
    displayName: string;
    resolved: NpcVariant;
    source: "override" | "era-preset" | "default";
  }[] = [];

  for (const v of DEMO_VARIANTS) {
    const override = pref.npcOverrides[String(v.legacyNpcId)] as NpcVariant | undefined;
    const resolved = resolveNpcVariant(pref, v.legacyNpcId, v.osrsNpcId, true);
    resolutions.push({
      legacyNpcId: v.legacyNpcId,
      osrsNpcId: v.osrsNpcId,
      displayName: v.displayName,
      resolved,
      source: override ? "override" : pref.eraPreset === "allOSRS" ? "era-preset" : "default",
    });
  }

  return NextResponse.json({
    playerId: pref.playerId,
    eraPreset: pref.eraPreset,
    npcOverrides: pref.npcOverrides,
    regionOverrides: pref.regionOverrides,
    favorites: pref.favorites ?? [],
    updatedAt: pref.updatedAt,
    resolutions,
    summary: {
      totalOverrides: Object.keys(pref.npcOverrides).length,
      osrsResolved: resolutions.filter((r) => r.resolved === "osrs").length,
      legacyResolved: resolutions.filter((r) => r.resolved === "legacy377").length,
    },
  });
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const playerIdParam = url.searchParams.get("playerId");
  const playerId = playerIdParam ? parseInt(playerIdParam) : 1;

  let body: {
    eraPreset?: EraPreset;
    npcOverrides?: Record<string, NpcVariant>;
    regionOverrides?: Record<string, NpcVariant>;
    action?: "setEra" | "setNpcOverride" | "clearNpcOverride" | "clearAll" | "replace" | "setRegionOverride" | "clearRegionOverride" | "undo" | "toggleFavorite" | "addRecentDepMap" | "bulkSetNpcOverride" | "bulkClearNpcOverride";
    npcId?: number;
    regionId?: number;
    variant?: NpcVariant;
    npcIds?: number[];
    debugname?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const current = getPlayerPreference(playerId);

  // Non-preference actions (favorites + recent dep maps) — handle before the switch
  // since they don't follow the same before/after history pattern.
  if (body.action === "toggleFavorite") {
    if (body.npcId === undefined) {
      return NextResponse.json({ error: "npcId required for toggleFavorite action" }, { status: 400 });
    }
    const updated = toggleFavorite(playerId, body.npcId);
    return NextResponse.json(updated);
  }
  if (body.action === "addRecentDepMap") {
    if (!body.debugname) {
      return NextResponse.json({ error: "debugname required for addRecentDepMap action" }, { status: 400 });
    }
    const recent = addRecentDepMap(body.debugname);
    return NextResponse.json({ recent });
  }

  switch (body.action) {
    case "setEra": {
      if (!body.eraPreset) {
        return NextResponse.json({ error: "eraPreset required for setEra action" }, { status: 400 });
      }
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        { eraPreset: body.eraPreset },
        current,
        "setEra",
        `Era preset changed to ${body.eraPreset}`
      );
      return NextResponse.json(updated);
    }
    case "setNpcOverride": {
      if (body.npcId === undefined || !body.variant) {
        return NextResponse.json(
          { error: "npcId + variant required for setNpcOverride action" },
          { status: 400 }
        );
      }
      const newOverrides = { ...current.npcOverrides, [String(body.npcId)]: body.variant };
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        { npcOverrides: newOverrides },
        current,
        "setNpcOverride",
        `NPC ${body.npcId} override set to ${body.variant}`
      );
      return NextResponse.json(updated);
    }
    case "clearNpcOverride": {
      if (body.npcId === undefined) {
        return NextResponse.json({ error: "npcId required for clearNpcOverride action" }, { status: 400 });
      }
      const newOverrides = { ...current.npcOverrides };
      delete newOverrides[String(body.npcId)];
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        { npcOverrides: newOverrides },
        current,
        "clearNpcOverride",
        `NPC ${body.npcId} override cleared`
      );
      return NextResponse.json(updated);
    }
    case "setRegionOverride": {
      if (body.regionId === undefined || !body.variant) {
        return NextResponse.json(
          { error: "regionId + variant required for setRegionOverride action" },
          { status: 400 }
        );
      }
      const newRegionOverrides = { ...current.regionOverrides, [String(body.regionId)]: body.variant };
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        { regionOverrides: newRegionOverrides },
        current,
        "setRegionOverride",
        `Region ${body.regionId} override set to ${body.variant}`
      );
      return NextResponse.json(updated);
    }
    case "clearRegionOverride": {
      if (body.regionId === undefined) {
        return NextResponse.json({ error: "regionId required for clearRegionOverride action" }, { status: 400 });
      }
      const newRegionOverrides = { ...current.regionOverrides };
      delete newRegionOverrides[String(body.regionId)];
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        { regionOverrides: newRegionOverrides },
        current,
        "clearRegionOverride",
        `Region ${body.regionId} override cleared`
      );
      return NextResponse.json(updated);
    }
    case "clearAll": {
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        { eraPreset: "05era", npcOverrides: {}, regionOverrides: {} },
        current,
        "clearAll",
        "All preferences reset to defaults"
      );
      return NextResponse.json(updated);
    }
    case "replace": {
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        {
          eraPreset: body.eraPreset ?? current.eraPreset,
          npcOverrides: body.npcOverrides ?? current.npcOverrides,
          regionOverrides: body.regionOverrides ?? current.regionOverrides,
        },
        current,
        "replace",
        "Preferences replaced (import or batch update)"
      );
      return NextResponse.json(updated);
    }
    case "bulkSetNpcOverride": {
      if (!body.npcIds || !Array.isArray(body.npcIds) || body.npcIds.length === 0 || !body.variant) {
        return NextResponse.json(
          { error: "npcIds (non-empty array) + variant required for bulkSetNpcOverride action" },
          { status: 400 }
        );
      }
      const newOverrides = { ...current.npcOverrides };
      for (const id of body.npcIds) {
        newOverrides[String(id)] = body.variant;
      }
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        { npcOverrides: newOverrides },
        current,
        "bulkSetNpcOverride",
        `Bulk set ${body.npcIds.length} NPCs to ${body.variant}`
      );
      return NextResponse.json(updated);
    }
    case "bulkClearNpcOverride": {
      if (!body.npcIds || !Array.isArray(body.npcIds) || body.npcIds.length === 0) {
        return NextResponse.json(
          { error: "npcIds (non-empty array) required for bulkClearNpcOverride action" },
          { status: 400 }
        );
      }
      const newOverrides = { ...current.npcOverrides };
      for (const id of body.npcIds) {
        delete newOverrides[String(id)];
      }
      const updated = putPlayerPreferenceWithHistory(
        playerId,
        { npcOverrides: newOverrides },
        current,
        "bulkClearNpcOverride",
        `Bulk cleared ${body.npcIds.length} NPC overrides`
      );
      return NextResponse.json(updated);
    }
    case "undo": {
      const restored = undoLast(playerId);
      if (!restored) {
        return NextResponse.json({ error: "No history to undo" }, { status: 400 });
      }
      return NextResponse.json(restored);
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
