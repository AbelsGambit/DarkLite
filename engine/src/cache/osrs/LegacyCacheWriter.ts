import fs from 'fs';

import FileStream from '#/io/FileStream.js';
import Jagfile from '#/io/Jagfile.js';
import Packet from '#/io/Packet.js';
import { compressGz } from '#/io/GZip.js';
import { printWarning } from '#/util/Logger.js';

/**
 * 377 archive slot map used by `LegacyCacheWriter`.
 *
 * Mirrors the layout used by the existing LostCity pack tooling
 * (`engine/tools/pack/graphics/pack.ts`, `engine/tools/pack/config/PackShared.ts`):
 *
 * | Archive | Contents                                       |
 * |---------|------------------------------------------------|
 * | 0       | Versionlist jagfiles (file 2 = config jagfile) |
 * | 1       | Models (one .ob2 per file ID, gzip-compressed) |
 * | 2       | Animation sets (one .anim per file ID, gzipped) |
 * | 3       | Midi                                            |
 * | 4       | Maps                                            |
 *
 * This is the cache that gets SERVED to the 377 Java client via the
 * on-demand fetcher. It is distinct from the OSRS source cache that
 * `OsrsCacheReader` consumes — this writer emits 377-format bytes that
 * the existing client can render.
 */
const ARCHIVE_VERSIONLIST = 0;
const ARCHIVE_MODELS = 1;
const ARCHIVE_ANIMS = 2;

/** File ID within archive 0 of the config jagfile (npc.dat/npc.idx/etc.). */
const FILE_CONFIG_JAGFILE = 2;

/**
 * Default version trailer for written models/anims.
 *
 * The 377 client expects a 2-byte version trailer on every model and anim
 * file (set to 1 by `engine/tools/pack/graphics/pack.ts`). Callers can
 * override per-call if they need a different version.
 */
const DEFAULT_MODEL_VERSION = 1;
const DEFAULT_ANIM_VERSION = 1;

/**
 * Thin wrapper around `FileStream` that writes transformed 377-compatible
 * asset bytes into the correct archive slots.
 *
 * Used by Task 8 (content-folder writer) to emit the transformed output of
 * `OsrsModel.toLegacy377()` / `OsrsAnimFrame.toLegacy377()` / etc. into the
 * live 377 cache that the on-demand fetcher serves to the Java client.
 *
 * Constructor creates the cache directory if missing (delegating to
 * `FileStream`'s own dir-init logic), so it's safe to point at a fresh temp
 * dir for testing.
 */
export default class LegacyCacheWriter {
    private readonly cacheDir: string;
    private readonly cache: FileStream;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
        // FileStream's constructor creates the dir + empty cache files if
        // they don't already exist (see FileStream.ts:14-25).
        this.cache = new FileStream(cacheDir, false, false);
    }

    /** Expose the underlying FileStream for direct archive access. */
    get raw(): FileStream {
        return this.cache;
    }

    /** Path the writer was constructed with. */
    get dir(): string {
        return this.cacheDir;
    }

    /**
     * Write a 377-format model blob to archive 1, file `id`.
     *
     * The bytes should already be in 377 `.ob2` format (i.e. the output of
     * `OsrsModel.toLegacy377()`). This method gzip-compresses them and writes
     * them with the version trailer, mirroring
     * `engine/tools/pack/graphics/pack.ts:18`.
     *
     * @param id          model file ID (matches `ModelPack.getByName(...)`)
     * @param legacyBytes raw 377 `.ob2` bytes (uncompressed)
     * @param version     2-byte version trailer value (default 1, matching
     *                    the existing 377 cache format)
     */
    writeModel(id: number, legacyBytes: Uint8Array, version: number = DEFAULT_MODEL_VERSION): void {
        const compressed = compressGz(legacyBytes);
        if (!compressed) {
            printWarning(`LegacyCacheWriter: gzip failed for model ${id}`);
            return;
        }
        this.cache.write(ARCHIVE_MODELS, id, compressed, version);
    }

    /**
     * Write a 377-format anim blob to archive 2, file `id`.
     *
     * The bytes should already be in 377 `.anim` format (i.e. the output of
     * `OsrsAnimFrame.toLegacy377()`). Mirrors
     * `engine/tools/pack/graphics/pack.ts:38`.
     *
     * @param id          anim file ID (matches `AnimSetPack.getByName(...)`)
     * @param legacyBytes raw 377 `.anim` bytes (uncompressed)
     * @param version     2-byte version trailer value (default 1)
     */
    writeAnim(id: number, legacyBytes: Uint8Array, version: number = DEFAULT_ANIM_VERSION): void {
        const compressed = compressGz(legacyBytes);
        if (!compressed) {
            printWarning(`LegacyCacheWriter: gzip failed for anim ${id}`);
            return;
        }
        this.cache.write(ARCHIVE_ANIMS, id, compressed, version);
    }

    /**
     * Write `npc.dat` + `npc.idx` into the config jagfile at archive 0,
     * file 2.
     *
     * Merges with the existing config jagfile if one is already present
     * (preserving `seq.dat`, `obj.dat`, `varp.dat`, etc.); otherwise builds
     * a fresh jagfile containing only `npc.dat` + `npc.idx`.
     *
     * The jagfile is saved to a temp file, read back as raw bytes, then
     * written via `FileStream.write(0, 2, jagfileBytes)`. The temp file is
     * removed after writing.
     *
     * @param npcDat serialized npc.dat (u16 count + per-npc opcodes ending in 0)
     * @param npcIdx serialized npc.idx (u16 count + per-npc u16 length)
     */
    writeNpcConfig(npcDat: Uint8Array, npcIdx: Uint8Array): void {
        const jag = Jagfile.new(false);

        // Merge with existing config jagfile if present.
        const existingBytes = this.cache.read(ARCHIVE_VERSIONLIST, FILE_CONFIG_JAGFILE);
        if (existingBytes) {
            try {
                const existing = new Jagfile(new Packet(existingBytes));
                for (let i = 0; i < existing.fileCount; i++) {
                    const name = existing.fileName[i];
                    if (!name || name === 'npc.dat' || name === 'npc.idx') {
                        continue;
                    }
                    const data = existing.get(i);
                    if (data) {
                        // Jagfile.write() reads `src.data.subarray(0, src.pos)`,
                        // so we must seek to end before passing the packet.
                        data.pos = data.length;
                        jag.write(name, data);
                    }
                }
            } catch (err) {
                printWarning(
                    'LegacyCacheWriter: failed to merge existing config jagfile ' +
                        '(will overwrite): ' + (err as Error).message
                );
                // Fall through — start fresh with just npc.dat/npc.idx.
            }
        }

        // Add the new npc.dat + npc.idx.
        const npcDatPkt = new Packet(npcDat);
        npcDatPkt.pos = npcDatPkt.length;
        jag.write('npc.dat', npcDatPkt);

        const npcIdxPkt = new Packet(npcIdx);
        npcIdxPkt.pos = npcIdxPkt.length;
        jag.write('npc.idx', npcIdxPkt);

        // Save to a temp file, read back as raw bytes, write to cache.
        const tmpPath = `${this.cacheDir}/.tmp-config-jag-${Date.now()}`;
        try {
            jag.save(tmpPath);
            const jagBytes = fs.readFileSync(tmpPath);
            this.cache.write(ARCHIVE_VERSIONLIST, FILE_CONFIG_JAGFILE, jagBytes);
        } finally {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
            }
        }
    }

    /**
     * Write a pre-built config jagfile directly to archive 0, file 2.
     *
     * Advanced variant of `writeNpcConfig` for callers that want to build
     * the complete jagfile themselves (e.g. when re-packing all config types
     * at once via `engine/tools/pack/config/PackShared.ts`).
     */
    writeConfigJagfile(jagPath: string): void {
        const jagBytes = fs.readFileSync(jagPath);
        this.cache.write(ARCHIVE_VERSIONLIST, FILE_CONFIG_JAGFILE, jagBytes);
    }

    /**
     * Read back a model from archive 1 — used by self-tests to round-trip
     * a written blob. Returns the decompressed bytes (or null on miss).
     */
    readModelForTest(id: number): Uint8Array | null {
        return this.cache.read(ARCHIVE_MODELS, id, true);
    }

    /**
     * Read back an anim from archive 2 — used by self-tests.
     */
    readAnimForTest(id: number): Uint8Array | null {
        return this.cache.read(ARCHIVE_ANIMS, id, true);
    }

    /**
     * Read back the config jagfile from archive 0, file 2 — used by self-tests.
     */
    readConfigJagfileForTest(): Uint8Array | null {
        return this.cache.read(ARCHIVE_VERSIONLIST, FILE_CONFIG_JAGFILE);
    }
}
