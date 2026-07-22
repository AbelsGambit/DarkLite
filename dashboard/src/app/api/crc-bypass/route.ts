import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const LOSTCITY = "/home/z/my-project/lostcity";
const PACKET_TS = path.join(LOSTCITY, "engine/src/io/Packet.ts");

interface CrcState {
  enabled: boolean;
  unknown: boolean;
  line63: string;
  description: string;
}

function readCrcState(): CrcState {
  try {
    const content = fs.readFileSync(PACKET_TS, "utf-8");
    const lines = content.split("\n");
    const line = lines[62]?.trim() ?? "";

    if (line === "return true;") {
      return {
        enabled: true,
        unknown: false,
        line63: line,
        description: "CRC checks are BYPASSED. The client will accept any cache file regardless of checksum integrity. This is required for modding — without it, modified cache files will be rejected by the client's integrity verification.",
      };
    } else if (line.includes("getcrc") && line.includes("== expected")) {
      return {
        enabled: false,
        unknown: false,
        line63: line,
        description: "CRC checks are ENABLED (standard behavior). The client validates cache file checksums. Modified cache files will be rejected unless this is bypassed.",
      };
    } else {
      return {
        enabled: false,
        unknown: true,
        line63: line,
        description: "Could not validate the status of the standard CRC check. If build fails to checksum/key/authentication, replace Packet.ts file in engine/src/io/.",
      };
    }
  } catch {
    return {
      enabled: false,
      unknown: true,
      line63: "(file not found)",
      description: "Could not validate the status of the standard CRC check. If build fails to checksum/key/authentication, replace Packet.ts file in engine/src/io/.",
    };
  }
}

function setCrcBypass(enabled: boolean): { success: boolean; error?: string } {
  try {
    const content = fs.readFileSync(PACKET_TS, "utf-8");
    const lines = content.split("\n");
    let foundCheckcrc = false;
    let returnLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("static checkcrc")) foundCheckcrc = true;
      if (foundCheckcrc && lines[i].trim().startsWith("return ")) { returnLineIdx = i; break; }
    }
    if (returnLineIdx === -1) return { success: false, error: "Could not find return statement in checkcrc function" };
    if (enabled) {
      lines[returnLineIdx] = lines[returnLineIdx].replace(/return .*;/, "return true;");
    } else {
      lines[returnLineIdx] = lines[returnLineIdx].replace(/return .*;/, "return Packet.getcrc(src, offset, length) == expected;");
    }
    fs.writeFileSync(PACKET_TS, lines.join("\n"));
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function GET() {
  return NextResponse.json({ ...readCrcState(), packetTsPath: PACKET_TS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, enabled } = body;
    if (action === "set") {
      const result = setCrcBypass(enabled === true);
      if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      return NextResponse.json({ success: true, message: `CRC bypass ${enabled ? "ENABLED" : "DISABLED"}`, ...readCrcState() });
    }
    if (action === "check") return NextResponse.json(readCrcState());
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
