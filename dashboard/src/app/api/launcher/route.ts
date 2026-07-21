import { NextResponse } from "next/server";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

const LOSTCITY = "/home/z/my-project/lostcity";
const ENGINE_DIR = path.join(LOSTCITY, "engine");
const CLIENT_DIR = path.join(LOSTCITY, "client");

const runningProcesses = new Map<string, ChildProcess>();

export const dynamic = "force-dynamic";

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  key: string,
  wait: boolean = false,
  timeout: number = 60000
): Promise<{ command: string; cwd: string; pid?: number; output: string; error?: string; stillRunning?: boolean }> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = spawn(cmd, args, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: !wait,
    });

    let output = "";
    let errorOutput = "";

    child.stdout?.on("data", (data) => { output += data.toString(); });
    child.stderr?.on("data", (data) => { errorOutput += data.toString(); });

    if (wait) {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ command: `${cmd} ${args.join(" ")}`, cwd, output: output + (errorOutput ? "\n[stderr]\n" + errorOutput : ""), error: "Command timed out" });
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        runningProcesses.delete(key);
        resolve({ command: `${cmd} ${args.join(" ")}`, cwd, output: output + (errorOutput ? "\n[stderr]\n" + errorOutput : ""), error: code !== 0 ? `Exited with code ${code}` : undefined });
      });
      child.on("error", (err) => { clearTimeout(timer); resolve({ command: `${cmd} ${args.join(" ")}`, cwd, output, error: err.message }); });
    } else {
      runningProcesses.set(key, child);
      child.on("close", () => { runningProcesses.delete(key); });
      setTimeout(() => { resolve({ command: `${cmd} ${args.join(" ")}`, cwd, pid: child.pid, output: "Process started in background", stillRunning: true }); }, 2000);
    }
  });
}

export async function GET() {
  const processes: { key: string; pid: number; running: boolean }[] = [];
  for (const [key, proc] of runningProcesses) {
    processes.push({ key, pid: proc.pid ?? 0, running: !proc.killed });
  }
  return NextResponse.json({ processes, engineDir: ENGINE_DIR, clientDir: CLIENT_DIR, platform: process.platform, isWindows: process.platform === "win32" });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;
    const isWindows = process.platform === "win32";

    switch (action) {
      case "play": {
        const gradlew = isWindows ? "gradlew.bat" : "./gradlew";
        const buildResult = await runCommand(gradlew, ["build"], CLIENT_DIR, "client-build", true, 120000);
        if (buildResult.error) return NextResponse.json({ success: false, step: "build", ...buildResult });
        const runResult = await runCommand(gradlew, ["run"], CLIENT_DIR, "client-run", false);
        return NextResponse.json({ success: true, message: "Client built and launched", build: buildResult, run: runResult });
      }
      case "build_game": {
        const result = await runCommand("bun", ["start"], ENGINE_DIR, "engine-start", false);
        return NextResponse.json({ success: true, message: "Game server starting (bun install + bun run src/app.ts)", ...result });
      }
      case "clean_build": {
        const cleanResult = await runCommand("npm", ["run", "clean"], ENGINE_DIR, "engine-clean", true, 60000);
        const homeDir = process.env.HOME || process.env.USERPROFILE || "";
        const fileStorePaths = [path.join(homeDir, ".file_store_32"), isWindows ? "C:\\.file_store_32" : "/.file_store_32"];
        let fileStoreCleaned = false;
        let fileStoreMsg = "";
        for (const fsPath of fileStorePaths) {
          try { if (fs.existsSync(fsPath)) { fs.rmSync(fsPath, { recursive: true, force: true }); fileStoreCleaned = true; fileStoreMsg += `Cleaned ${fsPath}. `; } } catch {}
        }
        const startResult = await runCommand("bun", ["start"], ENGINE_DIR, "engine-start", false);
        return NextResponse.json({ success: true, message: "Clean build started", clean: cleanResult, fileStore: { cleaned: fileStoreCleaned, message: fileStoreMsg || "No .file_store_32 found", paths: fileStorePaths }, start: startResult });
      }
      case "clean_file_store": {
        const homeDir = process.env.HOME || process.env.USERPROFILE || "";
        const fileStorePaths = [path.join(homeDir, ".file_store_32"), isWindows ? "C:\\.file_store_32" : "/.file_store_32"];
        let cleaned = false;
        let msg = "";
        for (const fsPath of fileStorePaths) {
          try { if (fs.existsSync(fsPath)) { fs.rmSync(fsPath, { recursive: true, force: true }); cleaned = true; msg += `Cleaned ${fsPath}. `; } } catch {}
        }
        return NextResponse.json({ success: cleaned, message: cleaned ? msg : "No .file_store_32 found", paths: fileStorePaths });
      }
      case "stop_all": {
        let killed = 0;
        for (const [, proc] of runningProcesses) { try { proc.kill("SIGTERM"); killed++; } catch {} }
        runningProcesses.clear();
        return NextResponse.json({ success: true, message: `Stopped ${killed} running process(es)` });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
