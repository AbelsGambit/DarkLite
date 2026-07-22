import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const LOSTCITY = "/home/z/my-project/lostcity";
const MODEL_PACK = path.join(LOSTCITY, "content/pack/model.pack");
const NPC_PACK = path.join(LOSTCITY, "content/pack/npc.pack");
const NPC_CONFIG_DIR = path.join(LOSTCITY, "content/scripts/npc/configs");
const MODEL_DIR = path.join(LOSTCITY, "content/models/npc");

// TD model info
const TD_MODELS = [
  { id: 53287, packId: 14927, name: "osrs_td_53287" },
  { id: 53285, packId: 14928, name: "osrs_td_53285" },
  { id: 6318, packId: 14929, name: "osrs_td_6318" },
];
const TD_NPC_ID = 3852;
const TD_NPC_NAME = "osrs_tormented_demon";
const TD_CONFIG_PATH = path.join(NPC_CONFIG_DIR, "osrs_tormented_demon.npc");

const TD_NPC_CONFIG = `[osrs_tormented_demon]
name=Tormented Demon
desc=A fearsome demon from the While Guthix Sleeps quest.
model1=osrs_td_53287
model2=osrs_td_53285
model3=osrs_td_6318
size=3
resizeh=110
resizev=110
walkanim=demon_walk
readyanim=demon_ready
op2=Attack
vislevel=450
wanderrange=6
maxrange=16
respawnrate=60
hitpoints=600
attack=255
strength=255
defence=150
magic=255
ranged=255
huntmode=cowardly
huntrange=2
param=attack_anim,demon_attack
param=defend_anim,demon_block
param=death_anim,demon_death`;

function readPackFile(packPath: string): string {
  try {
    return fs.readFileSync(packPath, "utf-8");
  } catch {
    return "";
  }
}

function writePackFile(packPath: string, content: string): void {
  fs.writeFileSync(packPath, content);
}

function isTdImported(): boolean {
  const npcPack = readPackFile(NPC_PACK);
  return npcPack.includes(`=${TD_NPC_NAME}`);
}

function isTdModelsDownloaded(): boolean {
  return TD_MODELS.every(m => fs.existsSync(path.join(MODEL_DIR, `${m.name}.ob2`)));
}

function applyTdImport(): { success: boolean; message: string; details: string[] } {
  const details: string[] = [];

  // Check if models are downloaded
  if (!isTdModelsDownloaded()) {
    return {
      success: false,
      message: "TD model files not found. Download them first via the GitHub download API.",
      details: [],
    };
  }

  // Check if already imported
  if (isTdImported()) {
    return { success: true, message: "TD already imported", details: ["NPC already in npc.pack"] };
  }

  // Add models to model.pack
  const modelPack = readPackFile(MODEL_PACK);
  const modelLines = modelPack.trim().split("\n");
  let nextModelId = 0;
  for (const line of modelLines) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      const id = parseInt(line.substring(0, eq));
      if (id >= nextModelId) nextModelId = id + 1;
    }
  }
  for (const m of TD_MODELS) {
    const line = `${nextModelId}=${m.name}`;
    modelLines.push(line);
    details.push(`model.pack: ${line}`);
    nextModelId++;
  }
  writePackFile(MODEL_PACK, modelLines.join("\n") + "\n");

  // Create NPC config
  fs.writeFileSync(TD_CONFIG_PATH, TD_NPC_CONFIG + "\n");
  details.push(`Created: ${TD_CONFIG_PATH}`);

  // Add NPC to npc.pack
  const npcPack = readPackFile(NPC_PACK);
  const npcLines = npcPack.trim().split("\n");
  let nextNpcId = 0;
  for (const line of npcLines) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      const id = parseInt(line.substring(0, eq));
      if (id >= nextNpcId) nextNpcId = id + 1;
    }
  }
  const npcLine = `${nextNpcId}=${TD_NPC_NAME}`;
  npcLines.push(npcLine);
  details.push(`npc.pack: ${npcLine}`);
  writePackFile(NPC_PACK, npcLines.join("\n") + "\n");

  return {
    success: true,
    message: `TD imported as NPC ${nextNpcId}`,
    details,
  };
}

function removeTdImport(): { success: boolean; message: string; details: string[] } {
  const details: string[] = [];

  // Remove from model.pack
  const modelPack = readPackFile(MODEL_PACK);
  const modelLines = modelPack.split("\n").filter(line => {
    if (line.includes("osrs_td_")) {
      details.push(`Removed from model.pack: ${line}`);
      return false;
    }
    return true;
  });
  writePackFile(MODEL_PACK, modelLines.join("\n"));

  // Remove NPC config
  if (fs.existsSync(TD_CONFIG_PATH)) {
    fs.unlinkSync(TD_CONFIG_PATH);
    details.push(`Deleted: ${TD_CONFIG_PATH}`);
  }

  // Remove from npc.pack
  const npcPack = readPackFile(NPC_PACK);
  const npcLines = npcPack.split("\n").filter(line => {
    if (line.includes(TD_NPC_NAME)) {
      details.push(`Removed from npc.pack: ${line}`);
      return false;
    }
    return true;
  });
  writePackFile(NPC_PACK, npcLines.join("\n"));

  return {
    success: true,
    message: "TD import removed",
    details,
  };
}

export async function GET() {
  return NextResponse.json({
    tdImported: isTdImported(),
    tdModelsDownloaded: isTdModelsDownloaded(),
    tdNpcId: TD_NPC_ID,
    tdNpcName: TD_NPC_NAME,
    tdModels: TD_MODELS,
    availableMods: [
      { id: "td", name: "Tormented Demon", category: "Monsters", description: "Imports the Tormented Demon NPC (ID 3852) from OSRS. Requires model download from GitHub." },
    ],
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, modId } = body;

    if (action === "apply" && modId === "td") {
      const result = applyTdImport();
      return NextResponse.json(result);
    }

    if (action === "remove" && modId === "td") {
      const result = removeTdImport();
      return NextResponse.json(result);
    }

    if (action === "status") {
      return NextResponse.json({
        tdImported: isTdImported(),
        tdModelsDownloaded: isTdModelsDownloaded(),
      });
    }

    return NextResponse.json({ error: "Unknown action/modId" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
