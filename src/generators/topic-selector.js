// moneyq-social-engine/src/generators/topic-selector.js
import { db } from '../db.js';

const PILLARS = [
  'tips_hemat',
  'edukasi_siklus',
  'fakta_finansial',
  'before_after',
  'challenge',
  'behind_product',
];

// Track last 2 pillars used to avoid repetition (module-level, persists across calls)
let lastPillars = [];

// Track last 10 angles used to avoid repetition (module-level, persists across calls)
let lastAngles = new Set();

/**
 * Select a content topic for the given date and platform.
 * Priority: calendar entries matching the platform → fallback random pillar
 * (not in last 2 used).
 *
 * @param {string} date - ISO date string (e.g. '2026-07-13')
 * @param {string} platform - Platform name (e.g. 'instagram', 'tiktok')
 * @returns {Promise<{id: string|null, topic: string, pillar: string, angle: string, platforms: string[], fromCalendar: boolean} | null>}
 */
export async function selectTopic(date, platform) {
  // 1. Get calendar entries for this date
  const entries = await db.getCalendarEntries(date, 10);
  const valid = entries.filter(e => e.platforms.includes(platform) && e.status === 'pending');

  if (valid.length === 0) {
    // 2. Fallback: generate a topic on-the-fly using pillar rotator
    return generateFallbackTopic(date, platform);
  }

  // 3. Skip entries with recently used angles
  let pool = valid.filter(e => !lastAngles.has(e.angle));

  // 4. If all entries were deduped, reset tracking and use the first entry anyway
  if (pool.length === 0) {
    lastAngles.clear();
    pool = valid;
  }

  // 5. Pick the first entry
  const entry = pool[0];
  lastPillars.push(entry.pillar);
  if (lastPillars.length > 2) lastPillars.shift();

  // 6. Track the angle (last 10 used)
  lastAngles.add(entry.angle);
  if (lastAngles.size > 10) {
    const first = lastAngles.values().next().value;
    lastAngles.delete(first);
  }

  return {
    id: entry.id,
    topic: entry.topic,
    pillar: entry.pillar,
    angle: entry.angle,
    platforms: entry.platforms,
    fromCalendar: true,
  };
}

/**
 * Generate a fallback topic when calendar is empty or has no matching entries.
 * Picks a pillar that is not in the last 2 used to ensure rotation.
 */
export async function generateFallbackTopic(date, platform) {
  // Rotate pillars — pick one not in lastPillars
  const available = PILLARS.filter(p => !lastPillars.includes(p));
  const pool = available.length > 0 ? available : PILLARS;
  const pillar = pool[Math.floor(Math.random() * pool.length)];

  lastPillars.push(pillar);
  if (lastPillars.length > 2) lastPillars.shift();

  const angles = {
    tips_hemat: ['langganan-tersembunyi', 'kopi-daily', 'makan-diluar', 'transportasi', 'hiburan'],
    edukasi_siklus: ['definisi-siklus', 'setup-pertama', 'vs-bulanan', 'tips-transisi'],
    fakta_finansial: ['statistik-ri', 'gen-sandwich', 'dana-darurat', 'inflasi'],
    before_after: ['hasil-siklus', 'nabung-pertama', 'bebas-utang'],
    challenge: ['no-jajan', 'track-spending', 'no-takeout', 'hemat-transport'],
    behind_product: ['recovery-plan', 'mentor-wise', 'sheets-sync', 'siklus-fit'],
  };

  const angle = angles[pillar][Math.floor(Math.random() * angles[pillar].length)];

  // Track the angle (last 10 used)
  lastAngles.add(angle);
  if (lastAngles.size > 10) {
    const first = lastAngles.values().next().value;
    lastAngles.delete(first);
  }

  return {
    id: null,
    topic: `${pillar.replace(/_/g, ' ')} - ${angle}`,
    pillar,
    angle,
    platforms: [platform],
    fromCalendar: false,
  };
}

/**
 * Reset the lastPillars tracker — for test isolation.
 * Not part of the public API; used internally by tests.
 */
export function _resetLastPillars() {
  lastPillars = [];
}

/**
 * Reset the lastAngles tracker — for test isolation.
 * Not part of the public API; used internally by tests.
 */
export function _resetLastAngles() {
  lastAngles = new Set();
}
