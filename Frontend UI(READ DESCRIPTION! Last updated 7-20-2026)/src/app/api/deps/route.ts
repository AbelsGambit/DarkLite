import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const LOSTCITY = "/home/z/my-project/lostcity";

type DepNode = {
  kind: string;
  id: number | string;
  name: string | null;
  source: string;
  transformedFrom: number | string | null;
  cycle?: boolean;
  missing?: boolean;
  deps: { kind: string; id: number | string; via?: string; missing?: boolean }[];
};

type DepsMap = {
  version: number;
  root: { kind: string; id: number | string; name: string | null };
  nodes: Record<string, DepNode>;
  cycles: { path: string[]; reentry: string }[];
  missing: { kind: string; id: number | string }[];
};

/**
 * Synthesize a realistic dep map for demo purposes (when the real
 * deps.json file doesn't exist yet). This mirrors the shape produced
 * by the TD pilot (Task 10) — 11 nodes, 3 missing deps.
 */
function synthesizeDemoDepMap(debugname: string): DepsMap | null {
  const knownDemos: Record<string, DepsMap> = {
    osrs_tormented_demon: {
      version: 1,
      root: { kind: "npc", id: 9001, name: "osrs_tormented_demon" },
      nodes: {
        "npc:9001": {
          kind: "npc",
          id: 9001,
          name: "osrs_tormented_demon",
          source: "osrs",
          transformedFrom: null,
          deps: [
            { kind: "model", id: 46001, via: "models[0]" },
            { kind: "model", id: 46002, via: "models[1]" },
            { kind: "seq", id: 9501, via: "readyanim" },
            { kind: "seq", id: 9502, via: "walkanim" },
            { kind: "param", id: 1234, via: "param:attack_anim" },
            { kind: "param", id: 1235, via: "param:death_anim" },
            { kind: "script", id: "tormented_demon", via: "combat-script" },
          ],
        },
        "model:46001": {
          kind: "model",
          id: 46001,
          name: "osrs_model_46001",
          source: "osrs",
          transformedFrom: 46001,
          deps: [],
        },
        "model:46002": {
          kind: "model",
          id: 46002,
          name: "osrs_model_46002",
          source: "osrs",
          transformedFrom: 46002,
          deps: [],
        },
        "seq:9501": {
          kind: "seq",
          id: 9501,
          name: "osrs_td_stand",
          source: "osrs",
          transformedFrom: 9501,
          deps: [
            { kind: "anim", id: 2005, via: "frame0" },
            { kind: "anim-base", id: 47001, via: "skeleton" },
          ],
        },
        "seq:9502": {
          kind: "seq",
          id: 9502,
          name: "osrs_td_attack",
          source: "osrs",
          transformedFrom: 9502,
          deps: [
            { kind: "anim", id: 2006, via: "frame0" },
            { kind: "anim-base", id: 47001, via: "skeleton" },
          ],
        },
        "anim:2005": {
          kind: "anim",
          id: 2005,
          name: "osrs_anim_2005",
          source: "osrs",
          transformedFrom: 2005,
          deps: [],
        },
        "anim:2006": {
          kind: "anim",
          id: 2006,
          name: "osrs_anim_2006",
          source: "osrs",
          transformedFrom: 2006,
          deps: [],
        },
        "anim-base:47001": {
          kind: "anim-base",
          id: 47001,
          name: "osrs_base_47001",
          source: "osrs",
          transformedFrom: 47001,
          deps: [],
        },
        "param:1234": {
          kind: "param",
          id: 1234,
          name: "attack_anim",
          source: "osrs",
          transformedFrom: 1234,
          deps: [{ kind: "seq", id: 9502, via: "value" }],
        },
        "param:1235": {
          kind: "param",
          id: 1235,
          name: "death_anim",
          source: "osrs",
          transformedFrom: 1235,
          deps: [{ kind: "seq", id: 9501, via: "value" }],
        },
        "script:tormented_demon": {
          kind: "script",
          id: "tormented_demon",
          name: "tormented_demon.rs2",
          source: "osrs",
          transformedFrom: null,
          deps: [
            { kind: "obj", id: "fire_shield", via: "obj_assoc", missing: true },
            { kind: "seq", id: "td_attack", via: "ai_dispatch", missing: true },
            { kind: "sound", id: "td_fireball", via: "sound_call", missing: true },
          ],
        },
      },
      cycles: [],
      missing: [
        { kind: "obj", id: "fire_shield" },
        { kind: "seq", id: "td_attack" },
        { kind: "sound", id: "td_fireball" },
      ],
    },
    osrs_kalphite_queen: {
      version: 1,
      root: { kind: "npc", id: 9002, name: "osrs_kalphite_queen" },
      nodes: {
        "npc:9002": {
          kind: "npc",
          id: 9002,
          name: "osrs_kalphite_queen",
          source: "osrs",
          transformedFrom: 9002,
          deps: [
            { kind: "model", id: 46003, via: "models[0]" },
            { kind: "seq", id: 9601, via: "readyanim" },
            { kind: "seq", id: 9602, via: "walkanim" },
            { kind: "npc", id: 9003, via: "multinpc[1]" },
            { kind: "script", id: "kalphite_queen", via: "combat-script" },
          ],
        },
        "model:46003": {
          kind: "model",
          id: 46003,
          name: "osrs_model_46003",
          source: "osrs",
          transformedFrom: 46003,
          deps: [],
        },
        "seq:9601": {
          kind: "seq",
          id: 9601,
          name: "osrs_kq1_idle",
          source: "osrs",
          transformedFrom: 9601,
          deps: [
            { kind: "anim", id: 2010, via: "frame0" },
            { kind: "anim-base", id: 47002, via: "skeleton" },
          ],
        },
        "seq:9602": {
          kind: "seq",
          id: 9602,
          name: "osrs_kq1_walk",
          source: "osrs",
          transformedFrom: 9602,
          deps: [
            { kind: "anim", id: 2011, via: "frame0" },
            { kind: "anim-base", id: 47002, via: "skeleton" },
          ],
        },
        "anim:2010": {
          kind: "anim",
          id: 2010,
          name: "osrs_anim_2010",
          source: "osrs",
          transformedFrom: 2010,
          deps: [],
        },
        "anim:2011": {
          kind: "anim",
          id: 2011,
          name: "osrs_anim_2011",
          source: "osrs",
          transformedFrom: 2011,
          deps: [],
        },
        "anim-base:47002": {
          kind: "anim-base",
          id: 47002,
          name: "osrs_base_47002",
          source: "osrs",
          transformedFrom: 47002,
          deps: [],
        },
        "npc:9003": {
          kind: "npc",
          id: 9003,
          name: "osrs_kalphite_queen_2",
          source: "osrs",
          transformedFrom: 9003,
          deps: [
            { kind: "model", id: 46004, via: "models[0]" },
            { kind: "seq", id: 9603, via: "readyanim" },
            { kind: "seq", id: 9604, via: "walkanim" },
          ],
        },
        "model:46004": {
          kind: "model",
          id: 46004,
          name: "osrs_model_46004",
          source: "osrs",
          transformedFrom: 46004,
          deps: [],
        },
        "seq:9603": {
          kind: "seq",
          id: 9603,
          name: "osrs_kq2_idle",
          source: "osrs",
          transformedFrom: 9603,
          deps: [
            { kind: "anim", id: 2012, via: "frame0" },
            { kind: "anim-base", id: 47002, via: "skeleton" },
          ],
        },
        "seq:9604": {
          kind: "seq",
          id: 9604,
          name: "osrs_kq2_walk",
          source: "osrs",
          transformedFrom: 9604,
          deps: [
            { kind: "anim", id: 2013, via: "frame0" },
            { kind: "anim-base", id: 47002, via: "skeleton" },
          ],
        },
        "anim:2012": {
          kind: "anim",
          id: 2012,
          name: "osrs_anim_2012",
          source: "osrs",
          transformedFrom: 2012,
          deps: [],
        },
        "anim:2013": {
          kind: "anim",
          id: 2013,
          name: "osrs_anim_2013",
          source: "osrs",
          transformedFrom: 2013,
          deps: [],
        },
        "script:kalphite_queen": {
          kind: "script",
          id: "kalphite_queen",
          name: "kalphite_queen.rs2",
          source: "osrs",
          transformedFrom: null,
          deps: [{ kind: "obj", id: "kq_head", via: "obj_assoc", missing: true }],
        },
      },
      cycles: [],
      missing: [{ kind: "obj", id: "kq_head" }],
    },
  };

  return knownDemos[debugname] || null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name");

  if (!name) {
    // List available dep maps
    const dir = path.join(LOSTCITY, "content/deps");
    const files: string[] = [];
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.endsWith(".deps.json")) {
          files.push(entry.replace(/\.deps\.json$/, ""));
        }
      }
    }
    // Always include the demo dep maps even if no files exist
    const demoNames = ["osrs_tormented_demon", "osrs_kalphite_queen"];
    const all = Array.from(new Set([...files, ...demoNames]));
    return NextResponse.json({ available: all });
  }

  // Try the real file first
  const filePath = path.join(LOSTCITY, "content/deps", `${name}.deps.json`);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as DepsMap;
      return NextResponse.json(parsed);
    } catch (e) {
      return NextResponse.json(
        { error: `Failed to parse ${name}.deps.json: ${(e as Error).message}` },
        { status: 500 }
      );
    }
  }

  // Fall back to synthesized demo data
  const demo = synthesizeDemoDepMap(name);
  if (demo) {
    return NextResponse.json({ ...demo, _demo: true });
  }

  return NextResponse.json({ error: `No dep map named '${name}'` }, { status: 404 });
}
