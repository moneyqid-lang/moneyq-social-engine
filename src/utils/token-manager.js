// moneyq-social-engine/src/utils/token-manager.js
// Auto-refresh Facebook/Instagram long-lived tokens before expiry
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const ENV_PATH = join(process.cwd(), '.env');
const REFRESH_BUFFER_DAYS = 7; // Refresh if < 7 days until expiry

/**
 * Get valid Instagram access token (auto-refresh if needed)
 * @returns {Promise<string>} Valid access token
 */
export async function getValidInstagramToken() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new Error('INSTAGRAM_ACCESS_TOKEN not set');

  // Check token validity
  const debug = await debugToken(token);

  // Token is invalid — try to refresh
  if (debug.data && debug.data.is_valid === false) {
    console.log('  ❌ Token is INVALID — attempting refresh...');
    const refreshed = await refreshToken(token);
    if (refreshed !== token) return refreshed;
    throw new Error(
      'Instagram token is invalid and could not be refreshed. ' +
      'Generate a new token at: https://developers.facebook.com/tools/explorer/'
    );
  }

  // Check expiry
  const expiresAt = debug.data?.expires_at ? debug.data.expires_at * 1000 : null;
  const now = Date.now();

  if (expiresAt) {
    const daysLeft = (expiresAt - now) / (1000 * 60 * 60 * 24);
    console.log(`  📅 Token expires in ${Math.round(daysLeft)} days`);

    if (daysLeft < 0) {
      console.log('  ❌ Token EXPIRED — attempting refresh...');
      const refreshed = await refreshToken(token);
      if (refreshed !== token) return refreshed;
      throw new Error(
        'Instagram token expired and could not be refreshed. ' +
        'Generate a new token at: https://developers.facebook.com/tools/explorer/'
      );
    }

    if (daysLeft < REFRESH_BUFFER_DAYS) {
      console.log('  🔄 Token expiring soon, refreshing...');
      return await refreshToken(token);
    }
  }

  return token;
}

/**
 * Debug/inspect a Facebook access token
 * Uses app access token (app_id|app_secret) to avoid self-referencing expired token
 */
async function debugToken(token) {
  try {
    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;

    // Use app access token for debug (works even if user token is expired)
    const appToken = appId && appSecret ? `${appId}|${appSecret}` : token;

    const res = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${token}&access_token=${appToken}`
    );
    const data = await res.json();

    // Log token status for debugging
    if (data.data) {
      const d = data.data;
      console.log(`  🔍 Token valid: ${d.is_valid}, expires: ${d.expires_at ? new Date(d.expires_at * 1000).toISOString() : 'never'}, scopes: ${d.scopes?.join(',')}`);
    }

    return data;
  } catch (err) {
    console.log(`  ⚠️ Token debug failed: ${err.message}`);
    return { data: { is_valid: false } };
  }
}

/**
 * Exchange short-lived token for long-lived token (60 days)
 * Or refresh an existing long-lived token
 */
export async function refreshToken(shortLivedToken) {
  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;

  if (!appId || !appSecret) {
    console.log('  ⚠️ FB_APP_ID or FB_APP_SECRET not set, cannot auto-refresh');
    console.log('  💡 Set these in .env to enable auto-refresh');
    return shortLivedToken;
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${appId}&` +
      `client_secret=${appSecret}&` +
      `fb_exchange_token=${shortLivedToken}`
    );

    const data = await res.json();

    if (data.access_token) {
      console.log('  ✅ Token refreshed successfully');

      // Update .env file
      await updateEnvFile('INSTAGRAM_ACCESS_TOKEN', data.access_token);

      // Update process.env
      process.env.INSTAGRAM_ACCESS_TOKEN = data.access_token;

      return data.access_token;
    } else {
      console.log('  ❌ Token refresh failed:', data.error?.message);
      return shortLivedToken;
    }
  } catch (err) {
    console.log('  ❌ Token refresh error:', err.message);
    return shortLivedToken;
  }
}

/**
 * Update a value in .env file
 */
async function updateEnvFile(key, value) {
  try {
    let content = await readFile(ENV_PATH, 'utf-8');
    const regex = new RegExp(`^${key}=.*$`, 'm');

    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }

    await writeFile(ENV_PATH, content);
    console.log(`  💾 Updated .env: ${key}`);
  } catch (err) {
    console.log(`  ⚠️ Failed to update .env: ${err.message}`);
  }
}
