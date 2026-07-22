#!/usr/bin/env bun
/**
 * UpdateVariantsIndex.ts — Task 9 utility script.
 *
 * Scans `content/deps/*.deps.json` and (re)generates
 * `content/deps/variants.json` — the index of "which OSRS variants
 * exist" that `VariantRegistry.load()` consumes at engine startup.
 *
 * Run this after every Task 8 import (`bun tools/osrs/Import.ts ...`)
 * to keep the variants index in sync with the deps files on disk.
 *
 * Usage:
 *   bun tools/osrs/UpdateVariantsIndex.ts [--content-dir=<dir>]
 *
 * Flags:
 *   --content-dir=<dir>  Path to the LostCity content/ folder. Defaults
 *                       to `Environment.BUILD_SRC_DIR` (typically
 *                       `../content`).
 *   --help, -h           Show this help.
 *
 * Exit codes:
 *   0  — index written (or unchanged)
 *   1  — bad args / IO error
 *
 * How it works:
 *   For each `*.deps.json` file under `<content-dir>/deps/`:
 *     1. Load it as a `DepsMap`.
 *     2. Find the root NPC node (`nodes[npc:<root.id>]`).
 *     3. If the NPC node's `transformedFrom` is null/undefined, SKIP
 *        — this NPC hasn't been imported yet (only traced). The
 *        variants index only includes imported NPCs.
 *     4. The `transformedFrom` value is the new 377 NPC ID assigned
 *        by Task 8 — this becomes `osrsNpcId` in the variants.json.
 *     5. Try to determine the legacy 377 NPC ID (`legacyNpcId`):
 *        - If the OSRS NPC's debugname (`npcNode.name`, e.g.
 *          `"osrs_tormented_demon"`) matches a legacy `NpcType`
 *          debugname (via `NpcType.getByName`), use that legacy ID.
 *          This is the case for NPCs like the Kalphite Queen where
 *          the OSRS import is a higher-detail twin of an existing 377
 *          NPC.
 *        - Otherwise, treat as brand-new and set `legacyNpcId = -1`
 *          (the Tormented Demon case).
 *     6. Extract `osrsDebugname` from `npcNode.name` (fall back to
 *        `osrs_npc_<osrsNpcId>` if null).
 *     7. Extract `legacyDebugname` from `NpcType.get(legacyNpcId)?.debugname`
 *        (null if `legacyNpcId === -1`).
 *     8. Record the relative path to the deps.json file as `depMapPath`.
 *     9. Record the deps.json file's mtime as `importedAt` (ISO string).
 *
 * The result is written to `<content-dir>/deps/variants.json`,
 * overwriting any existing file. The schema version is 1.
 *
 * Backwards-compat: this script is IDEMPOTENT. Re-running it produces
 * the same variants.json (modulo timestamps) as long as the deps files
 * haven't changed. It NEVER modifies any deps.json or pack file.
 */

import fs from 'fs';
import path from 'path';

import NpcType from '#/cache/config/NpcType.js';
import Environment from '#/util/Environment.js';
import { printError, printInfo, printWarning } from '#/util/Logger.js';

import { DepsMap, DEPS_SCHEMA_VERSION } from './DepsSchema.js';

/**
 * On-disk shape of `content/deps/variants.json`. Mirrors the
 * `VariantEntry` interface in
 * `engine/src/engine/variant/VariantRegistry.ts`.
 */
interface VariantEntry {
    legacyNpcId: number;
    osrsNpcId: number;
    osrsDebugname: string;
    legacyDebugname: string | null;
    depMapPath: string;
    importedAt: string;
}

interface VariantsFile {
    version: 1;
    variants: VariantEntry[];
    /**
     * Optional list of `[npcIdA, npcIdB]` pairs declaring form-swap
     * linkage (Task 11). Preserved across `regenerateIndex()` calls
     * — see `regenerateIndex()` docstring.
     */
    linkages?: [number, number][];
}

/**
 * Parse CLI args. Recognized:
 *   --content-dir=<dir>   Override the content dir.
 *   --help, -h            Show help.
 */
function parseArgs(): { contentDir: string; showHelp: boolean } {
    let contentDir = Environment.BUILD_SRC_DIR;
    let showHelp = false;
    for (const arg of process.argv.slice(2)) {
        if (arg === '--help' || arg === '-h') {
            showHelp = true;
        } else if (arg.startsWith('--content-dir=')) {
            contentDir = arg.slice('--content-dir='.length);
        } else {
            printWarning(`Unknown arg: ${arg} (use --help)`);
        }
    }
    return { contentDir, showHelp };
}

function printHelp(): void {
    const help = [
        'UpdateVariantsIndex.ts — regenerate content/deps/variants.json',
        '',
        'Usage:',
        '  bun tools/osrs/UpdateVariantsIndex.ts [--content-dir=<dir>]',
        '',
        'Flags:',
        '  --content-dir=<dir>  Path to the LostCity content/ folder.',
        '                       Defaults to Environment.BUILD_SRC_DIR.',
        '  --help, -h           Show this help.',
        ''
    ].join('\n');
    console.log(help);
}

/**
 * Determine the legacy 377 NPC ID for a given OSRS NPC node.
 *
 * Heuristic: look up the OSRS NPC's debugname (which is the sanitized
 * `osrs_<name>` form assigned by Task 8) in the legacy `NpcType`
 * registry's `configNames` map. If found, that's the legacy NPC ID.
 *
 * This works for NPCs whose OSRS import is a higher-detail twin of an
 * existing 377 NPC (e.g. Kalphite Queen) — the OSRS debugname matches
 * the legacy debugname (modulo the `osrs_` prefix).
 *
 * For brand-new OSRS NPCs (e.g. Tormented Demon), there's no legacy
 * twin — return -1.
 *
 * The heuristic is intentionally conservative: if there's any doubt
 * (e.g. debugname is null or the legacy lookup misses), return -1.
 * Better to mark a NPC as brand-new than to incorrectly pair it with
 * the wrong legacy NPC.
 */
function findLegacyNpcId(osrsDebugname: string | null): number {
    if (!osrsDebugname) {
        return -1;
    }
    // Try the OSRS debugname as-is (won't match legacy because of the
    // `osrs_` prefix, but be defensive).
    const direct = NpcType.getId(osrsDebugname);
    if (direct !== -1) {
        return direct;
    }
    // Strip the `osrs_` prefix and try again. Task 8's `ContentFolderWriter`
    // applies the `osrs_` prefix to every imported debugname; the legacy
    // NPC's debugname won't have that prefix.
    if (osrsDebugname.startsWith('osrs_')) {
        const stripped = osrsDebugname.slice('osrs_'.length);
        const strippedId = NpcType.getId(stripped);
        if (strippedId !== -1) {
            return strippedId;
        }
    }
    return -1;
}

/**
 * Process a single `*.deps.json` file. Returns an array of
 * `VariantEntry` instances — ONE per NPC node in the deps map that has
 * `transformedFrom` set (i.e. was successfully imported by Task 8).
 *
 * For a single-NPC trace (the common case — e.g. the Tormented Demon
 * pilot), the returned array has exactly one entry (the root NPC).
 *
 * For a batched trace (e.g. the Kalphite Queen pilot, where form 1 +
 * form 2 are in the same deps map), the returned array has one entry
 * per imported NPC form. This is the Task 11 extension — the original
 * Task 9/10 implementation only extracted the root NPC.
 *
 * Returns an empty array if the file should be skipped (root is not an
 * NPC, no NPC nodes have `transformedFrom` set, etc.).
 *
 * The `_contentDir` arg is accepted for symmetry with future
 * extensions (e.g. resolving absolute paths relative to the content
 * dir); today the function uses `process.cwd()` for the relative path
 * computation, so the arg is unused.
 */
function processDepsFile(depsFilePath: string, _contentDir: string): VariantEntry[] {
    let raw: string;
    try {
        raw = fs.readFileSync(depsFilePath, 'utf8');
    } catch (err) {
        printWarning(`  failed to read ${depsFilePath}: ${(err as Error).message}`);
        return [];
    }

    let parsed: DepsMap;
    try {
        parsed = JSON.parse(raw) as DepsMap;
    } catch (err) {
        printWarning(`  failed to parse ${depsFilePath}: ${(err as Error).message}`);
        return [];
    }

    if (parsed.version !== DEPS_SCHEMA_VERSION) {
        printWarning(`  skipping ${depsFilePath}: schema version ${parsed.version} ≠ expected ${DEPS_SCHEMA_VERSION}`);
        return [];
    }

    if (!parsed.root || parsed.root.kind !== 'npc') {
        printWarning(`  skipping ${depsFilePath}: root is not an NPC (got ${parsed.root?.kind ?? 'null'})`);
        return [];
    }

    // Walk EVERY NPC node in the deps map (not just the root) and
    // extract a variant entry for each one that has `transformedFrom`
    // set. This is the Task 11 extension — a single deps file may
    // contain multiple imported NPCs (e.g. KQ form 1 + form 2).
    const entries: VariantEntry[] = [];
    for (const key of Object.keys(parsed.nodes)) {
        const node = parsed.nodes[key];
        if (node.kind !== 'npc') {
            continue;
        }
        if (node.transformedFrom === null || node.transformedFrom === undefined) {
            continue;
        }
        if (typeof node.transformedFrom !== 'number') {
            printWarning(`  skipping ${depsFilePath} npc ${node.id}: transformedFrom is not a number (got ${typeof node.transformedFrom})`);
            continue;
        }
        const osrsNpcId = node.transformedFrom;
        const osrsDebugname: string = (node.name as string | null) ?? `osrs_npc_${osrsNpcId}`;
        const legacyNpcId = findLegacyNpcId(osrsDebugname);
        const legacyDebugname: string | null = legacyNpcId === -1
            ? null
            : (NpcType.get(legacyNpcId)?.debugname ?? null);

        // Relative path from the engine CWD (so variants.json is portable).
        const relPath = path.relative(process.cwd(), depsFilePath).replace(/\\/g, '/');

        // Use the deps file's mtime as the importedAt timestamp. Falls
        // back to "now" if mtime is unavailable.
        let importedAt: string;
        try {
            const stat = fs.statSync(depsFilePath);
            importedAt = stat.mtime.toISOString();
        } catch {
            importedAt = new Date().toISOString();
        }

        entries.push({
            legacyNpcId,
            osrsNpcId,
            osrsDebugname,
            legacyDebugname,
            depMapPath: relPath,
            importedAt
        });
    }
    return entries;
}

/**
 * Find all `*.deps.json` files in the content/deps dir, sorted by
 * filename for deterministic output. Returns an empty array if the
 * dir doesn't exist (the script then writes an empty variants.json).
 */
function findDepsFiles(depsDir: string): string[] {
    if (!fs.existsSync(depsDir)) {
        return [];
    }
    let files: string[];
    try {
        files = fs.readdirSync(depsDir);
    } catch (err) {
        printWarning(`failed to read deps dir ${depsDir}: ${(err as Error).message}`);
        return [];
    }
    return files
        .filter(f => f.endsWith('.deps.json'))
        .sort()
        .map(f => path.join(depsDir, f));
}

/**
 * Regenerate `content/deps/variants.json` by scanning every `*.deps.json`
 * file under `<contentDir>/deps/`.
 *
 * This is the canonical entry point — the CLI `main()` calls it with the
 * `--content-dir` flag value, and the Tormented Demon pilot calls it
 * directly (so it doesn't have to spawn a subprocess or call
 * `process.exit`).
 *
 * Pre-condition: `NpcType.load()` must have been called before this so the
 * legacy-debugname lookup in `findLegacyNpcId()` works. The CLI handles
 * this; direct callers must do it themselves.
 *
 * Linkages preservation (Task 11): if the existing `variants.json`
 * already has a `linkages` field (set by `VariantRegistry.linkVariants()`),
 * those linkages are PRESERVED across regeneration. The linkages field is
 * not derivable from the deps files alone — it's a runtime declaration
 * made by the import script after both forms are imported. Without this
 * preservation, re-running `regenerateIndex()` would silently drop all
 * linkages.
 *
 * @param contentDir  absolute path to the LostCity content/ folder.
 * @returns the number of variant entries written to variants.json.
 *         Logs warnings on missing/malformed deps files but does NOT throw.
 */
export function regenerateIndex(contentDir: string): number {
    const depsDir = path.join(contentDir, 'deps');
    const depsFiles = findDepsFiles(depsDir);
    printInfo(`Scanning ${depsFiles.length} deps file(s) in ${depsDir}...`);

    const entries: VariantEntry[] = [];
    let skipped = 0;
    for (const depsFile of depsFiles) {
        const fileEntries = processDepsFile(depsFile, contentDir);
        if (fileEntries.length > 0) {
            entries.push(...fileEntries);
            for (const entry of fileEntries) {
                printInfo(`  + ${path.basename(depsFile)}: legacy=${entry.legacyNpcId} osrs=${entry.osrsNpcId} ('${entry.osrsDebugname}')`);
            }
        } else {
            skipped++;
        }
    }

    // Deduplicate by osrsNpcId (last write wins — if two deps files
    // reference the same imported NPC ID, the later one in alphabetical
    // order wins). This shouldn't happen in normal use, but defensive.
    const seen = new Map<number, VariantEntry>();
    for (const e of entries) {
        seen.set(e.osrsNpcId, e);
    }
    const deduped = [...seen.values()];

    // Preserve existing linkages from the current variants.json (if any).
    // Linkages are a runtime declaration (set by `linkVariants()`) and
    // can't be re-derived from deps files alone — without this preservation,
    // re-running `regenerateIndex()` would silently drop them.
    const outPath = path.join(depsDir, 'variants.json');
    let preservedLinkages: [number, number][] | undefined;
    if (fs.existsSync(outPath)) {
        try {
            const existingRaw = fs.readFileSync(outPath, 'utf8');
            const existingParsed = JSON.parse(existingRaw) as VariantsFile;
            if (Array.isArray(existingParsed.linkages) && existingParsed.linkages.length > 0) {
                preservedLinkages = existingParsed.linkages;
            }
        } catch (err) {
            printWarning(`  failed to read existing variants.json for linkage preservation: ${(err as Error).message}`);
        }
    }

    // Write variants.json.
    const variantsFile: VariantsFile = {
        version: 1,
        variants: deduped
    };
    if (preservedLinkages) {
        variantsFile.linkages = preservedLinkages;
    }
    try {
        if (!fs.existsSync(depsDir)) {
            fs.mkdirSync(depsDir, { recursive: true });
        }
        fs.writeFileSync(outPath, JSON.stringify(variantsFile, null, 2) + '\n', 'utf8');
    } catch (err) {
        printError(`failed to write ${outPath}: ${(err as Error).message}`);
        return 0;
    }

    const linkageNote = preservedLinkages ? `, ${preservedLinkages.length} linkage(s) preserved` : '';
    printInfo(`Wrote ${outPath}: ${deduped.length} variant(s), ${skipped} deps file(s) skipped${linkageNote}.`);
    return deduped.length;
}

function main(): number {
    const { contentDir, showHelp } = parseArgs();
    if (showHelp) {
        printHelp();
        return 0;
    }

    // NpcType must be loaded for the legacy-debugname lookup to work.
    // The engine does this at startup; for this script we load it from
    // the standard pack dir.
    if (NpcType.count === 0) {
        printInfo('Loading NpcType from data/pack...');
        NpcType.load('data/pack');
    }
    if (NpcType.count === 0) {
        printWarning('NpcType is empty after load — legacy-debugname lookups will all miss (every NPC treated as brand-new)');
    }

    const count = regenerateIndex(contentDir);
    return count >= 0 ? 0 : 1;
}

// Only auto-run as a CLI when invoked directly (not when imported).
// `import.meta.main` is `true` when this file is the entrypoint module
// (i.e. `bun tools/osrs/UpdateVariantsIndex.ts`); it's `false` when this
// file is being imported as a module (e.g. by PilotTormentedDemon.ts,
// which calls `regenerateIndex()` directly without spawning a subprocess).
if (import.meta.main) {
    const exitCode = main();
    process.exit(exitCode);
}
