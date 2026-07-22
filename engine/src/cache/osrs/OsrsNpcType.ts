import { ConfigType } from '#/cache/config/ConfigType.js';
import { ParamHelper, ParamMap } from '#/cache/config/ParamHelper.js';
import Packet from '#/io/Packet.js';
import { printDebug, printWarning } from '#/util/Logger.js';

/**
 * OSRS NPC config decoder.
 *
 * Sibling class to the existing 377 `NpcType` at
 * `engine/src/cache/config/NpcType.ts`. Mirrors the 377 field set so
 * downstream consumers can be polymorphic, and extends the opcode set with
 * OSRS-only codes 23..29 and 118..134.
 *
 * The OSRS NPC opcode set is a strict superset of 377: every 377 opcode
 * still decodes the same way, plus the new OSRS opcodes below. This decoder
 * reads BOTH so it can consume an OSRS-format `npc.dat` directly.
 *
 * Why a sibling class instead of `extends NpcType`?
 *   - The 377 `NpcType` has private static `configs[]` / `configNames` and
 *     bound `load/parse/get` methods that route configs into the shared 377
 *     registry. Subclassing would inherit those statics verbatim and write
 *     OSRS NPC configs into the live 377 registry — exactly what the
 *     modular pipeline wants to avoid.
 *   - Mirrors the sibling-class pattern used by `OsrsModel.ts` (task 5-a)
 *     and `OsrsSeqType.ts` (task 5-b).
 *
 * LostCity server-side opcodes 200..214 (wanderrange, maxrange, moverestrict,
 * patrol, etc) only appear in the server-side `npc.dat` that LostCity
 * itself generates — they are NOT part of the OSRS spec. This decoder
 * reads-and-discards their payloads (so it can parse a LostCity npc.dat
 * without crashing) and logs a debug message per skipped code.
 *
 * Ported from RuneLite's `NpcDefinition.java`. Field naming matches the
 * existing 377 `NpcType.ts` for the inherited fields; OSRS-only fields
 * follow RuneLite naming (snake_case to match LostCity style).
 */
export default class OsrsNpcType extends ConfigType {
    static configNames = new Map<string, number>();
    static configs: OsrsNpcType[] = [];

    static get(id: number): OsrsNpcType {
        return OsrsNpcType.configs[id];
    }

    static getId(name: string): number {
        return OsrsNpcType.configNames.get(name) ?? -1;
    }

    static getByName(name: string): OsrsNpcType | null {
        const id: number = this.getId(name);
        if (id === -1) {
            return null;
        }
        return this.get(id);
    }

    static get count(): number {
        return OsrsNpcType.configs.length;
    }

    // ---- 377 shared fields (mirrors NpcType.ts) ----

    name: string | null = null;
    desc: string | null = null;
    size: number = 1;
    models: Uint16Array | null = null;
    heads: Uint16Array | null = null;
    hasanim: boolean = false; // code 16 (sets flag, no payload)
    readyanim: number = -1;
    walkanim: number = -1;
    walkanim_b: number = -1;
    walkanim_r: number = -1;
    walkanim_l: number = -1;
    hasalpha: boolean = false; // code 16 (NPC variant) — kept for parity with NpcType
    recol_s: Uint16Array | null = null;
    recol_d: Uint16Array | null = null;
    /**
     * Operation/menu labels. The 377 spec uses opcodes 30..34 for `op1..op5`
     * (5 entries). OSRS adds opcode 27 which writes additional entries with
     * an explicit u8 index — typically indices 5..9 (`op6..op10`). We size
     * the array lazily up to 10 entries to accommodate both.
     */
    op: (string | null)[] | null = null;
    resizex: number = -1;
    resizey: number = -1;
    resizez: number = -1;
    minimap: boolean = true;
    vislevel: number = -1;
    resizeh: number = 128;
    resizev: number = 128;
    alwaysontop: boolean = false;
    ambient: number = 0;
    contrast: number = 0;
    headicon: number = -1;
    turnspeed: number = 32;
    multivarbit: number = -1;
    multivarp: number = -1;
    multinpc: number[] = [];
    active: boolean = true;

    /** Code 18 — kept for legacy 377 compat (OSRS uses opcode 23 for walk anims). */
    category: number = -1;

    /** Combat stats [atk, def, str, hp, range, mage] — codes 74..79. */
    stats: number[] = [1, 1, 1, 1, 1, 1];

    params: ParamMap = new Map();

    // ---- OSRS-only fields ----

    /**
     * Code 23 (5 shorts): stand, walk, walkL, walkR, walkB.
     * Overwrites readyanim/walkanim/walkanim_l/walkanim_r/walkanim_b — these
     * are the same fields the legacy 377 opcodes 13/14/17 populate, so any
     * 377 consumer picks them up transparently.
     *
     * Note: the task spec listed "(stand, walk, walkL, walkR, walkB, run)" —
     * 6 names but only 5 shorts. The trailing "run" is a spec typo; standard
     * RuneLite reads exactly 5 shorts here.
     */

    /**
     * Code 24 (4 shorts): run, runL, runR, runB. New OSRS run-animation
     * family; 377 has no equivalent.
     */
    runanim: number = -1;
    runanim_l: number = -1;
    runanim_r: number = -1;
    runanim_b: number = -1;

    /**
     * Code 25 (4 shorts): crawl, crawlL, crawlR, crawlB.
     * Code 26 (5 shorts): crawl, crawlL, crawlR, crawlB, crawlBack2 —
     * overwrites the 4 crawl fields from code 25 (last write wins) and
     * additionally populates `crawlanim_b2`. The task spec field label
     * says "runanim code 26" but the listed values are all crawl-related —
     * treated as a spec typo and decoded as crawl data.
     */
    crawlanim: number = -1;
    crawlanim_l: number = -1;
    crawlanim_r: number = -1;
    crawlanim_b: number = -1;
    /** 5th short from code 26; only set when code 26 is present. */
    crawlanim_b2: number = -1;

    /**
     * Codes 28 / 29: texture-mapped recolors.
     *
     * Both opcodes read `count + (g2 src, g2 dst) * count` — same shape as
     * code 40. The task spec describes code 28 as "recol_d_texture (dst)"
     * and code 29 as "recol_s/d texture (paired with 28)" without
     * elaborating on the semantic distinction; both are stored in the same
     * parallel arrays and the last opcode to appear wins (matching how
     * legacy opcode 40 behaves on repeat).
     */
    recol_s_tex: Uint16Array | null = null;
    recol_d_tex: Uint16Array | null = null;

    /** Code 124: height (u16). */
    height: number = -1;
    /** Code 126: footprintSize (u16). */
    footprintSize: number = -1;
    /** Code 146: overlapTintHSL (u16). */
    overlapTintHSL: number = -1;
    /** Code 129: unknown1 flag. */
    unknown1: boolean = false;
    /** Code 130: idleAnimRestart flag. */
    idleAnimRestart: boolean = false;
    /** Code 145: canHideForOverlap flag. */
    canHideForOverlap: boolean = false;
    /** Code 147: zbuf flag (false = disable z-buffer). */
    zbuf: boolean = true;
    /** Code 109: rotationFlag (false = don't rotate to face player). */
    rotationFlag: boolean = true;
    /** Code 111: renderPriority (2 = very high). */
    renderPriority: number = 0;
    /** Code 122: isFollower flag. */
    isFollower: boolean = false;
    /** Code 123: lowPriorityFollowerOps flag. */
    lowPriorityFollowerOps: boolean = false;
    /** Code 15: idleRotateLeftAnimation. */
    idleRotateLeftAnim: number = -1;
    /** Code 16: idleRotateRightAnimation. */
    idleRotateRightAnim: number = -1;
    /**
     * Code 102 (rev >= 1493): head icon bitfield form.
     * headIconArchiveIds[i] / headIconSpriteIndex[i] parallel arrays.
     */
    headIconArchiveIds: Int32Array | null = null;
    headIconSpriteIndex: Int16Array | null = null;
    /**
     * Code 61: models with 32-bit IDs (for caches with >65535 models).
     * Code 62: chatheadModels with 32-bit IDs.
     */
    models32: Int32Array | null = null;
    chatheadModels32: Int32Array | null = null;

    constructor(id: number) {
        super(id);
    }

    decode(code: number, dat: Packet): void {
        // ------------------------------------------------------------------
        // Opcodes ported EXACTLY from RuneLite's NpcLoader.java (rev 237).
        // The modern OSRS npc.dat uses this opcode set. Any opcode not listed
        // here is unrecognized — RuneLite logs a warning and reads ZERO bytes
        // (which would desync the stream if the opcode carried a payload).
        // ------------------------------------------------------------------
        if (code === 1) {
            // models[] with 16-bit IDs
            const count: number = dat.g1();
            this.models = new Uint16Array(count);
            for (let i: number = 0; i < count; i++) {
                this.models[i] = dat.g2();
            }
        } else if (code === 2) {
            this.name = dat.gjstr(0);
        } else if (code === 12) {
            this.size = dat.g1();
        } else if (code === 13) {
            this.readyanim = dat.g2();
        } else if (code === 14) {
            this.walkanim = dat.g2();
        } else if (code === 15) {
            this.idleRotateLeftAnim = dat.g2();
        } else if (code === 16) {
            this.idleRotateRightAnim = dat.g2();
        } else if (code === 17) {
            this.walkanim = dat.g2();
            this.walkanim_b = dat.g2();
            this.walkanim_l = dat.g2();
            this.walkanim_r = dat.g2();
        } else if (code === 18) {
            this.category = dat.g2();
        } else if (code >= 30 && code < 35) {
            if (!this.op) {
                this.op = new Array(10).fill(null);
            }
            this.op[code - 30] = dat.gjstr(0);
        } else if (code === 40) {
            const count: number = dat.g1();
            this.recol_s = new Uint16Array(count);
            this.recol_d = new Uint16Array(count);
            for (let i: number = 0; i < count; i++) {
                this.recol_s[i] = dat.g2();
                this.recol_d[i] = dat.g2();
            }
        } else if (code === 41) {
            const count: number = dat.g1();
            this.recol_s_tex = new Uint16Array(count);
            this.recol_d_tex = new Uint16Array(count);
            for (let i: number = 0; i < count; i++) {
                this.recol_s_tex[i] = dat.g2();
                this.recol_d_tex[i] = dat.g2();
            }
        } else if (code === 60) {
            const count: number = dat.g1();
            this.heads = new Uint16Array(count);
            for (let i: number = 0; i < count; i++) {
                this.heads[i] = dat.g2();
            }
        } else if (code === 61) {
            const count: number = dat.g1();
            this.models32 = new Int32Array(count);
            for (let i: number = 0; i < count; i++) {
                this.models32[i] = dat.g4();
            }
        } else if (code === 62) {
            const count: number = dat.g1();
            this.chatheadModels32 = new Int32Array(count);
            for (let i: number = 0; i < count; i++) {
                this.chatheadModels32[i] = dat.g4();
            }
        } else if (code === 74) {
            this.stats[0] = dat.g2();
        } else if (code === 75) {
            this.stats[1] = dat.g2();
        } else if (code === 76) {
            this.stats[2] = dat.g2();
        } else if (code === 77) {
            this.stats[3] = dat.g2();
        } else if (code === 78) {
            this.stats[4] = dat.g2();
        } else if (code === 79) {
            this.stats[5] = dat.g2();
        } else if (code === 93) {
            this.minimap = false;
        } else if (code === 95) {
            this.vislevel = dat.g2();
        } else if (code === 97) {
            this.resizeh = dat.g2();
        } else if (code === 98) {
            this.resizev = dat.g2();
        } else if (code === 99) {
            this.renderPriority = 1;
        } else if (code === 100) {
            this.ambient = dat.g1b();
        } else if (code === 101) {
            this.contrast = dat.g1b();
        } else if (code === 102) {
            // rev210+ head icons: bitfield form
            const bitfield: number = dat.g1();
            let len = 0;
            for (let v = bitfield; v !== 0; v >>= 1) len++;
            this.headIconArchiveIds = new Int32Array(len);
            this.headIconSpriteIndex = new Int16Array(len);
            for (let i = 0; i < len; i++) {
                if ((bitfield & (1 << i)) === 0) {
                    this.headIconArchiveIds[i] = -1;
                    this.headIconSpriteIndex[i] = -1;
                } else {
                    const peek = dat.data[dat.pos];
                    if (peek >= 128) {
                        this.headIconArchiveIds[i] = dat.g4() & 0x7FFFFFFF;
                    } else {
                        const v = dat.g2();
                        this.headIconArchiveIds[i] = v === 32767 ? -1 : v;
                    }
                    const peek2 = dat.data[dat.pos];
                    if (peek2 < 128) {
                        this.headIconSpriteIndex[i] = dat.g1() - 1;
                    } else {
                        this.headIconSpriteIndex[i] = dat.g2() - 0x8001;
                    }
                }
            }
        } else if (code === 103) {
            this.turnspeed = dat.g2();
        } else if (code === 106) {
            this.multivarbit = dat.g2();
            if (this.multivarbit === 65535) this.multivarbit = -1;
            this.multivarp = dat.g2();
            if (this.multivarp === 65535) this.multivarp = -1;
            const count: number = dat.g1();
            this.multinpc = new Array(count + 2);
            for (let i: number = 0; i <= count; i++) {
                this.multinpc[i] = dat.g2();
                if (this.multinpc[i] === 65535) this.multinpc[i] = -1;
            }
            this.multinpc[count + 1] = -1;
        } else if (code === 107) {
            this.active = false;
        } else if (code === 109) {
            this.rotationFlag = false;
        } else if (code === 111) {
            this.renderPriority = 2;
        } else if (code === 114) {
            this.runanim = dat.g2();
        } else if (code === 115) {
            this.runanim = dat.g2();
            this.runanim_b = dat.g2();
            this.runanim_l = dat.g2();
            this.runanim_r = dat.g2();
        } else if (code === 116) {
            this.crawlanim = dat.g2();
        } else if (code === 117) {
            this.crawlanim = dat.g2();
            this.crawlanim_b = dat.g2();
            this.crawlanim_l = dat.g2();
            this.crawlanim_r = dat.g2();
        } else if (code === 118) {
            this.multivarbit = dat.g2();
            if (this.multivarbit === 65535) this.multivarbit = -1;
            this.multivarp = dat.g2();
            if (this.multivarp === 65535) this.multivarp = -1;
            const fallbackVar = dat.g2();
            const count: number = dat.g1();
            this.multinpc = new Array(count + 2);
            for (let i: number = 0; i <= count; i++) {
                this.multinpc[i] = dat.g2();
                if (this.multinpc[i] === 65535) this.multinpc[i] = -1;
            }
            this.multinpc[count + 1] = fallbackVar === 0xFFFF ? -1 : fallbackVar;
        } else if (code === 122) {
            this.isFollower = true;
        } else if (code === 123) {
            this.lowPriorityFollowerOps = true;
        } else if (code === 124) {
            this.height = dat.g2();
        } else if (code === 126) {
            this.footprintSize = dat.g2();
        } else if (code === 129) {
            this.unknown1 = true;
        } else if (code === 130) {
            this.idleAnimRestart = true;
        } else if (code === 145) {
            this.canHideForOverlap = true;
        } else if (code === 146) {
            this.overlapTintHSL = dat.g2();
        } else if (code === 147) {
            this.zbuf = false;
        } else if (code === 249) {
            this.params = ParamHelper.decodeParams(dat);
        } else if (code === 250) {
            this.debugname = dat.gjstr(0);
        } else if (code >= 200 && code <= 214) {
            this.skipLostCityServerCode(code, dat);
        } else {
            printWarning(`Unrecognized osrs npc config code: ${code} (npc id=${this.id})`);
        }
    }

    /**
     * Shared reader for opcodes 28 / 29 (texture-mapped recolors).
     * Shape: u8 count, then `count` pairs of (u16 src, u16 dst).
     * Stores into `recol_s_tex` / `recol_d_tex` (last opcode wins).
     */
    private decodeTexRecolors(dat: Packet): void {
        const count: number = dat.g1();
        this.recol_s_tex = new Uint16Array(count);
        this.recol_d_tex = new Uint16Array(count);
        for (let i: number = 0; i < count; i++) {
            this.recol_s_tex[i] = dat.g2();
            this.recol_d_tex[i] = dat.g2();
        }
    }

    /**
     * Read-and-discard the payload of a LostCity server-side opcode
     * (200..214). The format mirrors the existing `NpcType.decode()` switch
     * so the OSRS decoder can consume a LostCity npc.dat without crashing.
     *
     * The discarded values are intentionally NOT stored on this class —
     * OSRS-format NPCs don't carry these fields, and the modular pipeline
     * is expected to layer server-side config on top via the content
     * folder rather than the cache.
     */
    private skipLostCityServerCode(code: number, dat: Packet): void {
        printDebug(`OsrsNpcType: skipping LostCity server-side code ${code} (npc id=${this.id})`);
        switch (code) {
            case 200: dat.g2(); break; // wanderrange
            case 201: dat.g2(); break; // maxrange
            case 202: dat.g1(); break; // huntrange
            case 203: dat.g2(); break; // timer
            case 204: dat.g2(); break; // respawnrate
            case 206: dat.g1(); break; // moverestrict
            case 207: dat.g2(); break; // attackrange
            case 208: dat.g1(); break; // blockwalk
            case 209: dat.g1(); break; // huntmode
            case 210: dat.g1(); break; // defaultmode
            case 211: break;            // members (no payload)
            case 212: {                 // patrol (variable length)
                const count: number = dat.g1();
                for (let i: number = 0; i < count; i++) {
                    dat.g4s();
                    dat.g1();
                }
                break;
            }
            case 213: break;            // givechase (no payload)
            case 214: dat.g2(); break; // regenrate
            default:
                // Code 205 is unused in LostCity's NpcType — if it appears,
                // we have no way to know its payload length. Bail loudly.
                printWarning(`OsrsNpcType: unknown LostCity server code ${code} with unknown payload (npc id=${this.id})`);
                break;
        }
    }

    /**
     * Emit the ini-style `[debugname]` config lines that the LostCity
     * content folder uses (matching the format produced by
     * `engine/tools/unpack/config/NpcConfig.ts`).
     *
     * 377 fields are emitted using the same key names the unpack tool
     * produces (`name=`, `desc=`, `model1=`, `readyanim=`, `op1=`, etc).
     * OSRS-only fields are emitted as `param=osrs_<field>,<value>` entries
     * so they survive the round-trip into the content folder — when the
     * content folder is re-packed into `npc.dat`, the param encoder will
     * preserve them as opaque param values keyed by well-known param IDs
     * (the modular variant registry is expected to register those param
     * IDs as part of task 9).
     *
     * Asset IDs (model IDs, seq IDs, npc IDs) are emitted as RAW INTEGERS
     * rather than resolved names. This deliberately decouples the engine
     * class from the `#tools/pack/PackFile.js` lookups — task 8
     * (content-folder writer) is expected to post-process these lines to
     * rename IDs to debugnames via SeqPack/NpcPack/ModelPack. The format
     * `key=<int>` survives the round-trip into the content folder because
     * LostCity's config parser accepts both names and integer literals.
     *
     * @returns array of ini-style lines, suitable for writing to a
     *          `.npc` file in `content/scripts/npc/configs/`.
     */
    toLegacy377NpcConfig(): string[] {
        const lines: string[] = [];

        // Header — use debugname if present, else fall back to npc_<id>.
        const header: string = this.debugname ?? `npc_${this.id}`;
        lines.push(`[${header}]`);

        // Identity / display fields.
        if (this.name !== null) {
            lines.push(`name=${this.name}`);
        }
        if (this.desc !== null) {
            lines.push(`desc=${this.desc}`);
        }
        if (this.size !== 1) {
            lines.push(`size=${this.size}`);
        }

        // Models — emit one line per model, 1-indexed.
        if (this.models) {
            for (let i: number = 0; i < this.models.length; i++) {
                lines.push(`model${i + 1}=${this.models[i]}`);
            }
        }

        // Heads — emit one line per head model.
        if (this.heads) {
            for (let i: number = 0; i < this.heads.length; i++) {
                lines.push(`head${i + 1}=${this.heads[i]}`);
            }
        }

        // Animations — emit raw seq IDs. walkanim emits as a 4-tuple if the
        // back/left/right variants are set (matches the unpack tool's
        // comma-separated format).
        if (this.readyanim !== -1) {
            lines.push(`readyanim=${this.readyanim}`);
        }
        if (this.walkanim !== -1) {
            if (this.walkanim_b !== -1 || this.walkanim_l !== -1 || this.walkanim_r !== -1) {
                lines.push(`walkanim=${this.walkanim},${this.walkanim_b},${this.walkanim_l},${this.walkanim_r}`);
            } else {
                lines.push(`walkanim=${this.walkanim}`);
            }
        }
        if (this.hasanim) {
            lines.push('hasanim=yes');
        }
        if (this.hasalpha) {
            lines.push('hasalpha=yes');
        }

        // Op menu entries — emit op1..opN for any non-null slots.
        if (this.op) {
            for (let i: number = 0; i < this.op.length; i++) {
                if (this.op[i] !== null) {
                    lines.push(`op${i + 1}=${this.op[i]}`);
                }
            }
        }

        // Stats — emit as a comma-separated list (atk,def,str,hp,range,mage).
        // Only emit if any stat deviates from the default [1,1,1,1,1,1].
        if (this.stats.some(s => s !== 1)) {
            lines.push(`stats=${this.stats.join(',')}`);
        }

        // Recolors — emit as paired recol1s/recol1d entries.
        if (this.recol_s && this.recol_d) {
            for (let i: number = 0; i < this.recol_s.length; i++) {
                lines.push(`recol${i + 1}s=${this.recol_s[i]}`);
                lines.push(`recol${i + 1}d=${this.recol_d[i]}`);
            }
        }

        // Render-related fields.
        if (this.resizex !== -1) {
            lines.push(`resizex=${this.resizex}`);
        }
        if (this.resizey !== -1) {
            lines.push(`resizey=${this.resizey}`);
        }
        if (this.resizez !== -1) {
            lines.push(`resizez=${this.resizez}`);
        }
        if (!this.minimap) {
            lines.push('minimap=no');
        }
        if (this.vislevel !== -1) {
            if (this.vislevel === 0) {
                lines.push('vislevel=hide');
            } else {
                lines.push(`vislevel=${this.vislevel}`);
            }
        }
        if (this.resizeh !== 128) {
            lines.push(`resizeh=${this.resizeh}`);
        }
        if (this.resizev !== 128) {
            lines.push(`resizev=${this.resizev}`);
        }
        if (this.alwaysontop) {
            lines.push('alwaysontop=yes');
        }
        if (this.ambient !== 0) {
            lines.push(`ambient=${this.ambient}`);
        }
        if (this.contrast !== 0) {
            // Emit raw byte; consumer scales by 5 if it wants the effective
            // contrast value (matching the Java client's `* 5` scaling).
            lines.push(`contrast=${this.contrast}`);
        }
        if (this.headicon !== -1) {
            lines.push(`headicon=${this.headicon}`);
        }
        if (this.turnspeed !== 32) {
            lines.push(`turnspeed=${this.turnspeed}`);
        }

        // Multi-var / multi-npc (ToMultivar/multinpc list).
        if (this.multivarbit !== -1 || this.multivarp !== -1) {
            const varKey: number = this.multivarbit !== -1 ? this.multivarbit : this.multivarp;
            const varKind: string = this.multivarbit !== -1 ? 'varbit' : 'varp';
            lines.push(`multivar=${varKind}:${varKey}`);
            for (let i: number = 0; i < this.multinpc.length; i++) {
                if (this.multinpc[i] !== -1) {
                    lines.push(`multinpc=${i},${this.multinpc[i]}`);
                }
            }
        }

        if (!this.active) {
            lines.push('active=no');
        }
        if (this.category !== -1) {
            lines.push(`category=${this.category}`);
        }

        // ---- OSRS-only fields (emitted as param=osrs_<field>,<value>) ----

        // Run animation family (code 24).
        if (this.runanim !== -1) {
            lines.push(`param=osrs_runanim,${this.runanim}`);
            if (this.runanim_l !== -1) {
                lines.push(`param=osrs_runanim_l,${this.runanim_l}`);
            }
            if (this.runanim_r !== -1) {
                lines.push(`param=osrs_runanim_r,${this.runanim_r}`);
            }
            if (this.runanim_b !== -1) {
                lines.push(`param=osrs_runanim_b,${this.runanim_b}`);
            }
        }

        // Crawl animation family (codes 25/26).
        if (this.crawlanim !== -1) {
            lines.push(`param=osrs_crawlanim,${this.crawlanim}`);
            if (this.crawlanim_l !== -1) {
                lines.push(`param=osrs_crawlanim_l,${this.crawlanim_l}`);
            }
            if (this.crawlanim_r !== -1) {
                lines.push(`param=osrs_crawlanim_r,${this.crawlanim_r}`);
            }
            if (this.crawlanim_b !== -1) {
                lines.push(`param=osrs_crawlanim_b,${this.crawlanim_b}`);
            }
        }
        if (this.crawlanim_b2 !== -1) {
            lines.push(`param=osrs_crawlanim_b2,${this.crawlanim_b2}`);
        }

        // Walk-back animation (populated by code 23's 5th short).
        if (this.walkanim_b !== -1 && this.walkanim === -1) {
            // walkanim_b set but no walkanim — emit as a standalone param
            // so it doesn't get clobbered by the comma-separated walkanim
            // tuple above.
            lines.push(`param=osrs_walkanim_b,${this.walkanim_b}`);
        }

        // Texture-mapped recolors (codes 28/29).
        if (this.recol_s_tex && this.recol_d_tex) {
            for (let i: number = 0; i < this.recol_s_tex.length; i++) {
                lines.push(`param=osrs_recol_tex${i + 1}s,${this.recol_s_tex[i]}`);
                lines.push(`param=osrs_recol_tex${i + 1}d,${this.recol_d_tex[i]}`);
            }
        }

        // Extended size (codes 118/119).
        if (this.sizeH !== -1) {
            lines.push(`param=osrs_sizeH,${this.sizeH}`);
        }
        if (this.sizeW !== -1) {
            lines.push(`param=osrs_sizeW,${this.sizeW}`);
        }

        // Minimap icon override (code 121).
        if (this.mapFunction !== -1) {
            lines.push(`param=osrs_mapFunction,${this.mapFunction}`);
        }
        if (this.mapScene !== -1) {
            lines.push(`param=osrs_mapScene,${this.mapScene}`);
        }

        // Heightmap (code 122).
        if (this.heightmap !== -1) {
            lines.push(`param=osrs_heightmap,${this.heightmap}`);
        }

        // Hover text (code 123).
        if (this.hoverText !== null) {
            lines.push(`param=osrs_hoverText,${this.hoverText}`);
        }

        // Render flags (codes 124..129).
        if (this.flipX !== 0) {
            lines.push(`param=osrs_flipX,${this.flipX}`);
        }
        if (this.flipY !== 0) {
            lines.push(`param=osrs_flipY,${this.flipY}`);
        }
        if (this.forceRenderPriority !== -1) {
            lines.push(`param=osrs_forceRenderPriority,${this.forceRenderPriority}`);
        }
        if (this.clipOnMinimap !== -1) {
            lines.push(`param=osrs_clipOnMinimap,${this.clipOnMinimap}`);
        }
        if (this.clip !== -1) {
            lines.push(`param=osrs_clip,${this.clip}`);
        }
        if (this.interactable !== -1) {
            lines.push(`param=osrs_interactable,${this.interactable}`);
        }

        // Opaque extension bytes (codes 130..134).
        for (let i: number = 0; i < this.osrsExtensions.length; i++) {
            const v: number = this.osrsExtensions[i];
            if (v !== 0) {
                lines.push(`param=osrs_ext${130 + i},${v}`);
            }
        }

        // Params (code 249) — emit as `param=<id>,<value>` lines, mirroring
        // the way the LostCity content folder stores params.
        if (this.params.size > 0) {
            for (const [paramId, value] of this.params) {
                lines.push(`param=${paramId},${value}`);
            }
        }

        return lines;
    }

    /**
     * Walk every field that holds an asset ID and return a flat list per
     * asset kind. Used by the dependency tracer (task 6) to compute the
     * transitive closure of cache files needed to render this NPC.
     *
     * Asset ID conventions:
     *   - `models[]`:   model archive IDs (archive 1)
     *   - `heads[]`:    head-model archive IDs (also archive 1)
     *   - `anims[]`:    seq archive IDs (archive 2, seq index)
     *   - `params[]`:   param config IDs (param.dat index)
     *
     * Asset IDs equal to -1 (the "unset" sentinel used throughout this
     * class) are excluded from the returned arrays. `multinpc[]` references
     * other NPC config IDs — those are NOT included here because the dep
     * tracer is expected to walk the NPC config index separately.
     *
     * @returns a fresh object with four number[] arrays. Callers may
     *          mutate without affecting the source NPC config.
     */
    extractDependencyRefs(): { models: number[]; heads: number[]; anims: number[]; params: number[] } {
        const models: number[] = [];
        const heads: number[] = [];
        const anims: number[] = [];
        const params: number[] = [];

        // Models (code 1) — direct model archive references.
        if (this.models) {
            for (let i: number = 0; i < this.models.length; i++) {
                if (this.models[i] !== 0 && this.models[i] !== 65535) {
                    models.push(this.models[i]);
                }
            }
        }

        // Heads (code 60) — also direct model archive references, but
        // tracked separately because they're used for the head-icon render
        // path (separate from the body model set).
        if (this.heads) {
            for (let i: number = 0; i < this.heads.length; i++) {
                if (this.heads[i] !== 0 && this.heads[i] !== 65535) {
                    heads.push(this.heads[i]);
                }
            }
        }

        // Animations — every seq reference on the NPC.
        const pushAnim = (id: number): void => {
            if (id !== -1 && id !== 0 && id !== 65535) {
                anims.push(id);
            }
        };
        pushAnim(this.readyanim);
        pushAnim(this.walkanim);
        pushAnim(this.walkanim_b);
        pushAnim(this.walkanim_l);
        pushAnim(this.walkanim_r);
        pushAnim(this.runanim);
        pushAnim(this.runanim_b);
        pushAnim(this.runanim_l);
        pushAnim(this.runanim_r);
        pushAnim(this.crawlanim);
        pushAnim(this.crawlanim_b);
        pushAnim(this.crawlanim_l);
        pushAnim(this.crawlanim_r);
        pushAnim(this.crawlanim_b2);

        // Params (code 249) — param config IDs (the map keys).
        for (const paramId of this.params.keys()) {
            params.push(paramId);
        }

        return { models, heads, anims, params };
    }
}
