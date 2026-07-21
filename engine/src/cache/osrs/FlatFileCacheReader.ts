import fs from 'fs';
import path from 'path';

import BZip2 from '#/io/BZip2.js';
import Packet from '#/io/Packet.js';
import { decompressGz } from '#/io/GZip.js';
import { printWarning } from '#/util/Logger.js';

import type { ArchiveReadResult, Index255Entry } from '#/cache/osrs/OsrsCacheReader.js';

/**
 * Compression types for the JS5 container wrapper (same as OsrsCacheReader).
 *
 * Every flat file in the cache is wrapped in a container:
 *   u8  compression (0=NONE, 1=BZIP2, 2=GZIP)
 *   u32 compressedSize
 *   [u32 decompressedSize]  ← only when compression != NONE
 *   compressed payload (compressedSize bytes)
 *   [u16 version]           ← optional trailer
 *
 * The BZIP2 payload has its "BZh1" magic stripped by the OSRS packer.
 */
const COMPRESSION_NONE = 0;
const COMPRESSION_BZIP2 = 1;
const COMPRESSION_GZIP = 2;

const MAX_FILE_SIZE = 50_000_000;

/**
 * Flat-file OSRS cache reader.
 *
 * Reads a cache stored as individual `<index>/<file>.dat` files (each
 * containing the raw container wrapper), as opposed to the sector-chained
 * `main_file_cache.dat2` + `main_file_cache.idxN` layout that
 * `OsrsCacheReader` consumes.
 *
 * This layout is produced by OpenRS2 / Displee-style extractors and is what
 * the user's GitHub cache depot ships (`AbelsGambit/DarkLite/.../cache/`).
 * Each `<index>/<file>.dat` is the raw container bytes for that single
 * (index, file) pair — no sector walking needed.
 *
 * The reference table for index N is at `255/N.dat` (decompressed → protocol-7
 * reference table, same format as `OsrsCacheReader.parseMasterIndex()`).
 *
 * API mirrors `OsrsCacheReader` so the two are interchangeable as
 * `CacheReader` sources for the import pipeline. The only difference is
 * construction: pass the `cache/` directory path (the one containing `0/`,
 * `1/`, ..., `255/` subdirectories).
 */
export default class FlatFileCacheReader {
    private readonly cacheDir: string;

    /** True once the cache directory exists and contains at least `255/`. */
    private available: boolean = false;

    /**
     * Per-index reference tables, lazy-cached. Same semantics as
     * `OsrsCacheReader.refTableCache`: missing key = not yet loaded,
     * present empty array = loaded but empty/failed.
     */
    private refTableCache: Map<number, Index255Entry[]> = new Map();

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;

        if (!fs.existsSync(cacheDir)) {
            return;
        }

        const idx255Path = path.join(cacheDir, '255');
        if (!fs.existsSync(idx255Path)) {
            return;
        }

        this.available = true;
    }

    /** True if the cache directory was successfully opened. */
    get isAvailable(): boolean {
        return this.available;
    }

    /** Path the reader was constructed with (for diagnostics). */
    get dir(): string {
        return this.cacheDir;
    }

    /**
     * Number of files in an index. Counts `.dat` files in `<cacheDir>/<archive>/`.
     * Returns 0 if the index directory doesn't exist.
     */
    count(archive: number): number {
        const dir = path.join(this.cacheDir, String(archive));
        if (!fs.existsSync(dir)) {
            return 0;
        }
        try {
            const files = fs.readdirSync(dir);
            return files.filter(f => f.endsWith('.dat')).length;
        } catch {
            return 0;
        }
    }

    /**
     * Cheap "does this file exist?" check.
     */
    has(archive: number, file: number): boolean {
        const filePath = path.join(this.cacheDir, String(archive), `${file}.dat`);
        return fs.existsSync(filePath);
    }

    /**
     * Read a single file from an archive, decompressing the container.
     *
     * Returns the decompressed payload (no container wrapper, no version
     * trailer), or null on any error / missing file.
     */
    read(archive: number, file: number): Uint8Array | null {
        const raw = this.readRaw(archive, file);
        if (!raw) {
            return null;
        }
        return this.readContainer(raw);
    }

    /**
     * Read a single file's raw container bytes (no decompression).
     */
    readRaw(archive: number, file: number): Uint8Array | null {
        const filePath = path.join(this.cacheDir, String(archive), `${file}.dat`);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        try {
            const buf = fs.readFileSync(filePath);
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        } catch (err) {
            printWarning(`FlatFileCacheReader: failed to read ${archive}/${file}.dat: ${(err as Error).message}`);
            return null;
        }
    }

    /**
     * Read a multi-child archive group and split it into named children.
     * Mirrors `OsrsCacheReader.readArchive()`.
     */
    readArchive(archive: number, file: number): ArchiveReadResult | null {
        const decompressed = this.read(archive, file);
        if (!decompressed) {
            return null;
        }

        const childIds = this.lookupChildIds(archive, file);
        const split = this.splitArchive(decompressed, childIds);
        if (!split) {
            return null;
        }
        return { children: split };
    }

    /**
     * Read the reference table for a specific index from `255/<index>.dat`.
     * Mirrors `OsrsCacheReader.readIndex255(index)`.
     */
    readIndex255(index: number = 0): Index255Entry[] {
        const cached = this.refTableCache.get(index);
        if (cached !== undefined) {
            return cached;
        }
        this.refTableCache.set(index, []);

        if (!this.available) {
            return this.refTableCache.get(index)!;
        }

        const raw = this.readRaw(255, index);
        if (!raw) {
            return this.refTableCache.get(index)!;
        }

        const decompressed = this.readContainer(raw);
        if (!decompressed) {
            printWarning(`FlatFileCacheReader: failed to decompress reference table for index ${index}`);
            return this.refTableCache.get(index)!;
        }

        const entries = this.parseMasterIndex(decompressed);
        if (entries === null) {
            printWarning(`FlatFileCacheReader: failed to parse reference table for index ${index}`);
            return this.refTableCache.get(index)!;
        }

        this.refTableCache.set(index, entries);
        return entries;
    }

    /** Look up child IDs for an archive within an index. */
    private lookupChildIds(index: number, archive: number): number[] | null {
        const entries = this.readIndex255(index);
        for (const entry of entries) {
            if (entry.archive === archive) {
                return entry.childIds;
            }
        }
        return null;
    }

    /**
     * Strip a container wrapper and decompress the payload.
     * Same logic as `OsrsCacheReader.readContainer()`.
     */
    private readContainer(data: Uint8Array): Uint8Array | null {
        if (data.length < 5) {
            return null;
        }

        const packet = new Packet(data);
        const compression = packet.g1();
        const compressedSize = packet.g4();

        let decompressedSize = compressedSize;
        let payloadStart = packet.pos;

        if (compression !== COMPRESSION_NONE) {
            decompressedSize = packet.g4();
            payloadStart = packet.pos;
        }

        const payloadEnd = payloadStart + compressedSize;

        if (decompressedSize < 0 || decompressedSize > MAX_FILE_SIZE) {
            printWarning(`FlatFileCacheReader: invalid decompressed size ${decompressedSize}`);
            return null;
        }

        if (payloadEnd > data.length) {
            printWarning(`FlatFileCacheReader: payload extends beyond data (${payloadEnd} > ${data.length})`);
            return null;
        }

        switch (compression) {
            case COMPRESSION_NONE:
                return data.subarray(payloadStart, payloadEnd);

            case COMPRESSION_BZIP2: {
                const compressed = data.subarray(payloadStart, payloadEnd);
                try {
                    return BZip2.decompress(compressed, decompressedSize, true);
                } catch (err) {
                    printWarning(`FlatFileCacheReader: BZIP2 decompress failed: ${(err as Error).message}`);
                    return null;
                }
            }

            case COMPRESSION_GZIP: {
                const compressed = data.subarray(payloadStart, payloadEnd);
                const out = decompressGz(compressed);
                if (!out) {
                    printWarning('FlatFileCacheReader: GZIP decompress failed');
                    return null;
                }
                return out;
            }

            default:
                printWarning(`FlatFileCacheReader: unknown compression type ${compression}`);
                return null;
        }
    }

    /**
     * Parse the decompressed reference table (protocol 5/6/7).
     * Same logic as `OsrsCacheReader.parseMasterIndex()`.
     */
    private parseMasterIndex(data: Uint8Array): Index255Entry[] | null {
        if (data.length < 1) {
            return null;
        }

        const packet = new Packet(data);
        const protocol = packet.g1();
        if (protocol < 5 || protocol > 7) {
            printWarning(`FlatFileCacheReader: unsupported reference table protocol ${protocol}`);
            return null;
        }

        const hasRevision = protocol >= 6;
        if (hasRevision) {
            packet.g4();
        }

        const mask = packet.g1();
        const named = (mask & 0x01) !== 0;
        const hasWhirlpool = (mask & 0x02) !== 0;
        const hasLengths = (mask & 0x04) !== 0;

        const readSmart = (): number => {
            if (protocol >= 7) {
                const peek = data[packet.pos];
                if (peek < 128) {
                    return packet.g2();
                } else {
                    return packet.g4() & 0x7FFFFFFF;
                }
            } else {
                return packet.g2();
            }
        };

        const archiveCount = readSmart();
        if (archiveCount < 0 || archiveCount > 100_000) {
            printWarning(`FlatFileCacheReader: implausible archive count ${archiveCount}`);
            return null;
        }

        const archiveIds: number[] = new Array(archiveCount);
        let prevArchiveId = 0;
        for (let i = 0; i < archiveCount; i++) {
            prevArchiveId += readSmart();
            archiveIds[i] = prevArchiveId;
        }

        const entries: Index255Entry[] = [];
        for (let i = 0; i < archiveCount; i++) {
            entries.push({
                archive: archiveIds[i],
                crc: 0,
                version: 0,
                nameHash: 0,
                childCount: 0,
                childIds: [],
                childNameHashes: []
            });
        }

        if (named) {
            for (let i = 0; i < archiveCount; i++) {
                entries[i].nameHash = packet.g4();
            }
        }

        for (let i = 0; i < archiveCount; i++) {
            entries[i].crc = packet.g4();
        }

        if (hasWhirlpool) {
            for (let i = 0; i < archiveCount; i++) {
                packet.pos += 64;
            }
        }

        if (hasLengths) {
            for (let i = 0; i < archiveCount; i++) {
                packet.g4();
                packet.g4();
            }
        }

        if (hasRevision) {
            for (let i = 0; i < archiveCount; i++) {
                entries[i].version = packet.g4();
            }
        }

        const childCounts: number[] = new Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            childCounts[i] = readSmart();
            entries[i].childCount = childCounts[i];
        }

        for (let i = 0; i < archiveCount; i++) {
            const childCount = childCounts[i];
            const childIds: number[] = new Array(childCount);
            let prevChildId = 0;
            for (let j = 0; j < childCount; j++) {
                prevChildId += readSmart();
                childIds[j] = prevChildId;
            }
            entries[i].childIds = childIds;
        }

        if (named) {
            for (let i = 0; i < archiveCount; i++) {
                const childCount = childCounts[i];
                const childNameHashes: number[] = new Array(childCount);
                for (let j = 0; j < childCount; j++) {
                    childNameHashes[j] = packet.g4();
                }
                entries[i].childNameHashes = childNameHashes;
            }
        }

        return entries;
    }

    /**
     * Split a decompressed multi-child archive group into per-child bytes.
     * Same logic as `OsrsCacheReader.splitArchive()` — ported from RuneLite's
     * `ArchiveFiles.loadContents()`.
     */
    private splitArchive(data: Uint8Array, childIds: number[] | null): Map<number, Uint8Array> | null {
        if (data.length < 1) {
            return null;
        }

        const childCount = childIds ? childIds.length : 0;

        if (childCount <= 1) {
            const out = new Map<number, Uint8Array>();
            const id = childIds && childIds.length > 0 ? childIds[0] : 0;
            out.set(id, data);
            return out;
        }

        const chunks = data[data.length - 1] & 0xFF;
        const tableOffset = data.length - 1 - chunks * childCount * 4;
        if (tableOffset < 0) {
            printWarning(`FlatFileCacheReader: archive too short for chunk table`);
            return null;
        }

        const chunkSizes: Int32Array[] = new Array(childCount);
        const filesSize = new Int32Array(childCount);
        for (let i = 0; i < childCount; i++) {
            chunkSizes[i] = new Int32Array(chunks);
        }

        let pos = tableOffset;
        for (let chunk = 0; chunk < chunks; chunk++) {
            let chunkSize = 0;
            for (let id = 0; id < childCount; id++) {
                const delta = ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) | 0;
                pos += 4;
                chunkSize += delta;
                chunkSizes[id][chunk] = chunkSize;
                filesSize[id] += chunkSize;
            }
        }

        for (let i = 0; i < childCount; i++) {
            if (filesSize[i] < 0 || filesSize[i] > MAX_FILE_SIZE) {
                printWarning(`FlatFileCacheReader: child ${i} has invalid size ${filesSize[i]}`);
                return null;
            }
        }

        const fileContents: Uint8Array[] = new Array(childCount);
        const fileOffsets = new Int32Array(childCount);
        for (let i = 0; i < childCount; i++) {
            fileContents[i] = new Uint8Array(filesSize[i]);
        }

        pos = 0;
        for (let chunk = 0; chunk < chunks; chunk++) {
            for (let id = 0; id < childCount; id++) {
                // chunkSizes[id][chunk] IS the file's actual size in this chunk
                // (it's the cumulative sum of deltas, which recovers the file size).
                // Do NOT subtract prevChunkSize — that would give the delta, not the size.
                const sz = chunkSizes[id][chunk];
                if (sz > 0 && pos + sz <= tableOffset) {
                    fileContents[id].set(data.subarray(pos, pos + sz), fileOffsets[id]);
                    fileOffsets[id] += sz;
                    pos += sz;
                }
            }
        }

        const out = new Map<number, Uint8Array>();
        for (let i = 0; i < childCount; i++) {
            const id = childIds && i < childIds.length ? childIds[i] : i;
            out.set(id, fileContents[i]);
        }
        return out;
    }

    /** Release resources (no-op for flat files — nothing to close). */
    close(): void {
        this.refTableCache.clear();
        this.available = false;
    }
}
