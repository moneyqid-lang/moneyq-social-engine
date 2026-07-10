// moneyq-social-engine/src/utils/health.js
// System health check — tests connectivity to all external services

import { config } from './config.js';
import { supabase } from '../db.js';

/**
 * Run a health check against all configured external services.
 *
 * Checks:
 *  - Supabase database (lightweight count query)
 *  - Gemini API (model metadata endpoint)
 *  - Hugging Face Inference API (status endpoint, if token is set)
 *  - Instagram Graph API (account lookup, if token is set)
 *
 * @returns {Promise<{ ok: boolean, checks: object }>}
 */
export async function healthCheck() {
  const checks = {};

  // --- Supabase ---
  try {
    const { data, error } = await supabase
      .from('content_calendar')
      .select('count', { count: 'exact', head: true });
    checks.supabase = error
      ? { ok: false, error: error.message }
      : { ok: true, count: data?.count ?? 0 };
  } catch (err) {
    checks.supabase = { ok: false, error: err.message };
  }

  // --- Gemini API ---
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}?key=${config.gemini.apiKey}`,
    );
    checks.gemini = res.ok
      ? { ok: true }
      : { ok: false, status: res.status };
  } catch (err) {
    checks.gemini = { ok: false, error: err.message };
  }

  // --- Hugging Face Inference API ---
  if (config.huggingface.apiToken) {
    try {
      const res = await fetch('https://api-inference.huggingface.co/status', {
        headers: { Authorization: `Bearer ${config.huggingface.apiToken}` },
      });
      checks.huggingface = res.ok
        ? { ok: true }
        : { ok: false, status: res.status };
    } catch (err) {
      checks.huggingface = { ok: false, error: err.message };
    }
  }

  // --- Instagram Graph API ---
  if (config.platforms.instagram.accessToken) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${config.platforms.instagram.accountId}?access_token=${config.platforms.instagram.accessToken}`,
      );
      checks.instagram = res.ok
        ? { ok: true }
        : { ok: false, status: res.status };
    } catch (err) {
      checks.instagram = { ok: false, error: err.message };
    }
  }

  const allOk = Object.values(checks).every(c => c.ok);
  return { ok: allOk, checks };
}

export default healthCheck;
