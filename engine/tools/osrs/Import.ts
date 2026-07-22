#!/usr/bin/env bun
/**
 * Import.ts — CLI entrypoint for the OSRS → 377 content-folder writer (Task 8).
 *
 * Walks a deps.json map (produced by Task 6's `Trace.ts`), fetches each OSRS
 * asset via Task 7's `OsrsCacheAssetReader`, transforms each to 377 bytes via
 * the OSRS decoder's `toLegacy377()` / `toLegacy377NpcConfig()`, and writes
 * the result to the LostCity content folder + pack files.
 *
 * Usage:
 *   bun tools/osrs/Import.ts --osrs-cache=<dir> --npc=<id> [--npc=<id2>]
 *                             [--deps=<path>] [--dry-run]
 *                             [--name-prefix=osrs_] [--group=osrs_imports]
 *
 * Flags:
 *   --osrs-cache=<dir>  OSRS cache directory (the one Task 7's reader opens).
 *                       If absent or unopenable, every read returns null —
 *                       the writer still walks the deps map and reports
 *                       every node as "failed: cache not available" without
 *                       crashing. This is the expected pre-cache pilot mode.
 *   --npc=<id>          OSRS NPC ID to import (required, repeatable for batch).
 *   --deps=<path>       Path to a pre-traced deps.json. If absent, the CLI
 *                       runs the tracer inline (Task 6's `DependencyTracer`)
 *                       to produce a fresh deps map. Default:
 *                       `content/deps/<npcName>.deps.json` (auto-traced).
 *   --dry-run           Do not write any files or modify pack files. Still
 *                       walks the deps map and produces an ImportResult
 *                       summary showing what WOULD be written.
 *   --name-prefix=<s>   Prefix for all debugnames (default: `osrs_`).
 *   --group=<name>      Subfolder under content/models/ and basename of the
 *                       .npc / .seq config files (default: `osrs_imports`).
 *   --out=<path>        Where to persist the updated deps.json (with
 *                       `transformedFrom` fields filled in). Default:
 *                       `content/deps/<npcName>.deps.json`.
 *   --help, -h          Show this help.
 *
 * Exit codes:
 *   0  — import completed (may still have failed[] entries; check the report)
 *   1  — bad args / IO error
 *   2  — writer threw (bug; please report)
 *
 * Examples:
 *   # Pre-cache pilot (no OSRS cache yet) — verifies the code path.
 *   bun tools/osrs/Import.ts --npc=9001 --dry-run --osrs-cache=/nonexistent
 *
 *   # Real import (after dropping the OSRS cache into data/osrs-cache/).
 *   bun tools/osrs/Import.ts --npc=9001 --osrs-cache=./data/osrs-cache
 *
 *   # Batch import of multiple NPCs into one group file.
 *   bun tools/osrs/Import.ts --npc=9001 --npc=9002 --group=td_batch \
 *       --osrs-cache=./data/osrs-cache
 */

import fs from 'fs';
import path from 'path';

import Environment from '#/util/Environment.js';
import { printError, printInfo, printWarning } from '#/util/Logger.js';

import OsrsCacheAssetReader from '#/cache/osrs/OsrsCacheAssetReader.js';
import { CacheReader, DependencyTracer } from './DependencyTracer.js';
import { DepsMap, DEPS_SCHEMA_VERSION } from './DepsSchema.js';
import { ContentFolderWriter, WriterOptions } from './ContentFolderWriter.js';
import { ImportResult } from './ImportResult.js';

/**
 * No-op CacheReader used when no OSRS cache is available. Mirrors the one
 * in `Trace.ts` — kept here so this CLI is self-contained (doesn't depend
 * on Trace.ts internals).
 */
class NullCacheReader implements CacheReader {
    readModel(): null { return null; }
    readAnim(): null { return null; }
    readAnimBase(): null { return null; }
    readSeq(): null { return null; }
    readNpc(): null { return null; }
    readObj(): null { return null; }
    readParam(): null { return null; }
    readStruct(): null { return null; }
    readTexture(): null { return null; }
    readParticle(): null { return null; }
    readSound(): null { return null; }
    getName(): null { return null; }
}

interface CliArgs {
    npcIds: number[];
    osrsCacheDir: string | null;
    depsPath: string | null;
    outPath: string | null;
    dryRun: boolean;
    namePrefix: string;
    group: string;
}

function parseArgs(argv: string[]): CliArgs {
    const npcIds: number[] = [];
    let osrsCacheDir: string | null = null;
    let depsPath: string | null = null;
    let outPath: string | null = null;
    let dryRun: boolean = false;
    let namePrefix: string = 'osrs_';
    let group: string = 'osrs_imports';

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--npc=')) {
            const v = parseInt(arg.substring('--npc='.length), 10);
            if (!Number.isFinite(v) || v < 0) {
                throw new Error(`Invalid --npc value: ${arg}`);
            }
            npcIds.push(v);
        } else if (arg.startsWith('--osrs-cache=')) {
            osrsCacheDir = arg.substring('--osrs-cache='.length);
        } else if (arg.startsWith('--deps=')) {
            depsPath = arg.substring('--deps='.length);
        } else if (arg.startsWith('--out=')) {
            outPath = arg.substring('--out='.length);
        } else if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg.startsWith('--name-prefix=')) {
            namePrefix = arg.substring('--name-prefix='.length);
        } else if (arg.startsWith('--group=')) {
            group = arg.substring('--group='.length);
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg} (try --help)`);
        }
    }

    return { npcIds, osrsCacheDir, depsPath, outPath, dryRun, namePrefix, group };
}

function printUsage(): void {
    const usage = [
        'Usage: bun tools/osrs/Import.ts --osrs-cache=<dir> --npc=<id> [--npc=<id2>]',
        '                                  [--deps=<path>] [--dry-run]',
        '                                  [--name-prefix=osrs_] [--group=osrs_imports]',
        '',
        'Flags:',
        '  --osrs-cache=<dir>  OSRS cache dir. Absent = null reader (pre-cache pilot).',
        '  --npc=<id>          OSRS NPC ID (required, repeatable for batch).',
        '  --deps=<path>       Pre-traced deps.json to use (skips the trace step).',
        '  --out=<path>        Where to persist the updated deps.json.',
        '  --dry-run           Do not write any files or modify pack files.',
        '  --name-prefix=<s>   Debugname prefix (default: osrs_).',
        '  --group=<name>      Subfolder under content/models + .npc/.seq basename.',
        '  --help, -h          Show this help.'
    ].join('\n');
    console.log(usage);
}

/**
 * Build a CacheReader from the --osrs-cache flag. Falls back to a
 * NullCacheReader if the flag is absent or the cache can't be opened.
 */
function buildReader(osrsCacheDir: string | null): CacheReader {
    if (!osrsCacheDir) {
        printWarning('Import: no --osrs-cache given; using NullCacheReader (every read will fail).');
        return new NullCacheReader();
    }
    const reader = new OsrsCacheAssetReader(osrsCacheDir);
    if (!reader.available) {
        printWarning(
            `Import: --osrs-cache=${osrsCacheDir} given but cache could not be opened ` +
            '(missing main_file_cache.dat2 / idx255?). Falling back to NullCacheReader.'
        );
        return new NullCacheReader();
    }
    printInfo(`Import: using OSRS cache at ${osrsCacheDir}`);
    return reader;
}

/**
 * Build a DepsMap for the given NPC IDs. If --deps is given, load it from
 * disk; otherwise run the tracer inline.
 */
function buildDepsMap(npcIds: number[], depsPath: string | null, reader: CacheReader): DepsMap {
    if (depsPath) {
        if (!fs.existsSync(depsPath)) {
            throw new Error(`--deps=${depsPath} does not exist`);
        }
        const text = fs.readFileSync(depsPath, 'utf8');
        const parsed = JSON.parse(text) as DepsMap;
        if (parsed.version !== DEPS_SCHEMA_VERSION) {
            printWarning(
                `Import: deps.json version ${parsed.version} != expected ${DEPS_SCHEMA_VERSION} — attempting anyway`
            );
        }
        printInfo(`Import: loaded deps map from ${depsPath}`);
        return parsed;
    }

    // Run the tracer inline.
    printInfo(`Import: tracing NPC ${npcIds.length === 1 ? npcIds[0] : npcIds.join(',')}...`);
    const tracer = new DependencyTracer(reader);
    const deps = npcIds.length === 1 ? tracer.trace(npcIds[0]) : tracer.traceMany(npcIds);
    return deps;
}

/**
 * Resolve the OSRS NPC's name for the output filename.
 */
function resolveNpcName(npcIds: number[], depsMap: DepsMap): string {
    if (npcIds.length === 0) {
        return 'unknown';
    }
    const rootKey = `npc:${npcIds[0]}`;
    const root = depsMap.nodes[rootKey];
    if (root?.name) {
        return root.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }
    return `npc_${npcIds[0]}`;
}

function defaultOutPath(npcName: string): string {
    return path.join(Environment.BUILD_SRC_DIR, 'deps', `${npcName}.deps.json`);
}

/**
 * Pretty-print an ImportResult summary.
 */
function summarize(result: ImportResult): string {
    const written = result.written.length;
    const skipped = result.skipped.length;
    const failed = result.failed.length;
    const packs = result.packUpdates.length;
    const packLines = result.packUpdates
        .map(p => `${p.pack}(+${p.added.length})`)
        .join(' ');
    return `written=${written} skipped=${skipped} failed=${failed} packs=${packs} [${packLines}]`;
}

function printDetailedReport(result: ImportResult): void {
    printInfo('--- ImportResult ---');
    printInfo(`  npc: ${result.npcId} (${result.npcName})`);
    printInfo(`  summary: ${summarize(result)}`);

    if (result.written.length > 0) {
        printInfo('  written:');
        for (const w of result.written) {
            printInfo(`    ${w.kind}:${w.osrsId} -> ${w.debugname} (id=${w.newId}) @ ${w.path}`);
        }
    }
    if (result.skipped.length > 0) {
        printInfo('  skipped:');
        for (const s of result.skipped) {
            printInfo(`    ${s.kind}:${s.osrsId} — ${s.reason}`);
        }
    }
    if (result.failed.length > 0) {
        printInfo('  failed:');
        for (const f of result.failed) {
            printInfo(`    ${f.kind}:${f.osrsId} — ${f.error}`);
        }
    }
    printInfo('--- end ---');
}

function main(): void {
    let args: CliArgs;
    try {
        args = parseArgs(process.argv);
    } catch (err) {
        printError(`Import: bad args — ${(err as Error).message}`);
        printUsage();
        process.exit(1);
    }

    if (args.npcIds.length === 0) {
        printError('Import: missing required --npc=<id> flag');
        printUsage();
        process.exit(1);
    }

    const reader = buildReader(args.osrsCacheDir);

    let depsMap: DepsMap;
    try {
        depsMap = buildDepsMap(args.npcIds, args.depsPath, reader);
    } catch (err) {
        printError(`Import: failed to build deps map — ${(err as Error).message}`);
        process.exit(1);
    }

    const npcName = resolveNpcName(args.npcIds, depsMap);
    const outPath = args.outPath ?? defaultOutPath(npcName);

    const writerOptions: WriterOptions = {
        dryRun: args.dryRun,
        namePrefix: args.namePrefix,
        groupFile: args.group,
        overwrite: false
    };

    const contentDir = Environment.BUILD_SRC_DIR;
    const writer = new ContentFolderWriter(contentDir, reader, writerOptions);

    let result: ImportResult;
    try {
        result = args.npcIds.length === 1
            ? writer.importNpc(args.npcIds[0], depsMap)
            : writer.importMany(args.npcIds, depsMap);
    } catch (err) {
        printError(`Import: writer threw — ${(err as Error).message}`);
        process.exit(2);
    }

    // Persist the updated deps.json (with transformedFrom fields filled in)
    // UNLESS this is a dry-run. The updated deps map is the source of
    // truth for the next run's idempotency check.
    if (!args.dryRun) {
        try {
            fs.mkdirSync(path.dirname(outPath) || '.', { recursive: true });
            fs.writeFileSync(outPath, JSON.stringify(result.depMapUpdated, null, 2));
            printInfo(`Import: wrote updated deps.json to ${outPath}`);
        } catch (err) {
            printError(`Import: failed to write ${outPath} — ${(err as Error).message}`);
            process.exit(1);
        }
    } else {
        printInfo(`Import: [dry-run] would write updated deps.json to ${outPath}`);
    }

    printInfo(`Import: ${summarize(result)}`);
    printDetailedReport(result);

    if (result.failed.length > 0) {
        printWarning(
            `Import: ${result.failed.length} asset(s) failed — see report above. ` +
            'The import is best-effort; failed assets are skipped.'
        );
    }
}

main();
