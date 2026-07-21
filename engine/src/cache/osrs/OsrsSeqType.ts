import { ConfigType } from '#/cache/config/ConfigType.js';
import Packet from '#/io/Packet.js';

/**
 * OSRS sequence (`seq`) config decoder.
 *
 * Sibling class to the existing 377 `SeqType` at
 * `engine/src/cache/config/SeqType.ts`. Mirrors the 377 field set so
 * downstream consumers can be polymorphic, and extends the opcode set with
 * OSRS-only codes 12..15:
 *
 *   - 12: `field12: u32`                (carried over from the Java client's
 *                                         `field790` — opaque 32-bit field)
 *   - 13: `leftHandItem: u16`           (OSRS — left-hand item override)
 *   - 14: `rightHandItem: u16`          (OSRS — right-hand item override)
 *   - 15: `replayFrameDelay: u16`       (OSRS — delay between replays)
 *
 * Codes 16+ (sub-frame references used by blended/glide animations) are
 * not yet decoded — the spec describes them only as "16+ for sub-frame
 * references" without a layout. They will throw here so the dep tracer
 * (task 6) can flag any sequence that uses them.
 *
 * Why a sibling class instead of `extends SeqType`?
 *   - The 377 `SeqType` has private static `configs[]` / `configNames` and
 *     bound `load/parse/get` methods. Subclassing would inherit those
 *     statics verbatim (writing into the shared 377 registry), which is
 *     NOT what the modular pipeline wants — OSRS seqs must live in their
 *     own registry so the variant selector can pick which one to serve.
 *   - Mirrors the sibling-class pattern used by `OsrsModel.ts` (task 5-a).
 *
 * Note: the 377 `decode()` does a `AnimFrame.instances[frames[i]]?.delay`
 * fallback when a seq frame's delay is 0. We omit that here because
 * `OsrsAnimFrame` is a one-shot decoder without a runtime instances[]
 * registry — the modular pipeline is expected to do a post-decode pass to
 * fill in any zero delays if it cares about the `duration` sum.
 */
export default class OsrsSeqType extends ConfigType {
    static configNames = new Map<string, number>();
    static configs: OsrsSeqType[] = [];

    static get(id: number): OsrsSeqType {
        return OsrsSeqType.configs[id];
    }

    static getId(name: string): number {
        return OsrsSeqType.configNames.get(name) ?? -1;
    }

    static getByName(name: string): OsrsSeqType | null {
        const id: number = this.getId(name);
        if (id === -1) {
            return null;
        }
        return this.get(id);
    }

    static get count(): number {
        return OsrsSeqType.configs.length;
    }

    // ---- 377 shared fields (mirrors SeqType) ----

    frameCount: number = 0;
    frames: Int32Array | null = null;
    iframes: Int32Array | null = null;
    delay: Int32Array | null = null;
    loops: number = -1;
    walkmerge: Int32Array | null = null;
    stretches: boolean = false;
    priority: number = 5;
    replaceheldleft: number = -1;
    replaceheldright: number = -1;
    maxloops: number = 99;
    preanim_move: number = -1;
    postanim_move: number = -1;
    duplicatebehavior: number = 0;

    // precalculated for seqlength (note: does not include frame-delay fallback)
    duration: number = 0;

    // ---- OSRS-only fields ----

    /** Opaque 32-bit field from Java client code 12 (`field790`). 0 = unset. */
    field12: number = 0;

    /** OSRS code 13: left-hand item override (-1 = none). */
    leftHandItem: number = -1;

    /** OSRS code 14: right-hand item override (-1 = none). */
    rightHandItem: number = -1;

    /** OSRS code 15: delay (in client ticks) between replays. -1 = unset. */
    replayFrameDelay: number = -1;

    constructor(id: number) {
        super(id);
    }

    decode(code: number, dat: Packet): void {
        if (code === 1) {
            this.frameCount = dat.g1();
            this.frames = new Int32Array(this.frameCount);
            this.iframes = new Int32Array(this.frameCount);
            this.delay = new Int32Array(this.frameCount);

            for (let i: number = 0; i < this.frameCount; i++) {
                this.frames[i] = dat.g2();

                this.iframes[i] = dat.g2();
                if (this.iframes[i] === 65535) {
                    this.iframes[i] = -1;
                }

                this.delay[i] = dat.g2();
                // 377 SeqType falls back to AnimFrame.instances[] here when
                // delay is 0. OsrsAnimFrame has no runtime registry — leave
                // 0 as-is and let the pipeline post-process if needed.
                if (this.delay[i] === 0) {
                    this.delay[i] = 1;
                }

                this.duration += this.delay[i];
            }
        } else if (code === 2) {
            this.loops = dat.g2();
        } else if (code === 3) {
            const count: number = dat.g1();
            this.walkmerge = new Int32Array(count + 1);

            for (let i: number = 0; i < count; i++) {
                this.walkmerge[i] = dat.g1();
            }

            this.walkmerge[count] = 9999999;
        } else if (code === 4) {
            this.stretches = true;
        } else if (code === 5) {
            this.priority = dat.g1();
        } else if (code === 6) {
            this.replaceheldleft = dat.g2();
        } else if (code === 7) {
            this.replaceheldright = dat.g2();
        } else if (code === 8) {
            this.maxloops = dat.g1();
        } else if (code === 9) {
            this.preanim_move = dat.g1();
        } else if (code === 10) {
            this.postanim_move = dat.g1();
        } else if (code === 11) {
            this.duplicatebehavior = dat.g1();
        } else if (code === 12) {
            // Present in the Java client but not in the 377 TS decoder.
            // Opaque 32-bit value; meaning not documented upstream.
            this.field12 = dat.g4();
        } else if (code === 13) {
            // OSRS — left-hand item override.
            this.leftHandItem = dat.g2();
        } else if (code === 14) {
            // OSRS — right-hand item override.
            this.rightHandItem = dat.g2();
        } else if (code === 15) {
            // OSRS — replay delay between loops.
            this.replayFrameDelay = dat.g2();
        } else if (code === 250) {
            this.debugname = dat.gjstr();
        } else {
            // Codes 16+ are documented as "sub-frame references" in the task
            // spec but the layout is unspecified. Let the dep tracer flag
            // any seq that uses them rather than silently dropping data.
            throw new Error(`Unrecognized osrs seq config code: ${code}`);
        }
    }

    postDecode(): void {
        if (this.frameCount === 0) {
            this.frameCount = 1;
            this.frames = new Int32Array(1);
            this.frames[0] = -1;
            this.iframes = new Int32Array(1);
            this.iframes[0] = -1;
            this.delay = new Int32Array(1);
            this.delay[0] = -1;
        }

        if (this.preanim_move === -1) {
            if (this.walkmerge === null) {
                this.preanim_move = 0;
            } else {
                this.preanim_move = 2;
            }
        }

        if (this.postanim_move === -1) {
            if (this.walkmerge === null) {
                this.postanim_move = 0;
            } else {
                this.postanim_move = 2;
            }
        }
    }
}
