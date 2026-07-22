/**
 * Universal OSRS → 377 Converter
 *
 * Converts OSRS models, animations, and sequences to 377 format so they
 * drop right into the LostCity content folder. This is a UNIVERSAL pipeline —
 * any OSRS model/anim/seq can be converted with zero per-NPC workarounds.
 *
 * Format differences:
 *
 * MODELS:
 *   - OSRS: 23-byte trailer (version + 17 standard fields + 5 OSRS-only)
 *   - 377:  18-byte trailer (no version, hasFaceTextures, triangleSkinCount,
 *           vertexSkinCount, maxDepth)
 *   - Conversion: OsrsModel.decode() → OsrsModel.toLegacy377()
 *   - NOTE: OSRS models with version=0 are ALREADY in 377 format (old format
 *     compatibility). No conversion needed — just copy the raw bytes.
 *
 * ANIMATIONS:
 *   - OSRS: 1 frame per blob, 2-byte base ID trailer
 *   - 377:  Multiple frames per blob, 8-byte meta footer (4 section sizes)
 *   - Conversion: OsrsAnimFrame.decode() → OsrsAnimFrame.toLegacy377()
 *   - The 377 format supports 1 frame per blob too (head section with count=1)
 *
 * SEQUENCES:
 *   - OSRS: op 1 uses g2 count, has opcodes 9-11 (pre/post-anim move, duplicatebehavior)
 *   - 377:  op 1 uses g1 count, same opcodes 9-11
 *   - Conversion: Read OSRS seq with g2 count, re-encode with g1 count
 *   - NOTE: count is always < 256 for any real animation, so g1 is safe
 *
 * Usage:
 *   const converter = new OsrsTo377Converter(cacheReader);
 *   const model377 = converter.convertModel(osrsModelId);
 *   const anim377 = converter.convertAnim(osrsAnimId);
 *   const seq377 = converter.convertSeq(osrsSeqConfig);
 */

import FlatFileCacheReader from '#/cache/osrs/FlatFileCacheReader.js';
import OsrsModel from '#/cache/osrs/OsrsModel.js';
import OsrsAnimFrame from '#/cache/osrs/OsrsAnimFrame.js';
import Packet from '#/io/Packet.js';
import { printWarning } from '#/util/Logger.js';

export class OsrsTo377Converter {
    private reader: FlatFileCacheReader;

    constructor(reader: FlatFileCacheReader) {
        this.reader = reader;
    }

    /**
     * Convert an OSRS model to 377 .ob2 format.
     *
     * If the model has version=0, it's already in old format — return raw bytes.
     * Otherwise, decode as OSRS and re-encode as 377 via toLegacy377().
     *
     * @param osrsModelId The model ID in the OSRS cache (idx7 for modern, idx0/1 for old)
     * @param idx The cache index to read from (default: 7 for modern models)
     * @returns 377-format .ob2 bytes, or null on failure
     */
    convertModel(osrsModelId: number, idx: number = 7): Uint8Array | null {
        const data = this.reader.read(idx, osrsModelId);
        if (!data) {
            printWarning(`convertModel: model ${osrsModelId} not found in idx${idx}`);
            return null;
        }

        // Try to detect the format:
        // - 377 format: 18-byte trailer, no version byte
        // - OSRS format: 23-byte trailer with version byte (>= 1)
        //
        // Strategy: Try the 377 Model.unpack() first. If it succeeds and the
        // vertex/face counts are plausible, it's already 377 format — return raw.
        // If it fails, try OsrsModel.decode() + toLegacy377().
        // As a fallback (if both fail), just return the raw bytes — many OSRS
        // models with version=0 are actually in old format and will decode
        // fine with the 377 Model.unpack() at runtime.

        // First, check if it looks like 377 format (18-byte trailer)
        if (data.length >= 18) {
            // Read the 377 trailer fields
            const vc = (data[data.length - 18] << 8) | data[data.length - 17];
            const fc = (data[data.length - 16] << 8) | data[data.length - 15];
            // Plausibility check: vertex/face counts should be reasonable
            if (vc > 0 && vc < 100000 && fc > 0 && fc < 100000) {
                // Likely 377 format — return raw bytes
                return data;
            }
        }

        // Try OSRS format (23-byte trailer)
        if (data.length >= 23) {
            const version = data[data.length - 23];
            if (version >= 1) {
                // OSRS format — decode and convert
                try {
                    const model = OsrsModel.decode(osrsModelId, data);
                    if (model) {
                        return model.toLegacy377();
                    }
                } catch (err) {
                    printWarning(`convertModel: OSRS conversion failed for model ${osrsModelId}: ${(err as Error).message}`);
                }
            }
        }

        // Fallback: return raw bytes (let the 377 engine try to decode it)
        printWarning(`convertModel: could not determine format for model ${osrsModelId}, returning raw bytes`);
        return data;
    }

    /**
     * Convert an OSRS animation frame to 377 format.
     *
     * OSRS stores 1 frame per file. The 377 format also supports 1 frame per file
     * (the head section has count=1). The base ID is in the OSRS blob's last 2 bytes.
     *
     * @param osrsAnimId The animation frame ID (file in the anim index)
     * @param idx The cache index for animations (default: 2 in OSRS, but LostCity uses its own)
     * @returns 377-format anim bytes, or null on failure
     */
    convertAnim(osrsAnimId: number, idx: number = 2): Uint8Array | null {
        const data = this.reader.read(idx, osrsAnimId);
        if (!data) {
            return null;
        }

        try {
            const frame = OsrsAnimFrame.decode(data, -1);
            if (!frame) {
                return null;
            }
            // Set the frame ID for the 377 output
            frame.frameId = osrsAnimId;
            return frame.toLegacy377();
        } catch (err) {
            printWarning(`convertAnim: conversion failed for anim ${osrsAnimId}: ${(err as Error).message}`);
            return null;
        }
    }

    /**
     * Convert an OSRS seq config to 377 format.
     *
     * The ONLY difference is op 1's count field: g2 in OSRS, g1 in 377.
     * All other opcodes are identical.
     *
     * @param osrsSeqBuf The raw OSRS seq config bytes (from seq.dat archive 12)
     * @returns 377-format seq config bytes
     */
    convertSeq(osrsSeqBuf: Uint8Array): Uint8Array | null {
        const p = new Packet(osrsSeqBuf);
        const out: number[] = [];

        while (p.available > 0) {
            const op = p.g1();
            out.push(op);

            if (op === 0) break; // terminator

            if (op === 1) {
                // Frame group: OSRS uses g2 count, 377 uses g1 count
                const count = p.g2();
                // Write as g1 (safe: real animations never exceed 255 frames)
                if (count > 255) {
                    printWarning(`convertSeq: frame count ${count} exceeds 255, truncating`);
                }
                out.push(count & 0xff);

                // Copy the rest: count × (g2 frame + g2 iframe + g2 delay)
                for (let i = 0; i < count; i++) {
                    const frame = p.g2();
                    out.push((frame >> 8) & 0xff, frame & 0xff);
                    const iframe = p.g2();
                    out.push((iframe >> 8) & 0xff, iframe & 0xff);
                    const delay = p.g2();
                    out.push((delay >> 8) & 0xff, delay & 0xff);
                }
            } else if (op === 2) {
                const v = p.g2();
                out.push((v >> 8) & 0xff, v & 0xff);
            } else if (op === 3) {
                const count = p.g1();
                out.push(count);
                for (let i = 0; i < count; i++) out.push(p.g1());
            } else if (op === 4) {
                // flag, no payload
            } else if (op === 5) {
                out.push(p.g1());
            } else if (op === 6 || op === 7) {
                const v = p.g2();
                out.push((v >> 8) & 0xff, v & 0xff);
            } else if (op === 8 || op === 9 || op === 10 || op === 11) {
                out.push(p.g1());
            } else if (op >= 12 && op <= 19) {
                // OSRS-only opcodes (animMaya, sounds, etc.) — skip in 377 output
                // These don't have 377 equivalents, so we drop them.
                // Payload sizes vary; we need to skip the right number of bytes.
                if (op === 12) {
                    // chat frame IDs: g1 count + g2 pairs
                    const c = p.g1();
                    for (let i = 0; i < c; i++) { p.g2(); p.g2(); }
                } else if (op === 13) {
                    // animMayaID: g4
                    p.g4();
                } else if (op === 14) {
                    // Maya frame sounds: g2 count + 8-byte entries
                    const c = p.g2();
                    for (let i = 0; i < c; i++) { p.g2(); p.g2(); p.g1(); p.g1(); p.g1(); p.g1(); }
                } else if (op === 15) {
                    // keyframe range: g2 + g2
                    p.g2(); p.g2();
                } else if (op === 17) {
                    // animMayaMasks: g1 count + g1 array
                    const c = p.g1();
                    for (let i = 0; i < c; i++) p.g1();
                } else if (op === 18) {
                    // debug name: gjstr
                    p.gjstr(0);
                }
                // op 16, 19: flags, no payload — nothing to skip
                // Don't write these ops to the 377 output
            } else if (op === 250) {
                // debugname: gjstr (null-terminated)
                const str = p.gjstr(0);
                out.push(str.length & 0xff);
                for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i));
                out.push(0); // null terminator
            } else {
                // Unknown opcode — copy raw and hope for the best
                printWarning(`convertSeq: unknown opcode ${op}, stopping`);
                break;
            }
        }

        return new Uint8Array(out);
    }

    /**
     * Convert an OSRS seq config and return the frame IDs it references.
     * Useful for tracing dependencies.
     */
    extractSeqFrameIds(osrsSeqBuf: Uint8Array): number[] {
        const p = new Packet(osrsSeqBuf);
        const frameIds: number[] = [];

        while (p.available > 0) {
            const op = p.g1();
            if (op === 0) break;

            if (op === 1) {
                const count = p.g2();
                for (let i = 0; i < count; i++) {
                    const frame = p.g2();
                    frameIds.push(frame);
                    p.g2(); // iframe
                    p.g2(); // delay
                }
            } else if (op === 2) { p.g2(); }
            else if (op === 3) { const c = p.g1(); for (let i = 0; i < c; i++) p.g1(); }
            else if (op === 4) {}
            else if (op === 5) { p.g1(); }
            else if (op === 6 || op === 7) { p.g2(); }
            else if (op === 8 || op === 9 || op === 10 || op === 11) { p.g1(); }
            else if (op === 250) { p.gjstr(0); }
            else break;
        }

        return frameIds;
    }
}
