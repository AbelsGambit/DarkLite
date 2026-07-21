import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const LOSTCITY = "/home/z/my-project/lostcity";
const WORKLOG = "/home/z/my-project/worklog.md";

type StageInfo = {
  id: string;
  name: string;
  description: string;
  status: "done" | "in-progress" | "pending";
  files: { path: string; lines: number }[];
  totalLines: number;
};

type PilotResult = {
  name: string;
  npcName: string;
  assertionsPassed: number;
  assertionsTotal: number;
  nodesTraced: number;
  filesWritten: number;
  packEntriesAdded: number;
  variantsRegistered: number;
  notes: string;
};

type VariantEntry = {
  legacyNpcId: number;
  osrsNpcId: number;
  osrsDebugname: string;
  legacyDebugname: string;
  depMapPath: string;
  importedAt: string;
};

type DepsSummary = {
  path: string;
  rootName: string;
  nodeCount: number;
  missingCount: number;
  cycleCount: number;
  nodeKinds: Record<string, number>;
};

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function countLines(p: string): number {
  const content = safeRead(p);
  if (!content) return 0;
  return content.split("\n").length;
}

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

function filesToInfo(paths: string[]): { path: string; lines: number }[] {
  return paths.map((p) => ({
    path: p.replace(LOSTCITY + "/", ""),
    lines: countLines(p),
  }));
}

function sumLines(infos: { lines: number }[]): number {
  return infos.reduce((a, b) => a + b.lines, 0);
}

function parseWorklogTaskIds(worklog: string): string[] {
  const ids = new Set<string>();
  for (const line of worklog.split("\n")) {
    // Matches `## Task 5-a — Port...` (the actual format the subagents used).
    // Skip the literal "## Task ID map" header (would falsely match "ID").
    const m = line.match(/^##\s+Task\s+([0-9]+(?:-[a-z])?)/);
    if (m) ids.add(m[1]);
  }
  return Array.from(ids).sort((a, b) => {
    const na = parseInt(a);
    const nb = parseInt(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

function parsePilotResults(worklog: string): PilotResult[] {
  // The worklog format puts the assertion count on a line BEFORE the
  // "PILOT PASS" summary line, e.g.:
  //   Total assertions: 75 passed, 0 failed
  //   PILOT PASS — Tormented Demon imported: 11 nodes traced, ...
  // We buffer the most recent assertion count and attach it to the next
  // PILOT PASS entry we see.
  const collected: PilotResult[] = [];
  let pendingPass = 0;
  let pendingTotal = 0;
  const lines = worklog.split("\n");
  for (const line of lines) {
    const a = line.match(/Total assertions:\s+(\d+)\s+passed,\s+(\d+)\s+failed/);
    if (a) {
      pendingPass = parseInt(a[1]);
      pendingTotal = parseInt(a[1]) + parseInt(a[2]);
      continue;
    }
    const m = line.match(/PILOT PASS\s+[—-]\s+(.+?)\s+imported:\s+(\d+)\s+nodes?\s+traced,\s+(\d+)\s+files?\s+written,\s+(\d+)\s+pack\s+entries?\s+added,\s+(\d+)\s+variants?\s+registered/);
    if (m) {
      const npcLabel = m[1].trim();
      const isKQ = npcLabel.toLowerCase().includes("kalphite");
      collected.push({
        name: isKQ ? "Kalphite Queen (2 forms)" : "Tormented Demon",
        npcName: npcLabel,
        assertionsPassed: pendingPass,
        assertionsTotal: pendingTotal,
        nodesTraced: parseInt(m[2]),
        filesWritten: parseInt(m[3]),
        packEntriesAdded: parseInt(m[4]),
        variantsRegistered: parseInt(m[5]),
        notes: isKQ
          ? "Form-swap linkage preserved; cross-form anim dedup verified."
          : "Missing fire_shield obj correctly detected via script→obj edge.",
      });
      pendingPass = 0;
      pendingTotal = 0;
    }
  }
  // Dedupe by `name`, keeping the entry with the highest assertion count
  const byName = new Map<string, PilotResult>();
  for (const r of collected) {
    const existing = byName.get(r.name);
    if (!existing || r.assertionsTotal > existing.assertionsTotal) {
      byName.set(r.name, r);
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function loadVariants(): { variants: VariantEntry[]; linkages: [number, number][] } {
  const p = path.join(LOSTCITY, "content/deps/variants.json");
  const raw = safeRead(p);
  if (!raw) return { variants: [], linkages: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      variants: parsed.variants || [],
      linkages: parsed.linkages || [],
    };
  } catch {
    return { variants: [], linkages: [] };
  }
}

function loadDepsSummaries(): DepsSummary[] {
  const dir = path.join(LOSTCITY, "content/deps");
  if (!fs.existsSync(dir)) return [];
  const out: DepsSummary[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".deps.json")) continue;
    const full = path.join(dir, entry);
    const raw = safeRead(full);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const nodes = parsed.nodes || {};
      const nodeKinds: Record<string, number> = {};
      for (const key of Object.keys(nodes)) {
        const kind = key.split(":")[0];
        nodeKinds[kind] = (nodeKinds[kind] || 0) + 1;
      }
      out.push({
        path: `content/deps/${entry}`,
        rootName: parsed.root?.name || "(unnamed)",
        nodeCount: Object.keys(nodes).length,
        missingCount: (parsed.missing || []).length,
        cycleCount: (parsed.cycles || []).length,
        nodeKinds,
      });
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) => a.rootName.localeCompare(b.rootName));
}

export async function GET() {
  const worklog = safeRead(WORKLOG) || "";
  const taskIds = parseWorklogTaskIds(worklog);

  const allOsrsSrc = listTsFiles(path.join(LOSTCITY, "engine/src/cache/osrs"));
  const allToolsOsrs = listTsFiles(path.join(LOSTCITY, "engine/tools/osrs"));
  const variantSrc = listTsFiles(path.join(LOSTCITY, "engine/src/engine/variant"));

  const decoderFiles = allOsrsSrc.filter((p) => !p.includes("OsrsCache") && !p.includes("LegacyCacheWriter"));
  const cacheFiles = allOsrsSrc.filter((p) => p.includes("OsrsCache") || p.includes("LegacyCacheWriter"));
  const tracerFiles = allToolsOsrs.filter((p) =>
    p.includes("DepsSchema") || p.includes("DependencyTracer") || p.endsWith("Trace.ts") || p.includes("SelfTest.ts")
  );
  const writerFiles = allToolsOsrs.filter((p) =>
    p.includes("ContentFolderWriter") || p.includes("Import.ts") || p.includes("ImportResult") ||
    p.includes("NameResolver") || p.includes("SelfTestImport") || p.includes("UpdateVariantsIndex")
  );
  const pilotFiles = allToolsOsrs.filter((p) => p.includes("Pilot") || p.includes("fixtures/"));

  const stages: StageInfo[] = [
    {
      id: "1-decode",
      name: "Decode",
      description:
        "Ported RuneLite's ModelDefinition, AnimFrame, SeqType, and NpcType decoders from Java to TypeScript. Each decoder handles both OSRS and 377 formats and exposes a toLegacy377() transform.",
      status: "done",
      files: filesToInfo(decoderFiles),
      totalLines: 0,
    },
    {
      id: "2-trace",
      name: "Trace",
      description:
        "Dependency tracer walks the full reference graph (NPC → models → anims → seqs → bases → scripts → items → particles). Cycle detection + missing-dep recording. Output: deps.json map.",
      status: "done",
      files: filesToInfo(tracerFiles),
      totalLines: 0,
    },
    {
      id: "3-pack",
      name: "Pack (OSRS cache reader)",
      description:
        "Ported OpenRS2's JS5 container + store reader. Reads main_file_cache.dat2 + idx files, decompresses BZIP2/GZIP containers, splits multi-child archives. Implements the CacheReader interface for the tracer.",
      status: "done",
      files: filesToInfo(cacheFiles),
      totalLines: 0,
    },
    {
      id: "4-write",
      name: "Write (content folder + pack lists)",
      description:
        "ContentFolderWriter walks the deps map, transforms each OSRS asset to 377-compatible bytes, writes to the LostCity content folder, and auto-registers pack-list entries. Idempotent — never overwrites existing content.",
      status: "done",
      files: filesToInfo(writerFiles),
      totalLines: 0,
    },
    {
      id: "5-register",
      name: "Register (modular variant registry)",
      description:
        "Per-player variant storage with 4-step resolution precedence (per-NPC override → per-region → era preset → server default). Default is legacy377 so existing behavior is unchanged. Form-swap linkages (KQ) move as a unit.",
      status: "done",
      files: filesToInfo(variantSrc),
      totalLines: 0,
    },
    {
      id: "6-pilot",
      name: "Pilot runs",
      description:
        "End-to-end verification: Tormented Demon (new NPC, missing-dep detection) + Kalphite Queen (two forms, form-swap linkage preservation). Both use synthesized OSRS fixtures; real-cache runner ships ready for when the user drops the OSRS cache in.",
      status: "done",
      files: filesToInfo(pilotFiles),
      totalLines: 0,
    },
  ];
  for (const s of stages) s.totalLines = sumLines(s.files);

  const pilotsParsed = parsePilotResults(worklog);
  const { variants, linkages } = loadVariants();
  const depsSummaries = loadDepsSummaries();

  const totalLines = stages.reduce((a, s) => a + s.totalLines, 0);
  const totalFiles = stages.reduce((a, s) => a + s.files.length, 0);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    taskIds,
    stages,
    pilots: pilotsParsed,
    variants,
    linkages,
    depsSummaries,
    summary: {
      totalStages: stages.length,
      completedStages: stages.filter((s) => s.status === "done").length,
      totalFiles,
      totalLines,
      totalVariants: variants.length,
      totalLinkages: linkages.length,
      totalDepsMaps: depsSummaries.length,
      totalNodesTraced: depsSummaries.reduce((a, d) => a + d.nodeCount, 0),
      totalMissingDeps: depsSummaries.reduce((a, d) => a + d.missingCount, 0),
    },
    nextSteps: [
      {
        title: "Drop OSRS cache into engine/data/osrs-cache/",
        detail:
          "User supplies the OSRS cache bytes (main_file_cache.dat2 + idx files). The real-cache runner (engine/tools/osrs/Import.ts --osrs-cache=data/osrs-cache --npc=<id>) will then run the full pipeline against real TD + KQ bytes.",
        priority: "blocking",
      },
      {
        title: "Run LostCity build",
        detail:
          "After import, run `bun run build` in the engine dir to pack the new content into the 377 cache that gets served to the Java client.",
        priority: "high",
      },
      {
        title: "Start-screen configuration UI",
        detail:
          "The variant registry + DB layer (Task 9) are ready. Next: build the start-screen UI that lets players pick era preset (05/07/allOSRS/mixed) and per-NPC overrides. This page is the foundation for that UI.",
        priority: "medium",
      },
      {
        title: "Migrate NPC spawn sites to call resolveNpcConfigForPlayer()",
        detail:
          "Currently opt-in: the helper exists, but spawn sites still call NpcType.get(id) directly. Migrate them one at a time (non-breaking).",
        priority: "medium",
      },
      {
        title: "Port OsrsObjType, OsrsParamType, OsrsStructType deep walkers",
        detail:
          "Items (like the TD's fire shield) and their particle system dependencies are currently stubbed as 'missing' in the dep map. Deep-walking them requires porting the OSRS obj/param/struct decoders.",
        priority: "low",
      },
    ],
  });
}
