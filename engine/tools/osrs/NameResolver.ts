/**
 * NameResolver — small helper that maps OSRS asset IDs to their
 * newly-assigned 377 debugnames during a content-folder import (Task 8).
 *
 * The OSRS-side `toLegacy377NpcConfig()` (Task 5-c) emits raw integer asset
 * IDs in its output lines (e.g. `model1=45000`, `readyanim=9100`). The
 * LostCity content folder, however, requires those refs to be debugnames
 * (e.g. `model1=osrs_td_body`, `readyanim=osrs_td_stand`) — the config
 * parser uses `ModelPack.getByName()` / `SeqPack.getByName()` to resolve
 * names to IDs at pack time.
 *
 * `NameResolver` is the bridge: as the writer transforms each OSRS asset
 * and assigns it a new debugname + pack ID, it calls
 * `resolver.register(kind, osrsId, newId, debugname)`. Later, when the
 * NPC config emitter walks the `toLegacy377NpcConfig()` output lines and
 * hits `model1=45000`, it calls `resolver.lookup('model', 45000)` to get
 * back `{ newId, debugname }` and rewrites the line.
 *
 * Lookups for kinds/IDs that weren't registered return `null` — the caller
 * is expected to fall back to a `model_<id>` / `seq_<id>` literal (which
 * the LostCity parser also accepts) or skip the rewrite.
 *
 * Why a separate class instead of just walking the deps map?
 *   - The deps map's `transformedFrom` field stores only the NEW ID, not
 *     the debugname. Resolving the debugname would require a pack-file
 *     lookup on every line rewrite. Keeping a side-table avoids that.
 *   - The writer may register multiple aliases (e.g. an OSRS model that's
 *     referenced both as a body model and a head model by the same NPC);
 *     the side-table makes "OSRS ID X → new debugname Y" a single O(1)
 *     lookup regardless of how many times it's referenced.
 *   - Cross-NPC imports (batch mode) need to share the table so that an
 *     OSRS model imported for NPC A is reused — not duplicated — when NPC
 *     B references the same OSRS model ID.
 */

import type { NodeKind } from './DepsSchema.js';

/**
 * A resolved name lookup result.
 *
 * - `newId`     : the pack-file ID assigned to the imported asset.
 * - `debugname` : the sanitized debugname (with `osrs_` prefix).
 */
export interface ResolvedName {
    newId: number;
    debugname: string;
}

export default class NameResolver {
    /** Side-table: `${kind}:${osrsId}` → resolved name. */
    private readonly table: Map<string, ResolvedName> = new Map();

    /**
     * Canonical key for the side-table. Mirrors `nodeKey()` from
     * `DepsSchema.ts` so callers can compute the same key for both lookups.
     */
    static key(kind: NodeKind, osrsId: number | string): string {
        return `${kind}:${osrsId}`;
    }

    /**
     * Look up a previously-registered name.
     * Returns `null` if no entry exists for this kind+osrsId.
     */
    lookup(kind: NodeKind, osrsId: number | string): ResolvedName | null {
        return this.table.get(NameResolver.key(kind, osrsId)) ?? null;
    }

    /**
     * Register a name mapping. If an entry already exists for this
     * kind+osrsId, it is overwritten (the latest registration wins).
     * This is intentional: in batch mode, if NPC A imports OSRS model 45000
     * as `osrs_td_body` and NPC B later references the same model, the
     * writer will look up the existing entry BEFORE calling register, so
     * the overwrite path is never hit in practice.
     */
    register(kind: NodeKind, osrsId: number | string, newId: number, debugname: string): void {
        this.table.set(NameResolver.key(kind, osrsId), { newId, debugname });
    }

    /** Returns true if a mapping exists for this kind+osrsId. */
    has(kind: NodeKind, osrsId: number | string): boolean {
        return this.table.has(NameResolver.key(kind, osrsId));
    }

    /** Number of registered mappings. Mainly for diagnostics / self-tests. */
    get size(): number {
        return this.table.size;
    }

    /**
     * Snapshot the table as a plain object (kind:id → { newId, debugname }).
     * Used by the self-test to assert state after a run.
     */
    snapshot(): Record<string, ResolvedName> {
        const out: Record<string, ResolvedName> = {};
        for (const [k, v] of this.table) {
            out[k] = v;
        }
        return out;
    }
}
