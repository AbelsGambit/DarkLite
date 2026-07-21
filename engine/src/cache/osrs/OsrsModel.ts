import Packet from '#/io/Packet.js';
import { printWarning } from '#/util/Logger.js';

/**
 * OSRS model format metadata.
 *
 * Mirrors the role of the `Metadata` class in `cache/graphics/Model.ts` (377
 * path) but holds the larger set of OSRS trailer fields plus the computed
 * byte offsets of each body section.
 *
 * Trailer layout (last 23 bytes of the blob, decoded back-to-front):
 *   1.  version              : u8    (NEW vs 377 — feature gate)
 *   2.  vertexCount          : u16
 *   3.  triangleCount        : u16   (was `faceCount` in 377)
 *   4.  triangleTextureCount : u8    (was `texturedFaceCount` in 377)
 *   5.  hasFaceColors        : u8    (was `hasInfo` in 377; JS5 >= 6)
 *   6.  hasFaceTextures      : u8    (NEW; JS5 >= 6 — gates material section)
 *   7.  priority             : u8    (kept from 377; 255 = per-face priority)
 *   8.  hasFaceAlphas        : u8    (was `hasAlpha`)
 *   9.  hasTriangleTags      : u8    (was `hasFaceLabels`)
 *   10. hasVertexLabels      : u8
 *   11. dataLenVertexX       : u16
 *   12. dataLenVertexY       : u16
 *   13. dataLenVertexZ       : u16
 *   14. dataLenFaceOrientations : u16  (byte length of the vertex-index stream)
 *   15. triangleSkinCount    : u8    (NEW — only meaningful when version >= 1)
 *   16. vertexSkinCount      : u8    (NEW — only meaningful when version >= 1)
 *   17. maxDepth             : u8    (NEW — bounding-box hint)
 *
 * Total: 23 bytes (vs 18 for plain 377). 5 of those bytes are NEW vs 377
 * (`version`, `hasFaceTextures`, `triangleSkinCount`, `vertexSkinCount`,
 * `maxDepth`). When `version == 0` callers should fall back to the legacy
 * `cache/graphics/Model.ts` decoder which reads the 18-byte 377 trailer.
 *
 * Spec ambiguity: the task spec listed only 12 trailer fields (17 bytes) but
 * asserted the trailer is 23 bytes. We resolved this by keeping every 377
 * field (including `priority`, which the spec omitted) and adding the 5 NEW
 * bytes documented in the worklog. This both matches the 23-byte total and
 * gives `toLegacy377()` enough information to emit a faithful 377 file.
 */
export class OsrsModelMetadata {
    data: Uint8Array | null = null;

    // trailer fields (read straight off the blob)
    version: number = 0;
    vertexCount: number = 0;
    triangleCount: number = 0;
    triangleTextureCount: number = 0;
    hasFaceColors: number = 0;
    hasFaceTextures: number = 0;
    priority: number = 0;
    hasFaceAlphas: number = 0;
    hasTriangleTags: number = 0;
    hasVertexLabels: number = 0;
    dataLenVertexX: number = 0;
    dataLenVertexY: number = 0;
    dataLenVertexZ: number = 0;
    dataLenFaceOrientations: number = 0;
    triangleSkinCount: number = 0;
    vertexSkinCount: number = 0;
    maxDepth: number = 0;

    // computed section offsets (-1 = section absent)
    vertexFlagsOffset: number = -1;
    vertexXOffset: number = -1;
    vertexYOffset: number = -1;
    vertexZOffset: number = -1;
    vertexLabelsOffset: number = -1;
    triangleOrientationsOffset: number = -1;
    triangleColoursOffset: number = -1;
    triangleInfosOffset: number = -1;
    triangleMaterialsOffset: number = -1;
    triangleAlphasOffset: number = -1;
    triangleTagsOffset: number = -1;
    trianglePrioritiesOffset: number = -1;
    triangleVerticesOffset: number = -1;
    triangleTextureUvsOffset: number = -1;
    triangleSkinsOffset: number = -1;
    vertexSkinsOffset: number = -1;
}

/**
 * OSRS model decoder.
 *
 * Ported from RuneLite's `ModelDefinition.java` (well-documented public
 * format; the implementation here follows the same field naming and decode
 * order as RuneLite/OpenRS2/rs2-cache).
 *
 * API-compatible in spirit with `cache/graphics/Model.ts` (the existing 377
 * decoder): a `Metadata` companion class holds section offsets, and a static
 * `decode(id, data)` factory does the work. Unlike the 377 decoder which
 * splits `unpack` (offset computation) from `fromId` (decode), this class
 * does both in a single `decode()` call — the OSRS decoder is intended for
 * one-shot pipeline use, not for runtime client caching.
 *
 * The class also exposes:
 *   - `static detect(data)`        : sniffs OSRS vs 377 blobs
 *   - `toLegacy377()`              : re-encodes as a 377 `.ob2` blob
 *                                    (transform stage of the pipeline)
 */
export default class OsrsModel {
    id: number;

    // header / counts
    version: number = 0;
    vertexCount: number = 0;
    triangleCount: number = 0;
    triangleTextureCount: number = 0;
    maxDepth: number = 0;

    // vertex data
    vertexX: Int32Array = new Int32Array(0);
    vertexY: Int32Array = new Int32Array(0);
    vertexZ: Int32Array = new Int32Array(0);
    vertexLabel: Int32Array | null = null;
    vertexSkin: Int32Array | null = null;

    // triangle data
    triangleType: Uint8Array = new Uint8Array(0); // orientation byte (1/2/3/4)
    triangleColour: Uint16Array = new Uint16Array(0); // colour in low 15 bits
    triangleInfo: Int32Array | null = null;
    triangleMaterial: Int32Array | null = null;
    triangleAlpha: Int32Array | null = null;
    triangleTag: Int32Array | null = null;
    trianglePriority: Int32Array | null = null;
    priority: number = 0; // shared priority (when not per-face)
    triangleSkin: Int32Array | null = null;

    // triangle vertex indices (A/B/C)
    triangleVertexA: Int32Array = new Int32Array(0);
    triangleVertexB: Int32Array = new Int32Array(0);
    triangleVertexC: Int32Array = new Int32Array(0);

    // textured triangle UV vertex indices
    texturedVertexA: Int32Array | null = null;
    texturedVertexB: Int32Array | null = null;
    texturedVertexC: Int32Array | null = null;

    private constructor(id: number) {
        this.id = id;
    }

    /**
     * Decode an OSRS model blob. Returns `null` for null input or for blobs
     * that fail the trailer sanity checks. Callers should use `detect()`
     * first if they don't already know the blob is OSRS.
     */
    static decode(id: number, data: Uint8Array | null): OsrsModel | null {
        if (!data) {
            return null;
        }
        if (data.length < 23) {
            printWarning(`OsrsModel ${id}: blob too short (${data.length} bytes, need >= 23)`);
            return null;
        }

        const meta = new OsrsModelMetadata();
        meta.data = data;

        // ---- read trailer (last 23 bytes) ----
        const trailer = new Packet(data);
        trailer.pos = data.length - 23;
        meta.version = trailer.g1();
        meta.vertexCount = trailer.g2();
        meta.triangleCount = trailer.g2();
        meta.triangleTextureCount = trailer.g1();
        meta.hasFaceColors = trailer.g1();
        meta.hasFaceTextures = trailer.g1();
        meta.priority = trailer.g1();
        meta.hasFaceAlphas = trailer.g1();
        meta.hasTriangleTags = trailer.g1();
        meta.hasVertexLabels = trailer.g1();
        meta.dataLenVertexX = trailer.g2();
        meta.dataLenVertexY = trailer.g2();
        meta.dataLenVertexZ = trailer.g2();
        meta.dataLenFaceOrientations = trailer.g2();
        meta.triangleSkinCount = trailer.g1();
        meta.vertexSkinCount = trailer.g1();
        meta.maxDepth = trailer.g1();

        if (meta.version < 1) {
            // version 0 = legacy 377 path; the caller should have used Model.ts
            // but we still attempt the OSRS decode if the structure looks sane.
            printWarning(`OsrsModel ${id}: version=${meta.version}, expected >= 1 for OSRS`);
        }

        // sanity: counts must fit in the blob
        const expectedMin =
            meta.vertexCount + // vertex flags
            meta.dataLenVertexX +
            meta.dataLenVertexY +
            meta.dataLenVertexZ +
            meta.triangleCount + // orientation bytes
            meta.triangleCount * 2 + // colours
            meta.dataLenFaceOrientations +
            meta.triangleTextureCount * 6;
        if (expectedMin > data.length - 23) {
            printWarning(
                `OsrsModel ${id}: trailer lengths (${expectedMin}) exceed body (${data.length - 23})`
            );
            return null;
        }

        const model = new OsrsModel(id);
        model.version = meta.version;
        model.vertexCount = meta.vertexCount;
        model.triangleCount = meta.triangleCount;
        model.triangleTextureCount = meta.triangleTextureCount;
        model.maxDepth = meta.maxDepth;

        // allocate typed arrays
        model.vertexX = new Int32Array(model.vertexCount);
        model.vertexY = new Int32Array(model.vertexCount);
        model.vertexZ = new Int32Array(model.vertexCount);
        model.triangleType = new Uint8Array(model.triangleCount);
        model.triangleColour = new Uint16Array(model.triangleCount);
        model.triangleVertexA = new Int32Array(model.triangleCount);
        model.triangleVertexB = new Int32Array(model.triangleCount);
        model.triangleVertexC = new Int32Array(model.triangleCount);

        if (meta.hasVertexLabels === 1) {
            model.vertexLabel = new Int32Array(model.vertexCount);
        }
        if (meta.hasFaceColors === 1) {
            model.triangleInfo = new Int32Array(model.triangleCount);
        }
        if (meta.hasFaceTextures === 1) {
            model.triangleMaterial = new Int32Array(model.triangleCount);
        }
        if (meta.hasFaceAlphas === 1) {
            model.triangleAlpha = new Int32Array(model.triangleCount);
        }
        if (meta.hasTriangleTags === 1) {
            model.triangleTag = new Int32Array(model.triangleCount);
        }
        if (meta.priority === 255) {
            model.trianglePriority = new Int32Array(model.triangleCount);
        } else {
            model.priority = meta.priority;
        }
        if (meta.triangleTextureCount > 0) {
            model.texturedVertexA = new Int32Array(meta.triangleTextureCount);
            model.texturedVertexB = new Int32Array(meta.triangleTextureCount);
            model.texturedVertexC = new Int32Array(meta.triangleTextureCount);
        }
        if (meta.version >= 1 && meta.triangleSkinCount > 0) {
            model.triangleSkin = new Int32Array(meta.triangleSkinCount);
        }
        if (meta.version >= 1 && meta.vertexSkinCount > 0) {
            model.vertexSkin = new Int32Array(meta.vertexSkinCount);
        }

        // ---- compute section offsets ----
        // Body order (per spec, with one explicit addition for the orientation
        // bytes — see spec-ambiguity note on OsrsModelMetadata):
        //   1.  vertex flags
        //   2.  vertex X (smart-encoded deltas)
        //   3.  vertex Y
        //   4.  vertex Z
        //   5.  vertex labels             (if hasVertexLabels)
        //   5.5 triangle orientation bytes (1/face — same as 377 faceOrientations)
        //   6.  triangle colours (u16/face)
        //   7.  triangle info              (if hasFaceColors)
        //   8.  triangle materials         (if hasFaceTextures)
        //   9.  triangle alphas            (if hasFaceAlphas)
        //   10. triangle tags              (if hasTriangleTags)
        //   10.5 triangle priorities       (if priority == 255)
        //   11. triangle vertex indices    (smart-encoded; dataLenFaceOrientations bytes)
        //   12. triangle texture UVs       (if triangleTextureCount > 0)
        //   13. triangle skins             (if version>=1 && triangleSkinCount>0)
        //   14. vertex skins               (if version>=1 && vertexSkinCount>0)
        let pos: number = 0;

        meta.vertexFlagsOffset = pos;
        pos += meta.vertexCount;

        meta.vertexXOffset = pos;
        pos += meta.dataLenVertexX;

        meta.vertexYOffset = pos;
        pos += meta.dataLenVertexY;

        meta.vertexZOffset = pos;
        pos += meta.dataLenVertexZ;

        if (meta.hasVertexLabels === 1) {
            meta.vertexLabelsOffset = pos;
            pos += meta.vertexCount;
        } else {
            meta.vertexLabelsOffset = -1;
        }

        // 5.5 orientation bytes (always present — needed for vertex-index decode)
        meta.triangleOrientationsOffset = pos;
        pos += meta.triangleCount;

        meta.triangleColoursOffset = pos;
        pos += meta.triangleCount * 2;

        if (meta.hasFaceColors === 1) {
            meta.triangleInfosOffset = pos;
            pos += meta.triangleCount;
        } else {
            meta.triangleInfosOffset = -1;
        }

        if (meta.hasFaceTextures === 1) {
            meta.triangleMaterialsOffset = pos;
            pos += meta.triangleCount;
        } else {
            meta.triangleMaterialsOffset = -1;
        }

        if (meta.hasFaceAlphas === 1) {
            meta.triangleAlphasOffset = pos;
            pos += meta.triangleCount;
        } else {
            meta.triangleAlphasOffset = -1;
        }

        if (meta.hasTriangleTags === 1) {
            meta.triangleTagsOffset = pos;
            pos += meta.triangleCount;
        } else {
            meta.triangleTagsOffset = -1;
        }

        if (meta.priority === 255) {
            meta.trianglePrioritiesOffset = pos;
            pos += meta.triangleCount;
        } else {
            // 377-style negative-offset trick encodes the shared priority
            meta.trianglePrioritiesOffset = -meta.priority - 1;
        }

        meta.triangleVerticesOffset = pos;
        pos += meta.dataLenFaceOrientations;

        meta.triangleTextureUvsOffset = pos;
        pos += meta.triangleTextureCount * 6;

        if (meta.version >= 1 && meta.triangleSkinCount > 0) {
            meta.triangleSkinsOffset = pos;
            pos += meta.triangleSkinCount;
        } else {
            meta.triangleSkinsOffset = -1;
        }

        if (meta.version >= 1 && meta.vertexSkinCount > 0) {
            meta.vertexSkinsOffset = pos;
            pos += meta.vertexSkinCount;
        } else {
            meta.vertexSkinsOffset = -1;
        }

        // ---- decode vertices ----
        const flagsBuf = new Packet(data);
        flagsBuf.pos = meta.vertexFlagsOffset;
        const xBuf = new Packet(data);
        xBuf.pos = meta.vertexXOffset;
        const yBuf = new Packet(data);
        yBuf.pos = meta.vertexYOffset;
        const zBuf = new Packet(data);
        zBuf.pos = meta.vertexZOffset;
        const labelBuf = new Packet(data);
        labelBuf.pos = meta.vertexLabelsOffset;

        let dx: number = 0;
        let dy: number = 0;
        let dz: number = 0;
        for (let v: number = 0; v < model.vertexCount; v++) {
            const flags: number = flagsBuf.g1();
            const ax: number = (flags & 0x1) !== 0 ? xBuf.gsmart() : 0;
            const ay: number = (flags & 0x2) !== 0 ? yBuf.gsmart() : 0;
            const az: number = (flags & 0x4) !== 0 ? zBuf.gsmart() : 0;
            model.vertexX[v] = dx + ax;
            model.vertexY[v] = dy + ay;
            model.vertexZ[v] = dz + az;
            dx = model.vertexX[v];
            dy = model.vertexY[v];
            dz = model.vertexZ[v];
            if (model.vertexLabel !== null) {
                model.vertexLabel[v] = labelBuf.g1();
            }
        }

        // ---- decode per-triangle scalars ----
        const oriBuf = new Packet(data);
        oriBuf.pos = meta.triangleOrientationsOffset;
        const colBuf = new Packet(data);
        colBuf.pos = meta.triangleColoursOffset;
        const infoBuf = new Packet(data);
        infoBuf.pos = meta.triangleInfosOffset;
        const matBuf = new Packet(data);
        matBuf.pos = meta.triangleMaterialsOffset;
        const alphaBuf = new Packet(data);
        alphaBuf.pos = meta.triangleAlphasOffset;
        const tagBuf = new Packet(data);
        tagBuf.pos = meta.triangleTagsOffset;
        const priBuf = new Packet(data);
        priBuf.pos = meta.trianglePrioritiesOffset;

        for (let t: number = 0; t < model.triangleCount; t++) {
            model.triangleType[t] = oriBuf.g1();
            model.triangleColour[t] = colBuf.g2();
            if (model.triangleInfo !== null) {
                model.triangleInfo[t] = infoBuf.g1();
            }
            if (model.triangleMaterial !== null) {
                model.triangleMaterial[t] = matBuf.g1();
            }
            if (model.triangleAlpha !== null) {
                model.triangleAlpha[t] = alphaBuf.g1();
            }
            if (model.triangleTag !== null) {
                model.triangleTag[t] = tagBuf.g1();
            }
            if (model.trianglePriority !== null) {
                model.trianglePriority[t] = priBuf.g1();
            }
        }

        // ---- decode triangle vertex indices (1/2/3/4 type encoding, same as 377) ----
        const vertBuf = new Packet(data);
        vertBuf.pos = meta.triangleVerticesOffset;
        let a: number = 0;
        let b: number = 0;
        let c: number = 0;
        let last: number = 0;
        for (let t: number = 0; t < model.triangleCount; t++) {
            const type: number = model.triangleType[t];
            if (type === 1) {
                a = vertBuf.gsmart() + last;
                b = vertBuf.gsmart() + a;
                c = vertBuf.gsmart() + b;
                last = c;
            } else if (type === 2) {
                // a unchanged, b takes previous c, c = delta + last
                b = c;
                c = vertBuf.gsmart() + last;
                last = c;
            } else if (type === 3) {
                // a takes previous c, b unchanged, c = delta + last
                a = c;
                c = vertBuf.gsmart() + last;
                last = c;
            } else if (type === 4) {
                // swap a and b, c = delta + last
                const tmp: number = a;
                a = b;
                b = tmp;
                c = vertBuf.gsmart() + last;
                last = c;
            } else {
                // Unknown type — fall back to type-1 (read 3 fresh deltas) so
                // we don't lose sync with the smart stream. This is a best-
                // effort recovery; the model may render incorrectly.
                printWarning(
                    `OsrsModel ${id}: triangle ${t} has unknown orientation ${type}; falling back to type 1`
                );
                a = vertBuf.gsmart() + last;
                b = vertBuf.gsmart() + a;
                c = vertBuf.gsmart() + b;
                last = c;
            }
            model.triangleVertexA[t] = a;
            model.triangleVertexB[t] = b;
            model.triangleVertexC[t] = c;
        }

        // ---- decode triangle texture UVs ----
        if (meta.triangleTextureCount > 0 && model.texturedVertexA !== null) {
            const uvBuf = new Packet(data);
            uvBuf.pos = meta.triangleTextureUvsOffset;
            for (let t: number = 0; t < meta.triangleTextureCount; t++) {
                model.texturedVertexA[t] = uvBuf.g2();
                model.texturedVertexB[t] = uvBuf.g2();
                model.texturedVertexC[t] = uvBuf.g2();
            }
        }

        // ---- decode triangle skins ----
        if (model.triangleSkin !== null) {
            const skinBuf = new Packet(data);
            skinBuf.pos = meta.triangleSkinsOffset;
            for (let i: number = 0; i < meta.triangleSkinCount; i++) {
                model.triangleSkin[i] = skinBuf.g1();
            }
        }

        // ---- decode vertex skins ----
        if (model.vertexSkin !== null) {
            const skinBuf = new Packet(data);
            skinBuf.pos = meta.vertexSkinsOffset;
            for (let i: number = 0; i < meta.vertexSkinCount; i++) {
                model.vertexSkin[i] = skinBuf.g1();
            }
        }

        return model;
    }

    /**
     * Sniff whether a model blob is OSRS (23-byte trailer with version >= 1)
     * or legacy 377 (18-byte trailer, no version byte).
     *
     * Heuristics:
     *   - blobs shorter than 23 bytes -> legacy377
     *   - version byte at data.length-23 must be in [1..255]
     *   - vertexCount and triangleCount read from the candidate trailer
     *     must be plausible (non-zero, < 100k)
     *   - derived minimum body length must fit inside data.length - 23
     *
     * Anything that fails the heuristic is treated as legacy377, which is the
     * safe default — the legacy decoder will then either succeed or report
     * its own decode error.
     */
    static detect(data: Uint8Array): 'osrs' | 'legacy377' {
        if (data.length < 23) {
            return 'legacy377';
        }

        const base: number = data.length - 23;
        const version: number = data[base];
        if (version < 1) {
            return 'legacy377';
        }

        const vertexCount: number = (data[base + 1] << 8) | data[base + 2];
        const triangleCount: number = (data[base + 3] << 8) | data[base + 4];
        if (vertexCount === 0 || triangleCount === 0) {
            return 'legacy377';
        }
        if (vertexCount > 100000 || triangleCount > 100000) {
            return 'legacy377';
        }

        // dataLenVertexX/Y/Z and dataLenFaceOrientations live at base+12..base+19
        // (after version(1) + vertexCount(2) + triangleCount(2) + triangleTextureCount(1)
        //  + hasFaceColors(1) + hasFaceTextures(1) + priority(1) + hasFaceAlphas(1)
        //  + hasTriangleTags(1) + hasVertexLabels(1) = 12 bytes)
        const dataLenX: number = (data[base + 12] << 8) | data[base + 13];
        const dataLenY: number = (data[base + 14] << 8) | data[base + 15];
        const dataLenZ: number = (data[base + 16] << 8) | data[base + 17];
        const dataLenFaceOrientations: number = (data[base + 18] << 8) | data[base + 19];

        const minBody: number =
            vertexCount + // vertex flags
            dataLenX +
            dataLenY +
            dataLenZ +
            triangleCount + // orientation bytes
            triangleCount * 2 + // colours
            dataLenFaceOrientations;
        if (minBody > data.length - 23) {
            return 'legacy377';
        }

        return 'osrs';
    }

    /**
     * Re-encode this OSRS model as a 377 `.ob2` blob.
     *
     * This is the **transform stage** of the pipeline: it lets us emit a
     * 377-compatible cache file from an OSRS source so the existing Java
     * client can render it without modification.
     *
     * The 377 format has no concept of:
     *   - triangle materials (OSRS-only — dropped)
     *   - triangle skins     (OSRS-only — dropped)
     *   - vertex skins       (OSRS-only — dropped)
     *   - per-texture UVs    (377 stores 3 vertex indices per textured face,
     *                         same field shape, so we KEEP these)
     *
     * Limitations:
     *   - Skinning data is lost. Animations that depend on vertex/triangle
     *     skins for rig-based animation will not animate correctly when
     *     rendered through the 377 client. The dependency tracer (task 6)
     *     must flag such models so the pilot can avoid them.
     *   - Material textures are lost. Faces with `triangleMaterial != 0`
     *     will fall back to flat-shaded colour rendering.
     *   - The orientation byte is preserved verbatim so the 1/2/3/4 type
     *     encoding survives round-trip.
     *   - `maxDepth` is dropped (377 has no equivalent).
     *
     * Output is a fresh Uint8Array — the original OSRS blob is not modified.
     */
    toLegacy377(): Uint8Array {
        const vc: number = this.vertexCount;
        const tc: number = this.triangleCount;
        const tfc: number = this.triangleTextureCount;

        // ---- re-encode vertex deltas & recompute data lengths ----
        // For each axis: flag bit is set iff the delta is non-zero.
        // Delta is encoded as a signed smart (1 byte for [-64..63], 2 bytes
        // for [-16384..16383]). LostCity's Packet.psmart only handles
        // non-negative values, so we use a local helper below.
        const flagBytes: Uint8Array = new Uint8Array(vc);
        const xBytes: number[] = [];
        const yBytes: number[] = [];
        const zBytes: number[] = [];

        let prevX: number = 0;
        let prevY: number = 0;
        let prevZ: number = 0;
        for (let v: number = 0; v < vc; v++) {
            const dx: number = this.vertexX[v] - prevX;
            const dy: number = this.vertexY[v] - prevY;
            const dz: number = this.vertexZ[v] - prevZ;
            let flag: number = 0;
            if (dx !== 0) {
                flag |= 0x1;
                psmartSigned(xBytes, dx);
            }
            if (dy !== 0) {
                flag |= 0x2;
                psmartSigned(yBytes, dy);
            }
            if (dz !== 0) {
                flag |= 0x4;
                psmartSigned(zBytes, dz);
            }
            flagBytes[v] = flag;
            prevX = this.vertexX[v];
            prevY = this.vertexY[v];
            prevZ = this.vertexZ[v];
        }

        const dataLenX: number = xBytes.length;
        const dataLenY: number = yBytes.length;
        const dataLenZ: number = zBytes.length;

        // ---- re-encode triangle vertex indices & recompute data length ----
        const oriBytes: Uint8Array = new Uint8Array(tc);
        const idxBytes: number[] = [];
        let last: number = 0;
        for (let t: number = 0; t < tc; t++) {
            const type: number = this.triangleType[t];
            oriBytes[t] = type;
            const a: number = this.triangleVertexA[t];
            const b: number = this.triangleVertexB[t];
            const c: number = this.triangleVertexC[t];
            if (type === 1) {
                psmartSigned(idxBytes, a - last);
                psmartSigned(idxBytes, b - a);
                psmartSigned(idxBytes, c - b);
            } else if (type === 2 || type === 3 || type === 4) {
                // types 2/3/4 reuse previous indices and emit one delta
                psmartSigned(idxBytes, c - last);
            } else {
                // fall back to type 1 (3 deltas) — matches decode fallback
                oriBytes[t] = 1;
                psmartSigned(idxBytes, a - last);
                psmartSigned(idxBytes, b - a);
                psmartSigned(idxBytes, c - b);
            }
            last = c;
        }
        const dataLenFaceOrientations: number = idxBytes.length;

        // ---- 377 trailer flags ----
        // We preserve: hasInfo (faceInfo), priority, hasAlpha, hasFaceLabels,
        //              hasVertexLabels.
        // We drop:    hasFaceTextures (377 has no material section).
        const hasInfo: number = this.triangleInfo !== null ? 1 : 0;
        const hasAlpha: number = this.triangleAlpha !== null ? 1 : 0;
        const hasFaceLabels: number = this.triangleTag !== null ? 1 : 0;
        const hasVertexLabels: number = this.vertexLabel !== null ? 1 : 0;
        // priority: if we have a per-face priority array, emit 255; otherwise
        // emit the shared priority byte.
        const priorityByte: number = this.trianglePriority !== null ? 255 : this.priority;

        // ---- 377 body section sizes (in decode order) ----
        //   1. vertex flags         (vc)
        //   2. faceOrientations     (tc)              -- the type bytes
        //   3. facePriorities       (tc, if priority==255)
        //   4. faceLabels           (tc, if hasFaceLabels)
        //   5. faceInfos            (tc, if hasInfo)
        //   6. vertexLabels         (vc, if hasVertexLabels)
        //   7. faceAlphas           (tc, if hasAlpha)
        //   8. faceVertices         (dataLenFaceOrientations)
        //   9. faceColours          (tc * 2)
        //  10. faceTextureAxis      (tfc * 6)         -- the UV vertex indices
        //  11. vertexX              (dataLenX)
        //  12. vertexY              (dataLenY)
        //  13. vertexZ              (dataLenZ)
        const bodySize: number =
            vc +
            tc +
            (priorityByte === 255 ? tc : 0) +
            (hasFaceLabels === 1 ? tc : 0) +
            (hasInfo === 1 ? tc : 0) +
            (hasVertexLabels === 1 ? vc : 0) +
            (hasAlpha === 1 ? tc : 0) +
            dataLenFaceOrientations +
            tc * 2 +
            tfc * 6 +
            dataLenX +
            dataLenY +
            dataLenZ;

        const out: Packet = new Packet(new Uint8Array(bodySize + 18));

        // 1. vertex flags
        out.data.set(flagBytes, out.pos);
        out.pos += vc;

        // 2. face orientations (type bytes)
        out.data.set(oriBytes, out.pos);
        out.pos += tc;

        // 3. face priorities (per-face array)
        if (priorityByte === 255 && this.trianglePriority !== null) {
            for (let t: number = 0; t < tc; t++) {
                out.p1(this.trianglePriority[t]);
            }
        }

        // 4. face labels (triangle tags)
        if (hasFaceLabels === 1 && this.triangleTag !== null) {
            for (let t: number = 0; t < tc; t++) {
                out.p1(this.triangleTag[t]);
            }
        }

        // 5. face infos
        if (hasInfo === 1 && this.triangleInfo !== null) {
            for (let t: number = 0; t < tc; t++) {
                out.p1(this.triangleInfo[t]);
            }
        }

        // 6. vertex labels
        if (hasVertexLabels === 1 && this.vertexLabel !== null) {
            for (let v: number = 0; v < vc; v++) {
                out.p1(this.vertexLabel[v]);
            }
        }

        // 7. face alphas
        if (hasAlpha === 1 && this.triangleAlpha !== null) {
            for (let t: number = 0; t < tc; t++) {
                out.p1(this.triangleAlpha[t]);
            }
        }

        // 8. face vertices (smart-encoded index deltas)
        for (let i: number = 0; i < idxBytes.length; i++) {
            out.p1(idxBytes[i]);
        }

        // 9. face colours (u16 each — low 15 bits)
        for (let t: number = 0; t < tc; t++) {
            out.p2(this.triangleColour[t]);
        }

        // 10. face texture axis (texturedVertexA/B/C as u16 each)
        if (tfc > 0 && this.texturedVertexA !== null) {
            for (let t: number = 0; t < tfc; t++) {
                out.p2(this.texturedVertexA[t]);
                out.p2(this.texturedVertexB[t]);
                out.p2(this.texturedVertexC[t]);
            }
        }

        // 11. vertex X
        for (let i: number = 0; i < xBytes.length; i++) {
            out.p1(xBytes[i]);
        }

        // 12. vertex Y
        for (let i: number = 0; i < yBytes.length; i++) {
            out.p1(yBytes[i]);
        }

        // 13. vertex Z
        for (let i: number = 0; i < zBytes.length; i++) {
            out.p1(zBytes[i]);
        }

        // ---- 18-byte 377 trailer ----
        out.p2(vc); // vertexCount
        out.p2(tc); // faceCount
        out.p1(tfc); // texturedFaceCount
        out.p1(hasInfo); // hasInfo
        out.p1(priorityByte); // priority
        out.p1(hasAlpha); // hasAlpha
        out.p1(hasFaceLabels); // hasFaceLabels
        out.p1(hasVertexLabels); // hasVertexLabels
        out.p2(dataLenX); // dataLengthX
        out.p2(dataLenY); // dataLengthY
        out.p2(dataLenZ); // dataLengthZ
        out.p2(dataLenFaceOrientations); // dataLengthFaceOrientations

        return out.data;
    }
}

/**
 * Append a signed smart-encoded value to a byte buffer.
 *
 * Matches the format read by `Packet.gsmart()`:
 *   - value in [-64, 63]      -> 1 byte  = value + 0x40
 *   - value in [-16384, 16383]-> 2 bytes = value + 0xc000 (big-endian)
 *
 * LostCity's `Packet.psmart()` only handles non-negative values, hence the
 * local helper. We push raw bytes into a plain array because the encoder
 * needs to know the byte length BEFORE allocating the output buffer.
 */
function psmartSigned(out: number[], value: number): void {
    if (value >= -64 && value <= 63) {
        out.push((value + 0x40) & 0xff);
    } else if (value >= -16384 && value <= 16383) {
        const v: number = (value + 0xc000) & 0xffff;
        out.push((v >> 8) & 0xff);
        out.push(v & 0xff);
    } else {
        throw new Error(`psmartSigned: value ${value} out of smart range [-16384, 16383]`);
    }
}
