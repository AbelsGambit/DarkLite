/**
 * Import report types for the OSRS → 377 content-folder writer (Task 8).
 *
 * An `ImportResult` is returned by `ContentFolderWriter.importNpc()` and
 * `ContentFolderWriter.importMany()`. It records every asset that was
 * written, skipped, or failed during a single import session, plus the
 * pack-file updates applied and the updated `DepsMap` (with `transformedFrom`
 * fields populated by the writer).
 *
 * The shape is deliberately verbose so that:
 *   - the CLI (`Import.ts`) can pretty-print a per-asset summary;
 *   - downstream tooling (variant registry, pilot runs) can scan the report
 *     for partial failures without re-walking the deps map;
 *   - the idempotency self-test can assert "second run produced zero writes".
 */

import type { NodeKind } from './DepsSchema.js';
import type { DepsMap } from './DepsSchema.js';

/**
 * One entry in the `written[]` array — an asset that was successfully
 * transformed and written to the content folder.
 */
export interface WrittenEntry {
    /** Asset kind (npc/model/anim/seq/anim-base/...). */
    kind: NodeKind;
    /** OSRS cache ID of the source asset. */
    osrsId: number | string;
    /** Newly-assigned 377 pack-file ID. */
    newId: number;
    /** Newly-assigned debugname (sanitized, with `osrs_` prefix). */
    debugname: string;
    /** Absolute path of the file written (or `<dryrun>` if dry-run). */
    path: string;
}

/**
 * One entry in the `skipped[]` array — an asset that was intentionally not
 * written. The most common reason is `already_imported` (the node already
 * had `transformedFrom` set from a prior run — idempotency).
 */
export interface SkippedEntry {
    /** Asset kind. */
    kind: NodeKind;
    /** OSRS cache ID. */
    osrsId: number | string;
    /** Why the asset was skipped (e.g. 'already_imported', 'dry_run'). */
    reason: string;
}

/**
 * One entry in the `failed[]` array — an asset whose fetch / transform /
 * write raised an error or returned null. The error message is captured
 * verbatim so the CLI can surface it without crashing.
 */
export interface FailedEntry {
    /** Asset kind. */
    kind: NodeKind;
    /** OSRS cache ID. */
    osrsId: number | string;
    /** Error message (or 'cache not available' / 'decode returned null'). */
    error: string;
}

/**
 * One entry in the `packUpdates[]` array — a pack file that was modified
 * during the import. Each entry records the pack name (e.g. 'model') and
 * the list of `{ id, name }` pairs that were added.
 *
 * Note: a single import may add entries to MULTIPLE pack files (npc, model,
 * anim, animset, seq). Each affected pack gets its own entry here.
 */
export interface PackUpdate {
    /** Pack type (e.g. 'npc', 'model', 'anim', 'animset', 'seq', 'base'). */
    pack: string;
    /** Entries added to the pack during this import. */
    added: { id: number; name: string }[];
}

/**
 * The full import report.
 *
 * - `npcId` / `npcName` describe the import root. For `importMany()`, the
 *   primary NPC (first in the batch) is reported here; secondary NPCs are
 *   listed in the `written[]` array as `kind: 'npc'` entries.
 * - `written` / `skipped` / `failed` are flat lists across all asset kinds.
 *   Ordering is deterministic: models first, then anims, then anim-bases,
 *   then seqs, then NPC config(s) last.
 * - `packUpdates` records which pack files were touched — used by the CLI
 *   to print a "modified packs" summary.
 * - `depMapUpdated` is a deep-cloned copy of the input `DepsMap` with every
 *   successfully-imported OSRS node's `transformedFrom` field set to its
 *   newly-assigned 377 ID. The caller is expected to persist this back to
 *   `content/deps/<name>.deps.json` so subsequent runs are idempotent.
 */
export interface ImportResult {
    /** OSRS NPC ID of the import root (primary NPC for batch imports). */
    npcId: number;
    /** Display name of the import root (from the OSRS NPC config). */
    npcName: string;
    /** Assets written to disk this run. */
    written: WrittenEntry[];
    /** Assets intentionally skipped (e.g. already imported). */
    skipped: SkippedEntry[];
    /** Assets that failed to fetch / transform / write. */
    failed: FailedEntry[];
    /** Pack files modified during this import. */
    packUpdates: PackUpdate[];
    /**
     * Updated deps map — a deep clone of the input map with every
     * successfully-imported OSRS node's `transformedFrom` field set to the
     * newly-assigned 377 ID. Persist this to `content/deps/<name>.deps.json`
     * so subsequent runs detect the prior import via `transformedFrom !== null`.
     */
    depMapUpdated: DepsMap;
}

/**
 * Helper: create an empty `ImportResult` with the given root identity.
 * Used by the writer to bootstrap the result before processing nodes.
 */
export function emptyImportResult(npcId: number, npcName: string, depsMap: DepsMap): ImportResult {
    // Deep-clone the deps map by JSON round-trip. The deps map is plain
    // JSON-serializable data (no class instances), so this is safe.
    const depMapUpdated: DepsMap = JSON.parse(JSON.stringify(depsMap)) as DepsMap;
    return {
        npcId,
        npcName,
        written: [],
        skipped: [],
        failed: [],
        packUpdates: [],
        depMapUpdated
    };
}
