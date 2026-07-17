// moneyq-social-engine/src/generators/video-cascade.js
// Cascade video generation: Vidu → Remotion → FFmpeg
//
// Always tries Vidu first (free off-peak mode).
// Falls back to Remotion templates if Vidu fails.
// Last resort: FFmpeg + Pexels stock footage.
//
// Each provider throws on failure, triggering the next.

import { generateRemotionVideo } from './remotion-bridge.js';
import { generateVideo } from './video-gen.js';
// import { generateViduVideo } from './vidu-gen.js';    // Re-enable when Vidu credits available
// import { generateSeedanceVideo } from './seedance-gen.js'; // Re-enable when Seedance credits available

/**
 * Generate video with cascading fallback.
 *
 * Cascade: Remotion (free) → FFmpeg+Pexels (free)
 * Vidu/Seedance skipped until credits available.
 *
 * @param {Object}  copy  — { hook, body, cta, hashtags }
 * @param {Object}  topic — { pillar, topic, angle }
 * @param {string}  [type='daily'] — 'daily' or 'hero'
 * @returns {Promise<{path: string, provider: string}>}
 */
export async function generateVideoWithFallback(copy, topic, type = 'daily') {
  const errors = [];

  // ── Tier 1: Remotion templates (free, brand-consistent) ────────────
  try {
    console.log('  🎨 [1/2] Trying Remotion (with VO merge)...');
    const path = await generateRemotionVideo(copy, topic, type);
    console.log(`  ✅ Remotion video with VO: ${path}`);
    return { path, provider: 'remotion' };
  } catch (err) {
    console.log(`  ⚠️ Remotion failed: ${err.message}`);
    errors.push({ provider: 'remotion', error: err.message });
  }

  // ── Tier 2: FFmpeg + Pexels (legacy fallback) ──────────────────────
  try {
    console.log('  📹 [2/2] Falling back to FFmpeg + Pexels...');
    const path = await generateVideo(copy, topic, type);
    return { path, provider: 'ffmpeg' };
  } catch (err) {
    console.log(`  ❌ FFmpeg also failed: ${err.message}`);
    errors.push({ provider: 'ffmpeg', error: err.message });
  }

  // All providers failed
  const summary = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
  throw new Error(`All video providers failed: ${summary}`);
}
