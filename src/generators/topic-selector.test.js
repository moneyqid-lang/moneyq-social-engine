// moneyq-social-engine/src/generators/topic-selector.test.js
import { describe, it, beforeEach, before, mock } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Shared mutable state for db mock return values
let mockCalendarEntries = [];

// Mock db module
const mockDb = {
  getCalendarEntries: mock.fn((date, limit) => Promise.resolve(mockCalendarEntries)),
  getRecentContent: mock.fn(() => Promise.resolve([])),
};

// Resolve to absolute path for mock.module (resolves relative to CWD otherwise)
const dbPath = resolve(__dirname, '../db.js');
mock.module(dbPath, { namedExports: { db: mockDb } });

describe('Topic Selector', () => {
  let selectTopic;
  let resetLastPillars;

  before(async () => {
    const mod = await import('./topic-selector.js');
    selectTopic = mod.selectTopic;
    resetLastPillars = mod._resetLastPillars;
  });

  beforeEach(() => {
    mockCalendarEntries = [];
    if (resetLastPillars) resetLastPillars();
  });

  it('returns a calendar entry when pending entries exist for the platform', async () => {
    mockCalendarEntries = [
      {
        id: 'uuid-1',
        topic: 'Tips Hemat Listrik',
        pillar: 'tips_hemat',
        angle: 'langganan-tersembunyi',
        platforms: ['instagram', 'tiktok'],
      },
    ];

    const result = await selectTopic('2026-07-13', 'instagram');

    assert.notStrictEqual(result, null);
    assert.strictEqual(result.id, 'uuid-1');
    assert.strictEqual(result.topic, 'Tips Hemat Listrik');
    assert.strictEqual(result.pillar, 'tips_hemat');
    assert.strictEqual(result.angle, 'langganan-tersembunyi');
    assert.deepStrictEqual(result.platforms, ['instagram', 'tiktok']);
    assert.strictEqual(result.fromCalendar, true);
  });

  it('generates a fallback when no entries exist in the calendar', async () => {
    mockCalendarEntries = [];

    const result = await selectTopic('2026-07-13', 'instagram');

    assert.notStrictEqual(result, null);
    assert.strictEqual(result.fromCalendar, false);
    assert.strictEqual(result.id, null);
    assert.strictEqual(result.platforms.length, 1);
    assert.strictEqual(result.platforms[0], 'instagram');
  });

  it('filters out entries that do not target the requested platform and falls back', async () => {
    mockCalendarEntries = [
      { id: '1', topic: 'Test', pillar: 'tips_hemat', angle: 'test', platforms: ['tiktok'] },
    ];

    const result = await selectTopic('2026-07-13', 'instagram');

    assert.notStrictEqual(result, null);
    assert.strictEqual(result.fromCalendar, false);
    assert.strictEqual(result.id, null);
  });

  it('passes the correct date and limit to getCalendarEntries', async () => {
    mockCalendarEntries = [
      { id: 'uuid-1', topic: 'Test', pillar: 'tips_hemat', angle: 'test', platforms: ['instagram'] },
    ];

    await selectTopic('2026-07-13', 'instagram');

    // Check the last call made to getCalendarEntries (module is cached across tests)
    const calls = mockDb.getCalendarEntries.mock.calls;
    const lastCall = calls[calls.length - 1];
    assert.strictEqual(lastCall.arguments[0], '2026-07-13');
    assert.strictEqual(lastCall.arguments[1], 10);
  });

  it('fallback generates a valid pillar value', async () => {
    const validPillars = [
      'tips_hemat',
      'edukasi_siklus',
      'fakta_finansial',
      'before_after',
      'challenge',
      'behind_product',
    ];

    mockCalendarEntries = [];
    const result = await selectTopic('2026-07-13', 'instagram');

    assert.strictEqual(result.fromCalendar, false);
    assert.ok(validPillars.includes(result.pillar), `Pillar "${result.pillar}" is not valid`);
  });

  it('fallback generates a valid angle for the chosen pillar', async () => {
    const allAngles = {
      tips_hemat: ['langganan-tersembunyi', 'kopi-daily', 'makan-diluar', 'transportasi', 'hiburan'],
      edukasi_siklus: ['definisi-siklus', 'setup-pertama', 'vs-bulanan', 'tips-transisi'],
      fakta_finansial: ['statistik-ri', 'gen-sandwich', 'dana-darurat', 'inflasi'],
      before_after: ['hasil-siklus', 'nabung-pertama', 'bebas-utang'],
      challenge: ['no-jajan', 'track-spending', 'no-takeout', 'hemat-transport'],
      behind_product: ['recovery-plan', 'mentor-wise', 'sheets-sync', 'siklus-fit'],
    };

    mockCalendarEntries = [];
    const result = await selectTopic('2026-07-13', 'instagram');

    assert.strictEqual(result.fromCalendar, false);
    assert.ok(
      allAngles[result.pillar] !== undefined,
      `Unknown pillar: ${result.pillar}`
    );
    assert.ok(
      allAngles[result.pillar].includes(result.angle),
      `Angle "${result.angle}" not valid for pillar "${result.pillar}"`
    );
  });

  it('generates a topic string from pillar and angle in fallback mode', async () => {
    mockCalendarEntries = [];
    const result = await selectTopic('2026-07-13', 'instagram');

    assert.strictEqual(result.fromCalendar, false);
    assert.strictEqual(
      result.topic,
      `${result.pillar.replace(/_/g, ' ')} - ${result.angle}`
    );
  });

  it('rotates pillars to avoid using the same pillar consecutively', async () => {
    mockCalendarEntries = [];

    // Make 3 sequential fallback calls — each one pushes to lastPillars
    const r1 = await selectTopic('2026-07-13', 'instagram');
    const r2 = await selectTopic('2026-07-14', 'instagram');
    const r3 = await selectTopic('2026-07-15', 'instagram');

    const pillars = [r1.pillar, r2.pillar, r3.pillar];

    // With 6 pillars and "avoid last 2 used", after 3 calls we see at least 2 distinct
    const unique = new Set(pillars);
    assert.ok(
      unique.size >= 2,
      `Expected at least 2 distinct pillars in 3 fallback calls, got: ${pillars.join(', ')}`
    );

    // Verify consecutive calls are different (the just-used pillar is in lastPillars)
    assert.notStrictEqual(r1.pillar, r2.pillar);
    assert.notStrictEqual(r2.pillar, r3.pillar);
  });

  it('fallback result includes the requested platform', async () => {
    mockCalendarEntries = [];
    const result = await selectTopic('2026-07-13', 'instagram');

    assert.strictEqual(result.fromCalendar, false);
    assert.deepStrictEqual(result.platforms, ['instagram']);
  });

  it('prefers earlier entries when multiple calendar entries exist for the same date', async () => {
    mockCalendarEntries = [
      { id: 'first', topic: 'First Entry', pillar: 'tips_hemat', angle: 'kopi-daily', platforms: ['instagram'] },
      { id: 'second', topic: 'Second Entry', pillar: 'edukasi_siklus', angle: 'definisi-siklus', platforms: ['instagram'] },
    ];

    const result = await selectTopic('2026-07-13', 'instagram');

    assert.strictEqual(result.fromCalendar, true);
    assert.strictEqual(result.id, 'first');
    assert.strictEqual(result.topic, 'First Entry');
  });

  it('returns calendar entry even after fallback calls', async () => {
    // First call: fallback (pushes to lastPillars)
    mockCalendarEntries = [];
    const fallback = await selectTopic('2026-07-13', 'instagram');
    assert.strictEqual(fallback.fromCalendar, false);

    // Second call: calendar entry
    mockCalendarEntries = [
      { id: 'cal-entry', topic: 'Calendar', pillar: fallback.pillar, angle: 'test', platforms: ['instagram'] },
    ];
    const calendar = await selectTopic('2026-07-14', 'instagram');
    assert.strictEqual(calendar.fromCalendar, true);
    assert.strictEqual(calendar.id, 'cal-entry');
  });
});
