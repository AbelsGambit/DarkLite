import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const LOSTCITY = "/home/z/my-project/lostcity";
const MAP_FILE = path.join(LOSTCITY, "content/maps/m50_50.jm2");
const NPC_PACK = path.join(LOSTCITY, "content/pack/npc.pack");
const MAP_BACKUP = MAP_FILE + ".bak";

/**
 * The .jm2 map files are ASCII text with sections:
 *   ==== MAP ====
 *   <level> <x> <z>: <terrain tokens>
 *   ==== LOC ====
 *   <level> <x> <z>: <locId> <shape> <angle>
 *   ==== NPC ====
 *   <level> <x> <z>: <npcId>
 *   ==== OBJ ====
 *   <level> <x> <z>: <objId> <count>
 *
 * Hans is NPC 0, spawned at "0 7 33: 0" in m50_50.jm2 (Lumbridge).
 */

function readNpcPack(): Map<string, number> {
    const map = new Map<string, number>();
    try {
        const data = fs.readFileSync(NPC_PACK, "utf-8");
        for (const line of data.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eq = trimmed.indexOf("=");
            if (eq < 0) continue;
            const id = parseInt(trimmed.substring(0, eq));
            const name = trimmed.substring(eq + 1);
            if (!isNaN(id)) {
                map.set(name, id);
                map.set(String(id), id);
            }
        }
    } catch {}
    return map;
}

interface NpcSpawn {
    line: number;
    level: number;
    x: number;
    z: number;
    npcId: number;
    rawLine: string;
}

function findNpcSpawns(data: string, targetNpcId: number = 0): NpcSpawn[] {
    const spawns: NpcSpawn[] = [];
    const lines = data.split("\n");
    let inNpcSection = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("=== NPC ===")) {
            inNpcSection = true;
            continue;
        }
        if (line.includes("==== ") && !line.includes("NPC")) {
            inNpcSection = false;
            continue;
        }
        if (!inNpcSection) continue;

        // Format: "<level> <x> <z>: <npcId>"
        const match = line.match(/^(\d+)\s+(\d+)\s+(\d+):\s*(\d+)/);
        if (!match) continue;

        const level = parseInt(match[1]);
        const x = parseInt(match[2]);
        const z = parseInt(match[3]);
        const npcId = parseInt(match[4]);

        if (npcId === targetNpcId) {
            spawns.push({ line: i, level, x, z, npcId, rawLine: line });
        }
    }
    return spawns;
}

export async function GET() {
    try {
        const npcMap = readNpcPack();
        const tdId = npcMap.get("osrs_tormented_demon");

        if (!fs.existsSync(MAP_FILE)) {
            return NextResponse.json({ error: "Map file not found", path: MAP_FILE }, { status: 404 });
        }

        const data = fs.readFileSync(MAP_FILE, "utf-8");
        const hansSpawns = findNpcSpawns(data, 0);

        // Check what the current debug NPC is (read all spawns, find non-zero if backup exists)
        let originalHansCount = 0;
        let currentDebugNpcId: number | null = null;

        if (fs.existsSync(MAP_BACKUP)) {
            const backupData = fs.readFileSync(MAP_BACKUP, "utf-8");
            originalHansCount = findNpcSpawns(backupData, 0).length;
            // The current debug NPC is whatever replaced Hans
            // Compare current spawns at Hans's original positions
            const backupHans = findNpcSpawns(backupData, 0);
            if (backupHans.length > 0 && hansSpawns.length === 0) {
                // Hans was replaced — find what's at those positions now
                for (const hans of backupHans) {
                    const lines = data.split("\n");
                    const expectedPrefix = `${hans.level} ${hans.x} ${hans.z}:`;
                    const replacedLine = lines[hans.line];
                    if (replacedLine) {
                        const match = replacedLine.match(/^(\d+)\s+(\d+)\s+(\d+):\s*(\d+)/);
                        if (match) {
                            currentDebugNpcId = parseInt(match[4]);
                            break;
                        }
                    }
                }
            }
        } else {
            originalHansCount = hansSpawns.length;
        }

        return NextResponse.json({
            mapFile: MAP_FILE,
            mapSize: data.length,
            hansSpawnsFound: hansSpawns.length,
            originalHansCount,
            tormentedDemonNpcId: tdId ?? null,
            hasBackup: fs.existsSync(MAP_BACKUP),
            currentDebugNpcId,
            spawns: hansSpawns.map(s => ({
                line: s.line,
                level: s.level,
                x: s.x,
                z: s.z,
                npcId: s.npcId,
                rawLine: s.rawLine,
            })),
        });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { action, npcId, npcName } = body;

        const npcMap = readNpcPack();

        if (action === "restore") {
            if (!fs.existsSync(MAP_BACKUP)) {
                return NextResponse.json({ error: "No backup found — map is already original" }, { status: 400 });
            }
            fs.copyFileSync(MAP_BACKUP, MAP_FILE);
            return NextResponse.json({
                success: true,
                message: "Map restored to original (Hans NPC 0)",
                mapFile: MAP_FILE,
            });
        }

        if (action === "set_debug_npc") {
            let targetNpcId: number | null = null;

            if (typeof npcId === "number") {
                targetNpcId = npcId;
            } else if (typeof npcName === "string" && npcName.trim()) {
                targetNpcId = npcMap.get(npcName.trim()) ?? null;
                if (targetNpcId === null) {
                    const asNum = parseInt(npcName);
                    if (!isNaN(asNum)) targetNpcId = asNum;
                }
            }

            if (targetNpcId === null || isNaN(targetNpcId)) {
                return NextResponse.json({ error: "Could not resolve NPC ID. Provide npcId (number) or npcName (name from npc.pack)." }, { status: 400 });
            }

            if (!fs.existsSync(MAP_FILE)) {
                return NextResponse.json({ error: "Map file not found" }, { status: 404 });
            }

            // Create backup from the ORIGINAL file (if not already backed up)
            if (!fs.existsSync(MAP_BACKUP)) {
                fs.copyFileSync(MAP_FILE, MAP_BACKUP);
            }

            // Always work from the backup to find Hans's original positions
            const backupData = fs.readFileSync(MAP_BACKUP, "utf-8");
            const hansSpawns = findNpcSpawns(backupData, 0);

            if (hansSpawns.length === 0) {
                return NextResponse.json({ error: "No Hans (NPC 0) spawns found in m50_50.jm2" }, { status: 400 });
            }

            // Replace the NPC ID on Hans's spawn lines
            const lines = backupData.split("\n");
            let replaced = 0;
            for (const spawn of hansSpawns) {
                const oldLine = lines[spawn.line];
                // Replace the NPC ID at the end of the line
                const newLine = oldLine.replace(/:\s*\d+\s*$/, `: ${targetNpcId}`);
                if (newLine !== oldLine) {
                    lines[spawn.line] = newLine;
                    replaced++;
                }
            }

            const newData = lines.join("\n");
            fs.writeFileSync(MAP_FILE, newData);

            const npcNameResolved = [...npcMap.entries()].find(([_, id]) => id === targetNpcId)?.[0] ?? "(unknown)";

            return NextResponse.json({
                success: true,
                message: `Replaced ${replaced} Hans spawn(s) with NPC ${targetNpcId} (${npcNameResolved}) in m50_50.jm2`,
                mapFile: MAP_FILE,
                backupFile: MAP_BACKUP,
                targetNpcId,
                targetNpcName: npcNameResolved,
                spawnsReplaced: replaced,
                note: "Run 'bun run build' in the engine directory to pack the map change into the cache.",
            });
        }

        return NextResponse.json({ error: "Unknown action. Use 'set_debug_npc' or 'restore'." }, { status: 400 });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
