import fs from 'fs';

import BZip2 from '#/io/BZip2.js';
import Packet from '#/io/Packet.js';
import { decompressGz } from '#/io/GZip.js';
import RandomAccessFile from '#/util/RandomAccessFile.js';
import { printWarning } from '#/util/Logger.js';

/**
 * JS5 container compression types.
 *
 * Every file/group in an OSRS cache is wrapped in a "container":
 *   u8  compression (0=NONE, 1=BZIP2, 2=GZIP)
 *   u32 uncompressedLength
 *   ... compressed payload (or raw bytes if NONE)
 *   u16 version trailer (optional — present when the writer set a non-zero version)
 *
 * The BZIP2 payload has its leading "BZh1" magic stripped by the OSRS packer.
 * We restore the magic via `BZip2.decompress(..., prependHeader=true)` before
 * handing the bytes to the bzip2 codec.
 */
const COMPRESSION_NONE = 0;
const COMPRESSION_BZIP2 = 1;
const COMPRESSION_GZIP = 2;

/**
 * JS5 sector geometry.
 *
 * Each sector in `main_file_cache.dat2` is 520 bytes:
 *   u8[8]  header: u16 id, u16 part, u24 nextSector, u8 archiveType
 *   u8[512] payload
 *
 * The archiveType byte is `archive + 1` for normal archives. The master index
 * (archive 255) historically uses `archiveType = 255` (or 0 in some dumps).
 * We don't validate the archiveType byte — only `id` and `part` — to remain
 * compatible with both conventions. This matches OpenRS2's behavior.
 */
const SECTOR_SIZE = 520;
const SECTOR_HEADER_SIZE = 8;
const SECTOR_DATA_SIZE = SECTOR_SIZE - SECTOR_HEADER_SIZE;

/** Maximum decompressed file size we're willing to allocate (matches FileStream's 2MB cap). */
const MAX_FILE_SIZE = 2_000_000;

/**
 * One entry from the master index (idx255 data).
 *
 * The master index is a single compressed container stored at the sector
 * pointed to by `idx255[0]`. Decompressed, it's a protocol-tagged byte stream
 * (protocol 5, 6, or 7) listing every archive in the cache with its CRC,
 * revision, name hash, and child file IDs.
 *
 * - `archive`: numeric archive ID (0..N). Same as the index into `idx255`'s
 *   parsed output.
 * - `crc`: 32-bit CRC of the archive's compressed container. Used by the JS5
 *   on-demand protocol for integrity checks.
 * - `version`: archive revision (sometimes called "version" in OSRS docs).
 *   Always present for protocol 6+, always 0 for protocol 5.
 * - `nameHash`: 32-bit hash of the archive's debugname (0 if unnamed).
 *   Hashed via the same algorithm as `Jagfile.genHash()`.
 * - `childCount`: number of files in this archive.
 * - `childIds`: explicit child file IDs. Length = childCount. If the IDs are
 *   sequential (0, 1, 2, ...) this still lists them explicitly — the master
 *   index doesn't have a "sequential" mode.
 */
export interface Index255Entry {
    archive: number;
    crc: number;
    version: number;
    nameHash: number;
    childCount: number;
    childIds: number[];
    /**
     * Per-child name hashes (parallel to `childIds`). 0 when the master index
     * was written with `named = false` OR when an individual child has no
     * name. Hashed via the same algorithm as `Jagfile.genHash()`.
     */
    childNameHashes: number[];
}

/** Result of `readArchive()` — a multi-child group's children, keyed by file ID. */
export interface ArchiveReadResult {
    children: Map<number, Uint8Array>;
}

/**
 * OSRS JS5 cache reader.
 *
 * Consumes a real OSRS cache dump (a directory containing `main_file_cache.dat2`
 * plus `main_file_cache.idx0` through `main_file_cache.idx255`) and exposes
 * per-file reads with container decompression + per-archive child splitting.
 *
 * Constructor never throws — if the cache directory is missing or unreadable,
 * every read simply returns null. This makes it safe to construct against a
 * not-yet-populated cache folder (the dep tracer in `tools/osrs/` relies on
 * this for its pre-cache-drop dry runs).
 *
 * Sector-walking logic mirrors LostCity's `FileStream.ts` (which uses the same
 * JS5 sector format for the 377 cache), but the OSRS reader handles:
 *   - The full container wrapper (compression byte + length + version trailer)
 *     that the 377 cache's `FileStream.read(archive, file, decompress=true)`
 *     path does NOT decode (377 only uses raw gzip).
 *   - The master index at archive 255 (no analogue in 377 — the 377 cache has
 *     no master index, just per-archive `idxN` files).
 *   - Multi-child archive splitting (the 377 equivalent is the Jagfile format
 *     handled by `io/Jagfile.ts` — different layout, similar concept).
 */
export default class OsrsCacheReader {
    private readonly cacheDir: string;

    /** Underlying dat2 file handle (null if cache unavailable). */
    private dat: RandomAccessFile | null = null;

    /** Per-archive index files (idx0..idx255), keyed by archive number. */
    private idxFiles: Map<number, RandomAccessFile> = new Map();

    /** Convenience reference to idx255 (also stored in `idxFiles`). */
    private idx255: RandomAccessFile | null = null;

    /** True once dat2 + idx255 are both successfully open. */
    private available: boolean = false;

    /** Lazy-cached master index entries. Null until first `readIndex255()` call. */
    private index255Cache: Index255Entry[] | null = null;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;

        if (!fs.existsSync(cacheDir)) {
            // Cache directory not yet populated — fail gracefully.
            return;
        }

        const datPath = `${cacheDir}/main_file_cache.dat2`;
        if (!fs.existsSync(datPath)) {
            return;
        }

        try {
            this.dat = new RandomAccessFile(datPath, true);

            // Open every idxN that exists on disk (don't require all 256).
            for (let i = 0; i <= 255; i++) {
                const idxPath = `${cacheDir}/main_file_cache.idx${i}`;
                if (fs.existsSync(idxPath)) {
                    this.idxFiles.set(i, new RandomAccessFile(idxPath, true));
                }
            }

            this.idx255 = this.idxFiles.get(255) ?? null;
            this.available = this.dat !== null && this.idx255 !== null;
        } catch (err) {
            printWarning(`OsrsCacheReader: failed to open cache at ${cacheDir}: ${(err as Error).message}`);
            this.dat = null;
            this.idxFiles.clear();
            this.idx255 = null;
            this.available = false;
        }
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
     * Number of files (or groups) in an archive.
     *
     * Returns 0 if the archive's idx file isn't present. Each idx entry is 6
     * bytes (`u24 size + u24 sector`), so the count is `idxLength / 6`.
     */
    count(archive: number): number {
        const idx = this.idxFiles.get(archive);
        if (!idx) {
            return 0;
        }
        return Math.floor(idx.length / 6);
    }

    /**
     * Cheap "does this file exist?" check that doesn't read the data.
     * Returns true if the idx entry has a non-zero size + sector.
     */
    has(archive: number, file: number): boolean {
        if (!this.available || !this.dat) {
            return false;
        }
        const idx = this.idxFiles.get(archive);
        if (!idx) {
            return false;
        }
        if (file < 0 || file >= this.count(archive)) {
            return false;
        }

        idx.pos = file * 6;
        const idxHeader = idx.gPacket(6);
        const size = idxHeader.g3();
        const sector = idxHeader.g3();
        return size > 0 && sector > 0;
    }

    /**
     * Read a single file from an archive, decompressing the container.
     *
     * Use this for archives where each idx entry is a single-file group
     * (e.g. archive 1 = models, archive 0 = anim frames).
     *
     * Returns the decompressed payload (no container wrapper, no version
     * trailer), or null on any error / missing file.
     */
    read(archive: number, file: number): Uint8Array | null {
        const raw = this.readRaw(archive, file);
        if (!raw) {
            return null;
        }
        return this.readContainer(raw.data);
    }

    /**
     * Read a single file's raw container bytes (no decompression).
     * Exposed for callers that want to inspect the container header directly.
     */
    readRaw(archive: number, file: number): { data: Uint8Array; version: number } | null {
        if (!this.available || !this.dat) {
            return null;
        }
        const idx = this.idxFiles.get(archive);
        if (!idx) {
            return null;
        }
        if (file < 0 || file >= this.count(archive)) {
            return null;
        }

        idx.pos = file * 6;
        const idxHeader = idx.gPacket(6);
        const size = idxHeader.g3();
        let sector = idxHeader.g3();

        if (size <= 0 || size > MAX_FILE_SIZE) {
            return null;
        }
        const maxSector = Math.floor(this.dat.length / SECTOR_SIZE);
        if (sector <= 0 || sector > maxSector) {
            return null;
        }

        const data = new Uint8Array(size);
        let written = 0;
        for (let part = 0; written < size; part++) {
            if (sector === 0) {
                // Unexpected end of sector chain.
                return null;
            }

            this.dat.pos = sector * SECTOR_SIZE;

            const remaining = size - written;
            const chunkSize = Math.min(remaining, SECTOR_DATA_SIZE);
            const header = this.dat.gPacket(chunkSize + SECTOR_HEADER_SIZE);

            const sectorFile = header.g2();
            const sectorPart = header.g2();
            const nextSector = header.g3();
            // sectorIndex (1 byte) — read but not validated. OSRS uses
            // `archive + 1` for normal archives and `255` for the master
            // index; some dumps use `0`. Validating would reject valid caches.
            header.g1();

            if (sectorFile !== file || sectorPart !== part) {
                printWarning(
                    `OsrsCacheReader: sector mismatch (archive=${archive} file=${file} ` +
                        `part=${part}; got sectorFile=${sectorFile} sectorPart=${sectorPart})`
                );
                return null;
            }

            if (nextSector < 0 || nextSector > maxSector) {
                return null;
            }

            // Payload starts right after the 8-byte header (header.pos = 8 here).
            data.set(header.data.subarray(header.pos, header.pos + chunkSize), written);
            written += chunkSize;
            sector = nextSector;
        }

        // The 2-byte version trailer is at the end of the container wrapper.
        // We don't parse it here — `readContainer()` returns just the
        // decompressed payload. Callers needing the version should use
        // `readContainerWithVersion()`.
        return { data, version: 0 };
    }

    /**
     * Read a multi-child archive group and split it into named children.
     *
     * Use this for archives where each idx entry is a multi-child group
     * (e.g. archive 9 = config bundle: 'npc.dat', 'npc.idx', 'seq.dat', etc.).
     *
     * Returns a `Map<childId, Uint8Array>` of the split children, or null on
     * any error.
     *
     * The child IDs come from the master index (idx255). If the master index
     * isn't loaded, sequential IDs (0, 1, 2, ...) are assumed — this works
     * for the common case where children are stored in order.
     */
    readArchive(archive: number, file: number): ArchiveReadResult | null {
        const raw = this.readRaw(archive, file);
        if (!raw) {
            return null;
        }
        const decompressed = this.readContainer(raw.data);
        if (!decompressed) {
            return null;
        }

        const childIds = this.lookupChildIds(archive);
        const split = this.splitArchive(decompressed, childIds);
        if (!split) {
            return null;
        }
        return { children: split };
    }

    /**
     * Read the master index (idx255 data).
     *
     * The master index is stored as a single compressed container at the
     * sector pointed to by `idx255[0]`. Decompressed, it's a protocol-tagged
     * byte stream (protocol 5, 6, or 7) describing every archive in the cache.
     *
     * Returns an empty array if the cache is unavailable or the master index
     * can't be parsed. Results are cached for the lifetime of the reader.
     */
    readIndex255(): Index255Entry[] {
        if (this.index255Cache !== null) {
            return this.index255Cache;
        }
        this.index255Cache = []; // sentinel: don't re-attempt on failure

        if (!this.available) {
            return this.index255Cache;
        }

        // The master index is read as archive=255, file=0. The sector header
        // for this read uses archiveType=255 (or 0 in some dumps) — see the
        // note in `readRaw()` for why we don't validate the archiveType byte.
        const raw = this.readRaw(255, 0);
        if (!raw) {
            return this.index255Cache;
        }

        const decompressed = this.readContainer(raw.data);
        if (!decompressed) {
            printWarning('OsrsCacheReader: failed to decompress master index container');
            return this.index255Cache;
        }

        const entries = this.parseMasterIndex(decompressed);
        if (entries === null) {
            printWarning('OsrsCacheReader: failed to parse master index');
            return this.index255Cache;
        }

        this.index255Cache = entries;
        return this.index255Cache;
    }

    /**
     * Look up the child IDs for an archive from the master index.
     * Returns null if the master index isn't loaded or doesn't list the archive.
     */
    private lookupChildIds(archive: number): number[] | null {
        const entries = this.readIndex255();
        for (const entry of entries) {
            if (entry.archive === archive) {
                return entry.childIds;
            }
        }
        return null;
    }

    /**
     * Strip a container wrapper and decompress the payload.
     *
     * Container format:
     *   u8  compression (0=NONE, 1=BZIP2, 2=GZIP)
     *   u32 uncompressedLength
     *   ... compressed payload (or raw bytes if NONE)
     *   u16 version trailer (optional; present when writer set a version)
     *
     * For NONE compression, the payload is exactly `uncompressedLength` bytes
     * (any trailing version bytes are stripped). For BZIP2/GZIP, the
     * decompressed size should match `uncompressedLength`.
     *
     * Returns the decompressed payload, or null on any decode error.
     */
    private readContainer(data: Uint8Array): Uint8Array | null {
        if (data.length < 5) {
            return null;
        }

        const packet = new Packet(data);
        const compression = packet.g1();
        const uncompressedLength = packet.g4();
        const payloadStart = packet.pos;

        if (uncompressedLength < 0 || uncompressedLength > MAX_FILE_SIZE) {
            printWarning(`OsrsCacheReader: invalid uncompressed length ${uncompressedLength}`);
            return null;
        }

        switch (compression) {
            case COMPRESSION_NONE: {
                // Payload is raw; any trailing bytes are the version trailer.
                const available = data.length - payloadStart;
                if (uncompressedLength > available) {
                    printWarning(
                        `OsrsCacheReader: NONE payload too short (need ${uncompressedLength}, have ${available})`
                    );
                    return null;
                }
                return data.subarray(payloadStart, payloadStart + uncompressedLength);
            }

            case COMPRESSION_BZIP2: {
                // OSRS strips the leading "BZh1" magic from BZIP2 streams.
                // The `BZip2.decompress(payload, len, prependHeader=true)` call
                // re-prepends "BZh1" and decompresses.
                const compressed = data.subarray(payloadStart);
                try {
                    return BZip2.decompress(compressed, uncompressedLength, true);
                } catch (err) {
                    printWarning(`OsrsCacheReader: BZIP2 decompress failed: ${(err as Error).message}`);
                    return null;
                }
            }

            case COMPRESSION_GZIP: {
                // OSRS GZIP streams include the optional 2-byte version trailer
                // at the end (after the gzip EOF marker). Node's gunzipSync
                // tolerates the trailing bytes, so we can pass the whole payload.
                const compressed = data.subarray(payloadStart);
                const out = decompressGz(compressed);
                if (!out) {
                    printWarning('OsrsCacheReader: GZIP decompress failed');
                    return null;
                }
                return out;
            }

            default:
                printWarning(`OsrsCacheReader: unknown compression type ${compression}`);
                return null;
        }
    }

    /**
     * Parse the decompressed master index blob using the OSRS protocol format.
     *
     * Supports protocols 5, 6, and 7. Protocol layout:
     *
     *   u8 protocol
     *   [if protocol >= 6] u32 masterRevision
     *   u8 named (boolean — archive entries have name hashes)
     *   [if protocol >= 6] u8 crcs (boolean — archive entries have CRCs)
     *   u16 (protocol 5) or u32 (protocol 6/7) archiveCount
     *   [archive IDs — delta-encoded, format depends on protocol]
     *   [per-archive: nameHash? crc? revision? fileCount, fileIds[], fileNameHashes?]
     *
     * Returns null on malformed input or unsupported protocol.
     */
    private parseMasterIndex(data: Uint8Array): Index255Entry[] | null {
        if (data.length < 1) {
            return null;
        }

        const packet = new Packet(data);
        const protocol = packet.g1();
        if (protocol < 5 || protocol > 7) {
            printWarning(`OsrsCacheReader: unsupported master index protocol ${protocol}`);
            return null;
        }

        const hasRevision = protocol >= 6;
        // Master revision is read but not currently exposed.
        if (hasRevision) {
            packet.g4();
        }

        const named = packet.g1() === 1;
        const hasCrcs = protocol === 5 ? true : packet.g1() === 1;

        const archiveCount = protocol === 5 ? packet.g2() : packet.g4();
        if (archiveCount < 0 || archiveCount > 100_000) {
            printWarning(`OsrsCacheReader: implausible archive count ${archiveCount}`);
            return null;
        }

        // Archive IDs — delta-encoded.
        const archiveIds: number[] = new Array(archiveCount);
        let prevArchiveId = 0;
        for (let i = 0; i < archiveCount; i++) {
            const delta = protocol === 7 ? packet.g4() : packet.g2();
            prevArchiveId += delta;
            archiveIds[i] = prevArchiveId;
        }

        const entries: Index255Entry[] = [];
        for (let i = 0; i < archiveCount; i++) {
            const entry: Index255Entry = {
                archive: archiveIds[i],
                crc: 0,
                version: 0,
                nameHash: 0,
                childCount: 0,
                childIds: [],
                childNameHashes: []
            };

            if (named) {
                entry.nameHash = packet.g4();
            }
            if (hasCrcs) {
                entry.crc = packet.g4();
            }
            if (hasRevision) {
                entry.version = packet.g4();
            }

            const childCount = protocol === 7 ? packet.g4() : packet.g2();
            entry.childCount = childCount;

            const childIds: number[] = new Array(childCount);
            let prevChildId = 0;
            for (let j = 0; j < childCount; j++) {
                const delta = protocol === 7 ? packet.g4() : packet.g2();
                prevChildId += delta;
                childIds[j] = prevChildId;
            }
            entry.childIds = childIds;

            // Per-child name hashes (one u32 per child if named). Store them
            // so callers can resolve child IDs → debugnames via genHash().
            const childNameHashes: number[] = new Array(childCount);
            if (named) {
                for (let j = 0; j < childCount; j++) {
                    childNameHashes[j] = packet.g4();
                }
            } else {
                for (let j = 0; j < childCount; j++) {
                    childNameHashes[j] = 0;
                }
            }
            entry.childNameHashes = childNameHashes;

            entries.push(entry);
        }

        return entries;
    }

    /**
     * Split a decompressed multi-child archive group into per-child bytes.
     *
     * Ported EXACTLY from RuneLite's ArchiveFiles.loadContents() / OpenRS2's
     * Group.unpack(). The format is:
     *
     *   [striped data section]
     *   [size table: chunks × childCount × 4 bytes (signed int32 deltas)]
     *   [u8 chunkCount]
     *
     * The size table stores SIGNED deltas. Within each stripe/chunk, the
     * deltas are accumulated into a running sum. The running sum IS the
     * file's actual size in that chunk (NOT the delta). This is the critical
     * insight: for chunks=1, chunkSizes[id][0] = file's total size.
     *
     * The data section is laid out stripe-major, file-minor:
     *   [chunk 0: file0_bytes | file1_bytes | ... | fileN_bytes]
     *   [chunk 1: file0_bytes | file1_bytes | ... | fileN_bytes]
     *
     * Each file's bytes in a chunk = chunkSizes[id][chunk] (the cumulative).
     *
     * If `childIds` is null, sequential IDs (0, 1, 2, ...) are assumed.
     *
     * Returns null on malformed input.
     */
    private splitArchive(data: Uint8Array, childIds: number[] | null): Map<number, Uint8Array> | null {
        if (data.length < 1) {
            return null;
        }

        const childCount = childIds ? childIds.length : 0;

        // Single-file optimization: data IS the file
        if (childCount <= 1) {
            const out = new Map<number, Uint8Array>();
            const id = childIds && childIds.length > 0 ? childIds[0] : 0;
            out.set(id, data);
            return out;
        }

        // Read chunk count from the LAST byte
        const chunks = data[data.length - 1] & 0xFF;

        // Size table starts at: data.length - 1 - chunks * childCount * 4
        const tableOffset = data.length - 1 - chunks * childCount * 4;
        if (tableOffset < 0) {
            printWarning(`OsrsCacheReader: archive too short for chunk table`);
            return null;
        }

        // Read the size table. chunkSizes[id][chunk] = cumulative sum of
        // signed deltas within that chunk = file's actual size in that chunk.
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

        // Validate
        for (let i = 0; i < childCount; i++) {
            if (filesSize[i] < 0 || filesSize[i] > MAX_FILE_SIZE) {
                printWarning(`OsrsCacheReader: child ${i} has invalid size ${filesSize[i]}`);
                return null;
            }
        }

        // Allocate buffers
        const fileContents: Uint8Array[] = new Array(childCount);
        const fileOffsets = new Int32Array(childCount);
        for (let i = 0; i < childCount; i++) {
            fileContents[i] = new Uint8Array(filesSize[i]);
        }

        // Read striped data. For each file in each chunk, read chunkSizes[id][chunk]
        // bytes (the FULL cumulative = file size in that chunk), NOT the delta.
        pos = 0;
        for (let chunk = 0; chunk < chunks; chunk++) {
            for (let id = 0; id < childCount; id++) {
                const sz = chunkSizes[id][chunk];
                if (sz > 0 && pos + sz <= tableOffset) {
                    fileContents[id].set(data.subarray(pos, pos + sz), fileOffsets[id]);
                    fileOffsets[id] += sz;
                    pos += sz;
                }
            }
        }

        // Map child index → child ID
        const out = new Map<number, Uint8Array>();
        for (let i = 0; i < childCount; i++) {
            const id = childIds && i < childIds.length ? childIds[i] : i;
            out.set(id, fileContents[i]);
        }
        return out;
    }

    /** Release file handles. Safe to call multiple times. */
    close(): void {
        if (this.dat) {
            this.dat.close();
            this.dat = null;
        }
        for (const idx of this.idxFiles.values()) {
            idx.close();
        }
        this.idxFiles.clear();
        this.idx255 = null;
        this.available = false;
    }
}
