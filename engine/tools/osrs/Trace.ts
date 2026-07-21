#!/usr/bin/env bun
/**
 * Trace.ts — CLI entrypoint for the OSRS dependency tracer.
 *
 * Usage:
 *   bun tools/osrs/Trace.ts --npc=<id> [--out=<path>] [--osrs-cache=<dir>]
 *
 * Flags:
 *   --npc=<id>         NPC config ID to trace (required). Pass multiple
 *                      `--npc=` flags to batch-trace; the first becomes the
 *                      root, the rest are listed in `secondaryRoots`.
 *   --out=<path>       Output JSON path (default: content/deps/deps-<id>.json).
 *   --osrs-cache=<dir> Directory containing the OSRS cache files. If absent
 *                      (the default until Task 7 lands the OSRS cache port),
 *                      the tracer runs against a `NullCacheReader` that
 *                      returns null for every asset — exercising the full
 *                      code path but recording every node as `missing`.
 *                      This is the expected mode for the first pilot run.
 *
 * Examples:
 *   bun tools/osrs/Trace.ts --npc=9001
 *   bun tools/osrs/Trace.ts --npc=9001 --npc=9002 --out=/tmp/td-deps.json
 *   bun tools/osrs/Trace.ts --npc=9001 --osrs-cache=./data/osrs-cache
 *
 * Exit codes:
 *   0  — trace written successfully (may still report missing deps)
 *   1  — bad args / IO error
 *   2  — tracer threw (bug; please report)
 */

import fs from 'fs';
import path from 'path';

import Environment from '#/util/Environment.js';
import { printError, printInfo, printWarning } from '#/util/Logger.js';

import OsrsCacheAssetReader from '#/cache/osrs/OsrsCacheAssetReader.js';

import { CacheReader, DependencyTracer } from './DependencyTracer.js';
import { DepsMap } from './DepsSchema.js';

/**
 * No-op CacheReader used when no OSRS cache is available. Returns null for
 * every asset — the tracer will record every node as `missing: true`, which
 * is exactly what we want for the pre-cache pilot (verifies the code path
 * without requiring cache bytes).
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
    outPath: string | null;
    osrsCacheDir: string | null;
}

function parseArgs(argv: string[]): CliArgs {
    const npcIds: number[] = [];
    let outPath: string | null = null;
    let osrsCacheDir: string | null = null;

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--npc=')) {
            const v = parseInt(arg.substring('--npc='.length), 10);
            if (!Number.isFinite(v) || v < 0) {
                throw new Error(`Invalid --npc value: ${arg}`);
            }
            npcIds.push(v);
        } else if (arg.startsWith('--out=')) {
            outPath = arg.substring('--out='.length);
        } else if (arg.startsWith('--osrs-cache=')) {
            osrsCacheDir = arg.substring('--osrs-cache='.length);
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg} (try --help)`);
        }
    }

    return { npcIds, outPath, osrsCacheDir };
}

function printUsage(): void {
    const usage = [
        'Usage: bun tools/osrs/Trace.ts --npc=<id> [--out=<path>] [--osrs-cache=<dir>]',
        '',
        'Flags:',
        '  --npc=<id>         NPC config ID to trace (required, repeatable).',
        '  --out=<path>       Output JSON path (default: content/deps/deps-<id>.json).',
        '  --osrs-cache=<dir> OSRS cache dir. Absent = null reader (pre-cache pilot).',
        '  --help, -h         Show this help.'
    ].join('\n');
    console.log(usage);
}

function defaultOutPath(npcIds: number[]): string {
    const root = `${Environment.BUILD_SRC_DIR}/deps`;
    if (npcIds.length === 1) {
        return path.join(root, `deps-${npcIds[0]}.json`);
    }
    return path.join(root, `deps-batch-${npcIds[0]}-${npcIds[npcIds.length - 1]}.json`);
}

function buildReader(osrsCacheDir: string | null): CacheReader {
    if (!osrsCacheDir) {
        printWarning('Trace: no --osrs-cache given; using NullCacheReader (every node will be missing).');
        return new NullCacheReader();
    }
    // Task 7 wires up the real OSRS cache reader. If the cache dir doesn't
    // contain the expected files, OsrsCacheAssetReader fails gracefully
    // (returns null from every read) — equivalent to NullCacheReader, but
    // with a clearer diagnostic for the user.
    const reader = new OsrsCacheAssetReader(osrsCacheDir);
    if (!reader.available) {
        printWarning(
            `Trace: --osrs-cache=${osrsCacheDir} given but cache could not be opened ` +
            '(missing main_file_cache.dat2 / idx255?). Falling back to NullCacheReader.'
        );
        return new NullCacheReader();
    }
    printInfo(`Trace: using OSRS cache at ${osrsCacheDir}`);
    return reader;
}

function summarize(deps: DepsMap): string {
    const nodeCount = Object.keys(deps.nodes).length;
    const missingCount = deps.missing.length;
    const cycleCount = deps.cycles.length;
    const byKind: Record<string, number> = {};
    for (const k of Object.keys(deps.nodes)) {
        const kind = k.split(':')[0];
        byKind[kind] = (byKind[kind] ?? 0) + 1;
    }
    const breakdown = Object.entries(byKind)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
    return `nodes=${nodeCount} missing=${missingCount} cycles=${cycleCount} [${breakdown}]`;
}

function main(): void {
    let args: CliArgs;
    try {
        args = parseArgs(process.argv);
    } catch (err) {
        printError(`Trace: bad args — ${(err as Error).message}`);
        printUsage();
        process.exit(1);
    }

    if (args.npcIds.length === 0) {
        printError('Trace: missing required --npc=<id> flag');
        printUsage();
        process.exit(1);
    }

    const outPath = args.outPath ?? defaultOutPath(args.npcIds);
    const reader = buildReader(args.osrsCacheDir);
    const tracer = new DependencyTracer(reader);

    let deps: DepsMap;
    try {
        if (args.npcIds.length === 1) {
            deps = tracer.trace(args.npcIds[0]);
        } else {
            deps = tracer.traceMany(args.npcIds);
        }
    } catch (err) {
        printError(`Trace: tracer threw — ${(err as Error).message}`);
        process.exit(2);
    }

    const json = tracer.serialize(deps);

    try {
        fs.mkdirSync(path.dirname(outPath) || '.', { recursive: true });
        fs.writeFileSync(outPath, json);
    } catch (err) {
        printError(`Trace: failed to write ${outPath} — ${(err as Error).message}`);
        process.exit(1);
    }

    printInfo(`Trace: wrote ${outPath}`);
    printInfo(`Trace: ${summarize(deps)}`);

    if (deps.missing.length > 0) {
        const root = deps.root;
        printWarning(
            `Trace: ${deps.missing.length} missing dep(s) for ${root.kind}:${root.id}` +
            (root.name ? ` (${root.name})` : '') +
            ' — see deps.missing[] in the JSON output.'
        );
    }
}

main();
