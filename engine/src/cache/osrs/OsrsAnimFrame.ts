import AnimBase from '#/cache/graphics/AnimBase.js';
import Packet from '#/io/Packet.js';
import { printWarning } from '#/util/Logger.js';

/**
 * OSRS animation frame decoder.
 *
 * Mirrors the field shape of the existing 377 decoder at
 * `cache/graphics/AnimFrame.ts` so downstream consumers can be polymorphic:
 * both classes expose `delay`, `base`, `length`, `groups`, `x`, `y`, `z`.
 *
 * Key format differences vs 377:
 *   - 377 packs multiple frames per blob with a shared 4-section layout
 *     (head + tran1 + tran2 + del) and a trailing 8-byte meta footer.
 *   - OSRS packs ONE frame per blob. The blob is a single section:
 *       u16 frameLength, then per-group u8 flags + interleaved smart-encoded
 *       axis values, then a u8 delay. The LAST 2 bytes of the blob are the
 *       u16 base ID (AnimBase reference).
 *   - OSRS may carry optional trailing bytes after the delay byte for
 *     blended animation interpolation (`interpolationType`, optional
 *     `leftHandWeight` / `rightHandWeight`). These are best-effort parsed.
 *
 * The skeleton (AnimBase) format is shared between 377 and OSRS. This class
 * reuses the existing `AnimBase.instances[]` registry populated by the 377
 * `AnimBase.unpack()` path. Callers must ensure the referenced base is
 * loaded before invoking `decode()`; a null base causes decode to fail.
 *
 * Ported from RuneLite's `FrameDefinition.java`. The decode algorithm
 * matches the 377 `AnimFrame.unpack()` transform-group walk exactly — the
 * only difference is that flags and smart values come from the SAME buffer
 * (interleaved) instead of separate tran1/tran2 sections.
 */
export default class OsrsAnimFrame {
    // ---- Fields matching the 377 AnimFrame shape (for polymorphism) ----

    /** Frame delay in client ticks (typically 20ms each). */
    delay: number = 0;

    /** Index into `AnimBase.instances[]`. */
    base: number = 0;

    /** Number of emitted transform entries (length of groups/x/y/z). */
    length: number = 0;

    /** Bone index per emitted entry. */
    groups: Int32Array = new Int32Array();

    /** X-axis transform value per emitted entry. */
    x: Int32Array = new Int32Array();

    /** Y-axis transform value per emitted entry. */
    y: Int32Array = new Int32Array();

    /** Z-axis transform value per emitted entry. */
    z: Int32Array = new Int32Array();

    // ---- OSRS-only fields (not present in 377 AnimFrame) ----

    /**
     * Frame ID to assign when re-encoding as 377. The OSRS blob does NOT
     * carry a frame ID — only the base ID. Defaults to 0; callers should
     * override before calling `toLegacy377()` if they need a specific ID
     * routed into `AnimFrame.instances[id]`.
     */
    frameId: number = 0;

    /** Original group count from the OSRS frame (== tran1 section size when re-encoded). */
    frameLength: number = 0;

    /** Per-group typeFlag bytes (length = frameLength). 0 = no transform for that group. */
    flags: Int32Array = new Int32Array();

    /** Optional interpolation type (0 if absent in blob). */
    interpolationType: number = 0;

    /** Optional left-hand blend weight (-1 if absent in blob). */
    leftHandWeight: number = -1;

    /** Optional right-hand blend weight (-1 if absent in blob). */
    rightHandWeight: number = -1;

    /**
     * Decode a single OSRS anim frame blob.
     *
     * @param data raw frame bytes (must include the trailing 2-byte base ID)
     * @param baseId AnimBase index that this frame targets. The trailing 2
     *               bytes of `data` should match this; we cross-check and
     *               warn on mismatch but proceed using the parameter.
     * @returns decoded frame, or null on malformed input / missing base.
     */
    static decode(data: Uint8Array, baseId: number): OsrsAnimFrame | null {
        if (data.length < 4) {
            printWarning(`OsrsAnimFrame: blob too short (${data.length} bytes, need >= 4)`);
            return null;
        }

        // 1. Peek the trailing 2-byte base ID (informational cross-check).
        const trailer: Packet = new Packet(data);
        trailer.pos = data.length - 2;
        const trailingBaseId: number = trailer.g2();
        if (trailingBaseId !== baseId) {
            printWarning(
                `OsrsAnimFrame: trailing base ID ${trailingBaseId} does not match parameter ${baseId}`
            );
        }

        // 2. Body is everything except the trailing 2 bytes.
        const limit: number = data.length - 2;
        const packet: Packet = new Packet(data);

        if (packet.pos + 2 > limit) {
            printWarning('OsrsAnimFrame: body too short for frameLength');
            return null;
        }
        const frameLength: number = packet.g2();

        const base: AnimBase | undefined = AnimBase.instances[baseId];
        if (!base) {
            printWarning(`OsrsAnimFrame: AnimBase ${baseId} not loaded`);
            return null;
        }
        if (base.length < frameLength) {
            printWarning(
                `OsrsAnimFrame: frameLength ${frameLength} exceeds base.length ${base.length}`
            );
            return null;
        }

        // 3. Decode transform groups (interleaved flag byte + smart values).
        const flagsArr: Int32Array = new Int32Array(frameLength);
        const MAX_ENTRIES: number = 500;
        const bases: Int32Array = new Int32Array(MAX_ENTRIES);
        const xs: Int32Array = new Int32Array(MAX_ENTRIES);
        const ys: Int32Array = new Int32Array(MAX_ENTRIES);
        const zs: Int32Array = new Int32Array(MAX_ENTRIES);
        let length: number = 0;
        let lastGroup: number = -1;

        for (let group: number = 0; group < frameLength; group++) {
            if (packet.pos >= limit) {
                printWarning(
                    `OsrsAnimFrame: ran out of bytes reading flag for group ${group}/${frameLength}`
                );
                return null;
            }
            const flags: number = packet.g1();
            flagsArr[group] = flags;
            if (flags === 0) {
                continue;
            }

            // Synthetic OP_BASE pull-forward — matches 377 AnimFrame.unpack()
            // exactly. When a non-OP_BASE bone has a transform, we walk back
            // to the most recent OP_BASE bone (between lastGroup+1 and group-1)
            // and emit a zero-value entry for it so the renderer keeps the
            // parent bone's transform in sync.
            if (base.types[group] !== AnimBase.OP_BASE) {
                for (let cur: number = group - 1; cur > lastGroup; cur--) {
                    if (base.types[cur] === AnimBase.OP_BASE) {
                        bases[length] = cur;
                        xs[length] = 0;
                        ys[length] = 0;
                        zs[length] = 0;
                        length++;
                        break;
                    }
                }
            }

            bases[length] = group;
            const defaultValue: number = base.types[group] === AnimBase.OP_SCALE ? 128 : 0;

            if (flags & 0x1) {
                if (packet.pos + 1 > limit) {
                    printWarning(`OsrsAnimFrame: ran out of bytes reading X for group ${group}`);
                    return null;
                }
                xs[length] = packet.gsmart();
            } else {
                xs[length] = defaultValue;
            }
            if (flags & 0x2) {
                if (packet.pos + 1 > limit) {
                    printWarning(`OsrsAnimFrame: ran out of bytes reading Y for group ${group}`);
                    return null;
                }
                ys[length] = packet.gsmart();
            } else {
                ys[length] = defaultValue;
            }
            if (flags & 0x4) {
                if (packet.pos + 1 > limit) {
                    printWarning(`OsrsAnimFrame: ran out of bytes reading Z for group ${group}`);
                    return null;
                }
                zs[length] = packet.gsmart();
            } else {
                zs[length] = defaultValue;
            }

            lastGroup = group;
            length++;
        }

        // 4. Frame delay.
        if (packet.pos + 1 > limit) {
            printWarning('OsrsAnimFrame: no delay byte available');
            return null;
        }
        const delay: number = packet.g1();

        // 5. Optional interpolation tail (best-effort — see class docstring).
        let interpolationType: number = 0;
        let leftHandWeight: number = -1;
        let rightHandWeight: number = -1;
        const remaining: number = limit - packet.pos;
        if (remaining >= 1) {
            interpolationType = packet.g1();
            // Layout used by RuneLite: when the interpolation byte is present
            // and at least 4 more bytes follow, read two u16 blend weights.
            if (remaining >= 5) {
                leftHandWeight = packet.g2();
                rightHandWeight = packet.g2();
            }
        }

        const frame: OsrsAnimFrame = new OsrsAnimFrame();
        frame.delay = delay;
        frame.base = baseId;
        frame.length = length;
        frame.groups = new Int32Array(length);
        frame.x = new Int32Array(length);
        frame.y = new Int32Array(length);
        frame.z = new Int32Array(length);
        for (let i: number = 0; i < length; i++) {
            frame.groups[i] = bases[i];
            frame.x[i] = xs[i];
            frame.y[i] = ys[i];
            frame.z[i] = zs[i];
        }
        frame.frameLength = frameLength;
        frame.flags = flagsArr;
        frame.interpolationType = interpolationType;
        frame.leftHandWeight = leftHandWeight;
        frame.rightHandWeight = rightHandWeight;
        return frame;
    }

    /**
     * Re-encode this OSRS frame as a single-frame 377 anim blob.
     *
     * The 377 format packs multiple frames per blob with a shared 4-section
     * layout. We emit a 1-frame blob so the existing 377 client/server can
     * consume it unchanged:
     *
     *   body layout (read back-to-front by `AnimFrame.unpack()`):
     *     [head section]    total=u16(1), id=u16(frameId), groupCount=u8
     *     [tran1 section]  flags per group (u8 each, including zeros)
     *     [tran2 section]  smart-encoded axis values (only for set bits)
     *     [del section]    delay=u8
     *     [base data]      AnimBase binary (length u8, types, labels)
     *   meta footer (last 8 bytes):
     *     headLen=u16, tran1Len=u16, tran2Len=u16, delLen=u16
     *
     * `headLen` is stored as `headSection.length - 2` because the existing
     * 377 decoder computes `pos += meta.g2() + 2` — the head section size
     * excludes the leading 2-byte total count.
     *
     * Limitations (OSRS-only data dropped on re-encode):
     *   - `interpolationType`, `leftHandWeight`, `rightHandWeight` have no
     *     377 equivalent and are dropped. Blended animations will fall back
     *     to standard single-frame playback.
     *   - `frameId` is required by 377 but not stored in the OSRS blob. It
     *     defaults to 0; callers should override this field before invoking
     *     `toLegacy377()` if they need a specific ID routed into
     *     `AnimFrame.instances[id]`.
     */
    toLegacy377(): Uint8Array {
        const base: AnimBase | undefined = AnimBase.instances[this.base];
        if (!base) {
            throw new Error(`OsrsAnimFrame.toLegacy377: AnimBase ${this.base} not loaded`);
        }

        // ---- head section: total=u16(1), id=u16(frameId), groupCount=u8 ----
        const head: number[] = [];
        pushU16(head, 1);
        pushU16(head, this.frameId & 0xffff);
        head.push(this.frameLength & 0xff);
        const headLen: number = head.length;

        // ---- tran1 section: u8 flag per group (frameLength bytes, including zeros) ----
        const tran1: number[] = new Array(this.frameLength);
        for (let i: number = 0; i < this.frameLength; i++) {
            tran1[i] = this.flags[i] & 0xff;
        }
        const tran1Len: number = tran1.length;

        // ---- tran2 section: smart-encoded values for each SET axis bit ----
        // Iterate emitted entries in order; skip synthetic OP_BASE pull-forward
        // entries (their bone's flag is 0 — they don't read from tran2).
        const tran2: number[] = [];
        for (let i: number = 0; i < this.length; i++) {
            const bone: number = this.groups[i];
            if (bone >= this.frameLength) {
                continue;
            }
            const f: number = this.flags[bone];
            if (f === 0) {
                continue;
            }
            if (f & 0x1) {
                psmartSigned(tran2, this.x[i]);
            }
            if (f & 0x2) {
                psmartSigned(tran2, this.y[i]);
            }
            if (f & 0x4) {
                psmartSigned(tran2, this.z[i]);
            }
        }
        const tran2Len: number = tran2.length;

        // ---- del section: delay u8 ----
        const del: number[] = [this.delay & 0xff];
        const delLen: number = del.length;

        // ---- base data: AnimBase binary ----
        // Layout (matches `AnimBase.unpack()`):
        //   length u8, types u8*length,
        //   labels: per i, count u8 + u8*count
        const baseData: number[] = [];
        baseData.push(base.length & 0xff);
        for (let i: number = 0; i < base.length; i++) {
            baseData.push(base.types[i] & 0xff);
        }
        for (let i: number = 0; i < base.length; i++) {
            const lbl: Int32Array = base.labels[i];
            baseData.push(lbl.length & 0xff);
            for (let j: number = 0; j < lbl.length; j++) {
                baseData.push(lbl[j] & 0xff);
            }
        }

        // ---- assemble: [head][tran1][tran2][del][baseData][meta8] ----
        const bodyLen: number = headLen + tran1Len + tran2Len + delLen + baseData.length;
        const out: Packet = new Packet(new Uint8Array(bodyLen + 8));
        for (const b of head) {
            out.p1(b);
        }
        for (const b of tran1) {
            out.p1(b);
        }
        for (const b of tran2) {
            out.p1(b);
        }
        for (const b of del) {
            out.p1(b);
        }
        for (const b of baseData) {
            out.p1(b);
        }
        // 377 meta footer — headLen is stored minus 2 (the leading total u16).
        out.p2(headLen - 2);
        out.p2(tran1Len);
        out.p2(tran2Len);
        out.p2(delLen);
        return out.data;
    }
}

/**
 * Push a big-endian u16 into a byte array.
 */
function pushU16(out: number[], v: number): void {
    out.push((v >> 8) & 0xff);
    out.push(v & 0xff);
}

/**
 * Append a signed smart-encoded value to a byte buffer.
 *
 * Matches the format read by `Packet.gsmart()`:
 *   - value in [-64, 63]        -> 1 byte  = value + 0x40
 *   - value in [-16384, 16383]  -> 2 bytes = value + 0xc000 (big-endian)
 *
 * LostCity's `Packet.psmart()` only handles non-negative values, hence the
 * local helper. Mirrors the helper in `OsrsModel.ts` (task 5-a) — if this
 * proves generally useful it should be hoisted into `Packet.ts` as
 * `psmartSigned()` in a future task.
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
