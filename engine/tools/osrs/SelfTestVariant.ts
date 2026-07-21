#!/usr/bin/env bun
/**
 * SelfTestVariant.ts — Task 9 self-test for the modular variant registry.
 *
 * Verifies the resolution precedence and the variant-availability
 * gating. NOT part of the shipped engine — run with:
 *   bun tools/osrs/SelfTestVariant.ts
 *
 * Test scenarios (per Task 9 spec):
 *   1. Stub a VariantRegistry with one imported NPC (legacyNpcId=-1,
 *      osrsNpcId=9001, debugname=osrs_tormented_demon).
 *   2. Create a PlayerVariantState with eraPreset='allOSRS'.
 *   3. resolveNpcVariant(9001, player1) → expects 'osrs'.
 *   4. resolveNpcVariant(9999, player1) for an NPC with no OSRS variant
 *      → expects 'legacy377'.
 *   5. Set a per-NPC override clearing the OSRS choice → expects
 *      'legacy377'.
 *
 * Prints "ALL PASS" if all 5 assertions hold.
 */

import { printInfo, printWarning } from '#/util/Logger.js';

import { PlayerVariantState } from '#/engine/variant/PlayerVariantState.js';
import { resolveNpcVariant } from '#/engine/variant/VariantResolver.js';
import type { VariantAvailabilitySource } from '#/engine/variant/VariantResolver.js';
import { VariantRegistry } from '#/engine/variant/VariantRegistry.js';
import type { NpcVariant } from '#/engine/variant/PlayerVariantState.js';

let failures = 0;

function assert(cond: boolean, msg: string): void {
    if (cond) {
        printInfo(`  PASS: ${msg}`);
    } else {
        failures++;
        printWarning(`  FAIL: ${msg}`);
    }
}

/**
 * Minimal stub registry that implements ONLY `getAvailableVariants`
 * (the `VariantAvailabilitySource` interface). Used to isolate the
 * resolver from any disk I/O.
 *
 * The stub maps:
 *   - npcId 9001 → ['osrs']                (brand-new OSRS NPC)
 *   - any other  → ['legacy377']           (default — every 377 NPC)
 */
class StubRegistry implements VariantAvailabilitySource {
    getAvailableVariants(npcId: number): NpcVariant[] {
        if (npcId === 9001) {
            return ['osrs'];
        }
        return ['legacy377'];
    }
}

/**
 * Test 1: stub a VariantRegistry with one imported NPC.
 *
 * This uses the REAL VariantRegistry singleton (reset to a fresh
 * state via `resetForTest()` + `_addEntryForTest()`), to verify the
 * registry's `getAvailableVariants` correctly handles the
 * `legacyNpcId === -1` case.
 */
printInfo('Test 1: stub VariantRegistry with one imported NPC (legacyNpcId=-1, osrsNpcId=9001)');
VariantRegistry.resetForTest();
const registry = VariantRegistry.getInstance();
registry._addEntryForTest({
    legacyNpcId: -1,
    osrsNpcId: 9001,
    osrsDebugname: 'osrs_tormented_demon',
    legacyDebugname: null,
    depMapPath: 'content/deps/osrs_tormented_demon.deps.json',
    importedAt: '2025-01-01T00:00:00Z'
});

// Verify availability lookups via the registry.
const avail9001 = registry.getAvailableVariants(9001);
assert(avail9001.length === 1 && avail9001[0] === 'osrs',
    `getAvailableVariants(9001) === ['osrs'] (got [${avail9001.join(',')}])`);
const avail9999 = registry.getAvailableVariants(9999);
assert(avail9999.length === 1 && avail9999[0] === 'legacy377',
    `getAvailableVariants(9999) === ['legacy377'] (got [${avail9999.join(',')}])`);

// Verify metadata lookup.
const meta = registry.getVariantMetadata(9001);
assert(meta !== null && meta.osrsDebugname === 'osrs_tormented_demon' && meta.legacyNpcId === -1,
    'getVariantMetadata(9001) returns osrs_tormented_demon with legacyNpcId=-1');

// ---- Test 2: create a PlayerVariantState with eraPreset='allOSRS' ----
printInfo('Test 2: PlayerVariantState with eraPreset=allOSRS');
const state = new PlayerVariantState(/* playerId */ 1);
state.setEra('allOSRS');
assert(state.eraPreset === 'allOSRS', 'state.eraPreset === \'allOSRS\'');
assert(state.npcOverrides.size === 0, 'state.npcOverrides is empty by default');

// ---- Test 3: resolveNpcVariant(9001, player1) → 'osrs' ----
printInfo('Test 3: resolveNpcVariant(9001, player1) with allOSRS → expects osrs');
{
    const stub = new StubRegistry();
    const v = resolveNpcVariant(state, 9001, /* regionId */ -1, stub);
    assert(v === 'osrs', `resolveNpcVariant(9001) === 'osrs' (got '${v}')`);

    // Also verify via the real VariantRegistry singleton (which uses
    // the same pure resolver internally — but only when the state is
    // cached; we use a fresh default state via the cache-miss path).
    registry.setPlayerState(1, state);
    const v2 = registry.resolveNpcVariant(9001, 1);
    assert(v2 === 'osrs', `VariantRegistry.resolveNpcVariant(9001, 1) === 'osrs' (got '${v2}')`);
}

// ---- Test 4: resolveNpcVariant(9999, player1) → 'legacy377' ----
printInfo('Test 4: resolveNpcVariant(9999, player1) for NPC with no OSRS variant → expects legacy377');
{
    const stub = new StubRegistry();
    const v = resolveNpcVariant(state, 9999, /* regionId */ -1, stub);
    assert(v === 'legacy377', `resolveNpcVariant(9999) === 'legacy377' (got '${v}')`);

    const v2 = registry.resolveNpcVariant(9999, 1);
    assert(v2 === 'legacy377', `VariantRegistry.resolveNpcVariant(9999, 1) === 'legacy377' (got '${v2}')`);
}

// ---- Test 5: set a per-NPC override clearing the OSRS choice ----
printInfo('Test 5: set per-NPC override on 9001 to legacy377 → expects legacy377');
{
    state.setNpcOverride(9001, 'legacy377');
    const stub = new StubRegistry();
    const v = resolveNpcVariant(state, 9001, /* regionId */ -1, stub);
    assert(v === 'legacy377', `resolveNpcVariant(9001) with override='legacy377' === 'legacy377' (got '${v}')`);

    const v2 = registry.resolveNpcVariant(9001, 1);
    assert(v2 === 'legacy377', `VariantRegistry.resolveNpcVariant(9001, 1) with override='legacy377' === 'legacy377' (got '${v2}')`);

    // Clean up: clear the override so subsequent runs start fresh.
    state.clearNpcOverride(9001);
}

// ---- Bonus: verify resolution precedence (override > era preset) ----
printInfo('Bonus: verify override precedence over era preset');
{
    // Player on '05era' (default) — NPC 9001 (brand-new) gets 'osrs'
    // because that's the only available variant.
    const defState = new PlayerVariantState(2);
    const stub = new StubRegistry();
    const vDefault = resolveNpcVariant(defState, 9001, -1, stub);
    assert(vDefault === 'osrs', `default state (05era) for brand-new NPC 9001 → 'osrs' (got '${vDefault}')`);

    // Player on 'mixed' era — same as 05era for NPCs not in the
    // override map.
    defState.setEra('mixed');
    const vMixed = resolveNpcVariant(defState, 9999, -1, stub);
    assert(vMixed === 'legacy377', `'mixed' era for NPC 9999 → 'legacy377' (got '${vMixed}')`);

    // Override to 'osrs' on an NPC with no OSRS variant — resolver
    // honors the override unconditionally (caller is responsible for
    // fallback).
    defState.setNpcOverride(9999, 'osrs');
    const vForce = resolveNpcVariant(defState, 9999, -1, stub);
    assert(vForce === 'osrs', `override='osrs' on NPC 9999 → 'osrs' (unconditional; got '${vForce}')`);
}

// ---- Bonus: verify JSON round-trip for PlayerVariantState ----
printInfo('Bonus: PlayerVariantState JSON round-trip');
{
    const s = new PlayerVariantState(42);
    s.setEra('allOSRS');
    s.setNpcOverride(9001, 'osrs');
    s.setNpcOverride(1234, 'legacy377');
    const json = s.toNpcOverridesJson();
    const s2 = PlayerVariantState.fromRow(42, 'allOSRS', json, '{}');
    assert(s2.eraPreset === 'allOSRS', 'round-trip eraPreset === \'allOSRS\'');
    assert(s2.npcOverrides.get(9001) === 'osrs', 'round-trip npcOverrides.get(9001) === \'osrs\'');
    assert(s2.npcOverrides.get(1234) === 'legacy377', 'round-trip npcOverrides.get(1234) === \'legacy377\'');
    assert(s2.npcOverrides.size === 2, `round-trip npcOverrides.size === 2 (got ${s2.npcOverrides.size})`);

    // Tolerates malformed JSON.
    const s3 = PlayerVariantState.fromRow(42, 'invalid-preset', 'not-json', '');
    assert(s3.eraPreset === '05era', `malformed input falls back to default era '05era' (got '${s3.eraPreset}')`);
    assert(s3.npcOverrides.size === 0, 'malformed JSON -> empty override map');
}

// ---- Summary ----
if (failures === 0) {
    printInfo('ALL PASS');
    process.exit(0);
} else {
    printWarning(`${failures} assertion(s) failed`);
    process.exit(1);
}
