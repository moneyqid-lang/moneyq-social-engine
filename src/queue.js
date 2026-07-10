// moneyq-social-engine/src/queue.js
import { config } from './utils/config.js';

/**
 * Check if it's an appropriate time to post on the given platform.
 * Returns true if current WIB time is within 30min of a scheduled time slot.
 */
export function shouldPostNow(platform) {
  const now = getWibTime();
  const slots = config.schedule[platform]?.times || [];

  for (const slot of slots) {
    const [slotHour, slotMin] = slot.split(':').map(Number);
    const slotMinutes = slotHour * 60 + slotMin;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const diff = Math.abs(nowMinutes - slotMinutes);

    // Allow posting within 30-minute window of the scheduled time
    if (diff <= 30) return true;
  }

  return false;
}

/**
 * Get current time in WIB (UTC+7).
 */
function getWibTime() {
  const now = new Date();
  // Convert to WIB
  const wibOffset = 7 * 60; // +0700 in minutes
  const localOffset = now.getTimezoneOffset();
  const wibTime = new Date(now.getTime() + (wibOffset + localOffset) * 60000);
  return wibTime;
}

/**
 * Add random delay (±15 minutes) to avoid spam detection patterns.
 * @param {number} baseMs - Base delay in milliseconds
 * @returns {Promise<void>}
 */
export async function randomDelay(baseMs = 0) {
  // Random jitter: 0 to 15 minutes (900,000ms)
  const jitter = Math.random() * 900_000;
  const delay = baseMs + jitter;

  const minutes = Math.round(delay / 60000);
  console.log(`  ⏳ Waiting ${minutes} min (anti-spam jitter)...`);

  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Get the next posting time for a platform.
 * Returns null if no more slots today.
 */
export function getNextPostTime(platform) {
  const now = getWibTime();
  const slots = config.schedule[platform]?.times || [];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  for (const slot of slots) {
    const [slotHour, slotMin] = slot.split(':').map(Number);
    const slotMinutes = slotHour * 60 + slotMin;
    if (slotMinutes > nowMinutes) {
      return `${String(slotHour).padStart(2, '0')}:${String(slotMin).padStart(2, '0')} WIB`;
    }
  }

  return null; // No more slots today
}

export { getWibTime };
