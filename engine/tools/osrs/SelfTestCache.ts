/**
 * Self-test for Task 7 (OsrsCacheReader + OsrsCacheAssetReader + LegacyCacheWriter).
 *
 * Verifies:
 *   1. OsrsCacheReader fails gracefully when pointed at a non-existent dir
 *      (no throw on construction; null returns from reads).
 *   2. OsrsCacheAssetReader similarly fails gracefully.
 *   3. LegacyCacheWriter round-trips a fake model: write gzipped bytes to
 *      archive 1 file N, then read them back via FileStream and verify the
 *      decompressed payload matches the input.
 *
 * Run with:
 *   bun tools/osrs/SelfTestCache.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import OsrsCacheReader from '#/cache/osrs/OsrsCacheReader.js';
import OsrsCacheAssetReader from '#/cache/osrs/OsrsCacheAssetReader.js';
import LegacyCacheWriter from '#/cache/osrs/LegacyCacheWriter.js';
import { printInfo, printWarning } from '#/util/Logger.js';

let failures = 0;

function assert(cond: boolean, msg: string): void {
    if (cond) {
        printInfo(`  PASS: ${msg}`);
    } else {
        failures++;
        printWarning(`  FAIL: ${msg}`);
    }
}

// ---- Test 1: OsrsCacheReader against non-existent dir ----
printInfo('Test 1: OsrsCacheReader graceful failure on missing dir');
{
    const reader = new OsrsCacheReader('/nonexistent/path/does-not-exist');
    assert(!reader.isAvailable, 'reader.isAvailable === false');
    assert(reader.count(0) === 0, 'reader.count(0) === 0');
    assert(reader.read(0, 0) === null, 'reader.read(0,0) === null');
    assert(reader.read(255, 0) === null, 'reader.read(255,0) === null');
    assert(reader.readArchive(9, 0) === null, 'reader.readArchive(9,0) === null');
    assert(reader.readIndex255().length === 0, 'reader.readIndex255() returns []');
    assert(reader.has(1, 0) === false, 'reader.has(1,0) === false');
    reader.close(); // should be a no-op on a closed/failed reader
}

// ---- Test 2: OsrsCacheAssetReader against non-existent dir ----
printInfo('Test 2: OsrsCacheAssetReader graceful failure on missing dir');
{
    const reader = new OsrsCacheAssetReader('/nonexistent/path/does-not-exist');
    assert(!reader.available, 'assetReader.available === false');
    assert(reader.readModel(0) === null, 'readModel(0) === null');
    assert(reader.readAnim(0) === null, 'readAnim(0) === null');
    assert(reader.readAnimBase(0) === null, 'readAnimBase(0) === null');
    assert(reader.readSeq(0) === null, 'readSeq(0) === null');
    assert(reader.readNpc(0) === null, 'readNpc(0) === null');
    assert(reader.readObj(0) === null, 'readObj(0) === null (stub)');
    assert(reader.readParam(0) === null, 'readParam(0) === null (stub)');
    assert(reader.readStruct(0) === null, 'readStruct(0) === null (stub)');
    assert(reader.readTexture(0) === null, 'readTexture(0) === null');
    assert(reader.readParticle(0) === null, 'readParticle(0) === null (stub)');
    assert(reader.readSound(0) === null, 'readSound(0) === null (stub)');
}

// ---- Test 3: LegacyCacheWriter round-trip a fake model ----
printInfo('Test 3: LegacyCacheWriter round-trips a fake model');
{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-cache-test-'));
    try {
        const writer = new LegacyCacheWriter(tmpDir);

        // Build a fake "377 model" payload — just a recognizable byte pattern.
        const fakeModel = new Uint8Array(256);
        for (let i = 0; i < fakeModel.length; i++) {
            fakeModel[i] = (i * 7 + 13) & 0xFF;
        }

        writer.writeModel(42, fakeModel, 1);
        assert(writer.raw.has(1, 42), 'model file exists after writeModel(42)');

        const readBack = writer.readModelForTest(42);
        assert(readBack !== null, 'readModelForTest(42) returns non-null');
        if (readBack) {
            assert(
                readBack.length === fakeModel.length,
                `round-trip length matches (${readBack.length} === ${fakeModel.length})`
            );
            let bytesMatch = true;
            for (let i = 0; i < fakeModel.length; i++) {
                if (readBack[i] !== fakeModel[i]) {
                    bytesMatch = false;
                    break;
                }
            }
            assert(bytesMatch, 'round-trip bytes match');
        }

        // Round-trip an anim too.
        const fakeAnim = new Uint8Array(64);
        for (let i = 0; i < fakeAnim.length; i++) {
            fakeAnim[i] = (i + 1) & 0xFF;
        }
        writer.writeAnim(7, fakeAnim, 1);
        const animBack = writer.readAnimForTest(7);
        assert(animBack !== null, 'readAnimForTest(7) returns non-null');
        if (animBack) {
            assert(animBack.length === fakeAnim.length, 'anim round-trip length matches');
        }

        // Round-trip an npc.dat + npc.idx.
        const fakeNpcDat = new Uint8Array(32);
        const fakeNpcIdx = new Uint8Array(16);
        for (let i = 0; i < fakeNpcDat.length; i++) fakeNpcDat[i] = i;
        for (let i = 0; i < fakeNpcIdx.length; i++) fakeNpcIdx[i] = 200 - i;
        writer.writeNpcConfig(fakeNpcDat, fakeNpcIdx);
        const jagBytes = writer.readConfigJagfileForTest();
        assert(jagBytes !== null, 'config jagfile written + readable');
        assert(jagBytes !== null && jagBytes.length > 10, `config jagfile has content (${jagBytes?.length ?? 0} bytes)`);

        // Write npc config a second time — should merge (overwrite npc.dat/npc.idx
        // but preserve other entries). Since we only have npc.dat + npc.idx,
        // the merge result should still have exactly those two entries.
        writer.writeNpcConfig(fakeNpcDat, fakeNpcIdx);
        const jagBytes2 = writer.readConfigJagfileForTest();
        assert(jagBytes2 !== null, 'config jagfile re-write succeeded');
    } finally {
        // Best-effort cleanup of the temp dir.
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup failures.
        }
    }
}

// ---- Summary ----
printInfo(failures === 0 ? 'All Task 7 self-tests passed.' : `${failures} Task 7 self-test failure(s).`);
if (failures > 0) {
    process.exit(1);
}
