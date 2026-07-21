import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  DEMO_VARIANTS,
  DEMO_LINKAGES,
  DEMO_LEGACY_ONLY_NPCS,
  ERA_PRESETS,
  type DemoVariantEntry,
} from "@/lib/demo-data";

const LOSTCITY = "/home/z/my-project/lostcity";

type RealVariantEntry = {
  legacyNpcId: number;
  osrsNpcId: number;
  osrsDebugname: string;
  legacyDebugname?: string;
  depMapPath?: string;
  importedAt?: string;
  osrsSourceNpcId?: number;
};

type UnifiedVariant = DemoVariantEntry & {
  isDemo: boolean;
  hasOsrsVariant: boolean;
  hasLegacyVariant: boolean;
};

function loadRealVariants(): { variants: RealVariantEntry[]; linkages: [number, number][] } {
  const p = path.join(LOSTCITY, "content/deps/variants.json");
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      variants: parsed.variants || [],
      linkages: parsed.linkages || [],
    };
  } catch {
    return { variants: [], linkages: [] };
  }
}

export async function GET() {
  const real = loadRealVariants();

  // Merge real + demo variants. Real entries take precedence (same osrsNpcId).
  const demoById = new Map<number, DemoVariantEntry>();
  for (const d of DEMO_VARIANTS) demoById.set(d.osrsNpcId, d);

  const realIds = new Set(real.variants.map((v) => v.osrsNpcId));
  const merged: UnifiedVariant[] = [];

  // Real variants first (augmented with demo metadata if available)
  for (const v of real.variants) {
    const demo = demoById.get(v.osrsNpcId);
    merged.push({
      ...(demo || {
        legacyNpcId: v.legacyNpcId,
        osrsNpcId: v.osrsNpcId,
        osrsDebugname: v.osrsDebugname,
        legacyDebugname: v.legacyDebugname || "",
        depMapPath: v.depMapPath || "",
        importedAt: v.importedAt || new Date().toISOString(),
        demo: true as const,
        osrsSourceNpcId: v.osrsSourceNpcId || v.osrsNpcId,
        displayName: v.osrsDebugname.replace(/^osrs_/, "").replace(/_/g, " "),
        category: "upgrade" as const,
        yearAdded: 2006,
      }),
      isDemo: false,
      hasOsrsVariant: true,
      hasLegacyVariant: v.legacyNpcId !== -1,
    });
  }

  // Then demo variants that aren't superseded by real ones
  for (const d of DEMO_VARIANTS) {
    if (realIds.has(d.osrsNpcId)) continue;
    merged.push({
      ...d,
      isDemo: true,
      hasOsrsVariant: true,
      hasLegacyVariant: d.legacyNpcId !== -1,
    });
  }

  // Merge linkages (real + demo)
  const linkages = [...real.linkages, ...DEMO_LINKAGES];

  // Legacy-only NPCs (for the advanced-mode list — NPCs with no OSRS variant)
  const legacyOnly = DEMO_LEGACY_ONLY_NPCS;

  // Group variants by region for the UI
  const byRegion = new Map<string, UnifiedVariant[]>();
  for (const v of merged) {
    const region = v.region || "Unknown";
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push(v);
  }

  // Compute linkage groups (transitive closure)
  const linkageGroups: number[][] = [];
  const visited = new Set<number>();
  for (const [a, b] of linkages) {
    if (visited.has(a) && visited.has(b)) continue;
    const group = new Set<number>();
    const queue = [a, b];
    while (queue.length > 0) {
      const n = queue.shift()!;
      if (group.has(n)) continue;
      group.add(n);
      visited.add(n);
      for (const [x, y] of linkages) {
        if (x === n && !group.has(y)) queue.push(y);
        if (y === n && !group.has(x)) queue.push(x);
      }
    }
    linkageGroups.push(Array.from(group).sort());
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    eraPresets: ERA_PRESETS,
    variants: merged,
    legacyOnlyNpcs: legacyOnly,
    linkages,
    linkageGroups,
    byRegion: Array.from(byRegion.entries()).map(([region, variants]) => ({
      region,
      variants: variants.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    })),
    summary: {
      totalVariants: merged.length,
      totalLinkages: linkages.length,
      totalLegacyOnly: legacyOnly.length,
      demoCount: merged.filter((v) => v.isDemo).length,
      realCount: merged.filter((v) => !v.isDemo).length,
      newCount: merged.filter((v) => v.category === "new").length,
      upgradeCount: merged.filter((v) => v.category === "upgrade").length,
      bossCount: merged.filter((v) => v.category === "boss").length,
      regionCount: byRegion.size,
    },
  });
}
