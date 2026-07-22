import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import https from "https";

const LOSTCITY = "/home/z/my-project/lostcity";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = "AbelsGambit/DarkLite";
const BRANCH = "wip/osrs-pipeline";
const API_BASE = "https://api.github.com";

// Simple in-memory rate limit tracker
let lastRequestTime = 0;
let requestCount = 0;
let rateLimitReset = 0;

function checkRateLimit(): { canRequest: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  if (now > rateLimitReset * 1000) {
    requestCount = 0;
  }
  // GitHub authenticated: 5000/hr, unauthenticated: 60/hr
  // Be conservative: max 40 unauthenticated, 4000 authenticated per hour
  const maxRequests = GITHUB_TOKEN ? 4000 : 40;
  const remaining = maxRequests - requestCount;
  const resetIn = Math.max(0, rateLimitReset * 1000 - now);
  return { canRequest: requestCount < maxRequests, remaining, resetIn };
}

async function githubFetch(url: string): Promise<any> {
  const state = checkRateLimit();
  if (!state.canRequest) {
    throw new Error(`GitHub rate limit exceeded. Resets in ${Math.ceil(state.resetIn / 1000)}s`);
  }

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "User-Agent": "LostCity-Launcher",
      "Accept": "application/vnd.github.v3+json",
    };
    if (GITHUB_TOKEN) {
      headers["Authorization"] = `token ${GITHUB_TOKEN}`;
    }

    https.get(url, { headers }, (res) => {
      // Track rate limit
      const remaining = parseInt(res.headers["x-ratelimit-remaining"] as string || "0");
      rateLimitReset = parseInt(res.headers["x-ratelimit-reset"] as string || "0");
      requestCount++;

      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        } else if (res.statusCode === 403 && remaining === 0) {
          reject(new Error(`GitHub rate limit exceeded. Resets at ${new Date(rateLimitReset * 1000).toISOString()}`));
        } else {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    }).on("error", reject);
  });
}

async function downloadFile(url: string, destPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "User-Agent": "LostCity-Launcher",
    };
    if (GITHUB_TOKEN) {
      headers["Authorization"] = `token ${GITHUB_TOKEN}`;
    }

    https.get(url, { headers }, (res) => {
      if (res.statusCode === 200) {
        const dir = path.dirname(destPath);
        fs.mkdirSync(dir, { recursive: true });
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(fs.statSync(destPath).size);
        });
        file.on("error", reject);
      } else if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        const newUrl = res.headers.location as string;
        if (newUrl) {
          downloadFile(newUrl, destPath).then(resolve).catch(reject);
        } else {
          reject(new Error("Redirect without location"));
        }
      } else {
        reject(new Error(`Download failed: ${res.statusCode}`));
      }
    }).on("error", reject);
  });
}

export async function GET() {
  try {
    const state = checkRateLimit();
    return NextResponse.json({
      rateLimit: {
        remaining: state.remaining,
        resetIn: Math.ceil(state.resetIn / 1000),
        hasToken: !!GITHUB_TOKEN,
      },
      repo: REPO,
      branch: BRANCH,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, paths } = body;

    if (action === "list") {
      // List available files in the repo's content folder
      const url = `${API_BASE}/repos/${REPO}/contents/content?ref=${BRANCH}`;
      const result = await githubFetch(url);
      return NextResponse.json({ files: result, rateLimit: checkRateLimit() });
    }

    if (action === "download_paths") {
      // Download specific files from the repo
      // paths: array of { repoPath, localPath }
      if (!Array.isArray(paths)) {
        return NextResponse.json({ error: "paths must be an array" }, { status: 400 });
      }

      const results: { path: string; success: boolean; size?: number; error?: string }[] = [];

      for (const p of paths) {
        try {
          const { repoPath, localPath } = p;
          // Use raw.githubusercontent.com for file downloads (no rate limit on downloads)
          const rawUrl = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${repoPath}`;
          const fullPath = path.join(LOSTCITY, localPath);

          const size = await downloadFile(rawUrl, fullPath);
          results.push({ path: localPath, success: true, size });
        } catch (err) {
          results.push({ path: p.localPath, success: false, error: (err as Error).message });
        }
      }

      return NextResponse.json({
        success: true,
        results,
        rateLimit: checkRateLimit(),
      });
    }

    if (action === "download_td") {
      // Download just the TD model files + NPC config
      const tdFiles = [
        { repoPath: "content/models/npc/osrs_td_53287.ob2", localPath: "content/models/npc/osrs_td_53287.ob2" },
        { repoPath: "content/models/npc/osrs_td_53285.ob2", localPath: "content/models/npc/osrs_td_53285.ob2" },
        { repoPath: "content/models/npc/osrs_td_6318.ob2", localPath: "content/models/npc/osrs_td_6318.ob2" },
        { repoPath: "content/scripts/npc/configs/osrs_tormented_demon.npc", localPath: "content/scripts/npc/configs/osrs_tormented_demon.npc" },
      ];

      const results: { path: string; success: boolean; size?: number; error?: string }[] = [];

      for (const p of tdFiles) {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p.repoPath}`;
          const fullPath = path.join(LOSTCITY, p.localPath);
          const size = await downloadFile(rawUrl, fullPath);
          results.push({ path: p.localPath, success: true, size });
        } catch (err) {
          results.push({ path: p.localPath, success: false, error: (err as Error).message });
        }
      }

      return NextResponse.json({
        success: true,
        message: "TD files downloaded. Now update pack files.",
        results,
        rateLimit: checkRateLimit(),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
