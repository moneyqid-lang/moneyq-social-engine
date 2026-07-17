// moneyq-social-engine/src/utils/token-manager.js
// Universal token auto-refresh for all platforms
//
// Supports: Instagram, Threads (via Facebook Graph API), YouTube (OAuth2)
// Auto-updates GitHub Secrets in CI, .env locally
//
// Token lifecycle:
//   Instagram: long-lived token → refresh before 60-day expiry
//   Threads: long-lived token → refresh before 60-day expiry (same mechanism)
//   YouTube: refresh token → get new access token (1-hour lifetime)

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ENV_PATH = join(process.cwd(), '.env');
const REFRESH_BUFFER_DAYS = 7;
const IS_CI = !!process.env.GITHUB_ACTIONS;
const REPO = process.env.GITHUB_REPOSITORY || '';

// ---------------------------------------------------------------------------
// Platform token getters — single entry point for each platform
// ---------------------------------------------------------------------------

/**
 * Get valid Instagram access token (auto-refresh if needed)
 */
export async function getValidInstagramToken() {
  return getValidFacebookToken('INSTAGRAM_ACCESS_TOKEN', 'Instagram');
}

/**
 * Get valid Threads access token (auto-refresh if needed)
 */
export async function getValidThreadsToken() {
  return getValidFacebookToken('THREADS_ACCESS_TOKEN', 'Threads');
}

/**
 * Get valid YouTube access token (auto-refresh via refresh_token)
 */
export async function getValidYouTubeToken() {
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!refreshToken) throw new Error('YOUTUBE_REFRESH_TOKEN not set');
  if (!clientId || !clientSecret) throw new Error('YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET not set');

  // YouTube access tokens expire in 1 hour — always refresh
  console.log('  🔄 Refreshing YouTube access token...');

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const data = await res.json();

    if (data.access_token) {
      const expiresIn = data.expires_in || 3600;
      console.log(`  ✅ YouTube token refreshed (expires in ${Math.round(expiresIn / 60)} min)`);

      // Update stored access token
      await updateSecret('YOUTUBE_ACCESS_TOKEN', data.access_token);

      return data.access_token;
    }

    // Refresh token itself might be invalid
    if (data.error === 'invalid_grant') {
      throw new Error(
        'YouTube refresh token is REVOKED. Re-authorize the app:\n' +
        '  1. Go to https://console.cloud.google.com/apis/credentials\n' +
        '  2. OAuth 2.0 Playground: https://developers.google.com/oauthplayground/\n' +
        '  3. Select YouTube Data API v3\n' +
        '  4. Authorize & get new refresh token'
      );
    }

    throw new Error(`YouTube token refresh failed: ${data.error_description || data.error}`);
  } catch (err) {
    if (err.message.includes('REVOKED')) throw err;
    throw new Error(`YouTube token refresh error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Facebook/Instagram/Threads shared token logic
// ---------------------------------------------------------------------------

/**
 * Get valid Facebook-platform token (Instagram or Threads)
 * Both use the same Facebook Graph API token exchange mechanism
 */
async function getValidFacebookToken(envKey, platformName) {
  const token = process.env[envKey];
  if (!token) throw new Error(`${envKey} not set`);

  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;

  if (!appId || !appSecret) {
    console.log(`  ⚠️ FB_APP_ID/FB_APP_SECRET not set — cannot auto-refresh ${platformName} token`);
    return token;
  }

  // Step 1: Debug token to check validity
  const debug = await debugFacebookToken(token, appId, appSecret);

  if (!debug.data) {
    // Debug API not available (code 200 = "API access blocked")
    // Token might still work for publishing — just can't check expiry proactively
    // Refresh will be attempted when the API returns an auth error
    console.log(`  ℹ️ ${platformName} token: cannot check expiry (debug API not available) — will refresh on auth error`);
    return token;
  }

  const { is_valid, expires_at, scopes } = debug.data;

  // Token is invalid — cannot refresh, need manual regeneration
  if (is_valid === false) {
    throw new Error(
      `${platformName} token is INVALID (revoked or malformed).\n` +
      `  Auto-refresh not possible for invalid tokens.\n` +
      `  Generate new token:\n` +
      `  1. https://developers.facebook.com/tools/explorer/\n` +
      `  2. Select app → Generate token with required scopes\n` +
      `  3. Update ${envKey} in GitHub Secrets`
    );
  }

  // Step 2: Check expiry
  if (expires_at) {
    const now = Date.now();
    const expiresMs = expires_at * 1000;
    const daysLeft = (expiresMs - now) / (1000 * 60 * 60 * 24);

    console.log(`  📅 ${platformName} token: ${Math.round(daysLeft)} days left (scopes: ${scopes?.join(', ') || 'unknown'})`);

    // Token expired
    if (daysLeft < 0) {
      console.log(`  ❌ ${platformName} token EXPIRED ${Math.abs(Math.round(daysLeft))} days ago — refreshing...`);
      return await refreshFacebookToken(token, envKey, platformName, appId, appSecret);
    }

    // Token expiring soon (within buffer)
    if (daysLeft < REFRESH_BUFFER_DAYS) {
      console.log(`  🔄 ${platformName} token expiring in ${Math.round(daysLeft)} days — refreshing early...`);
      return await refreshFacebookToken(token, envKey, platformName, appId, appSecret);
    }

    console.log(`  ✅ ${platformName} token is valid`);
  }

  return token;
}

/**
 * Refresh a Facebook long-lived token (works for both Instagram and Threads)
 * Exchange current long-lived token for a new one (extends by 60 days)
 */
async function refreshFacebookToken(currentToken, envKey, platformName, appId, appSecret) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${appId}&` +
      `client_secret=${appSecret}&` +
      `fb_exchange_token=${currentToken}`
    );

    const data = await res.json();

    if (data.access_token) {
      console.log(`  ✅ ${platformName} token refreshed (new 60-day token)`);

      // Persist new token
      await updateSecret(envKey, data.access_token);

      // Update in-memory for current run
      process.env[envKey] = data.access_token;

      return data.access_token;
    }

    // Refresh failed
    const errMsg = data.error?.message || 'Unknown error';
    console.log(`  ❌ ${platformName} token refresh failed: ${errMsg}`);

    // If the error is about invalid token, we can't refresh
    if (data.error?.code === 190) {
      throw new Error(
        `${platformName} token refresh failed: ${errMsg}\n` +
        `  Token may be revoked. Generate new one manually.`
      );
    }

    // Other errors — return current token and hope for the best
    return currentToken;
  } catch (err) {
    if (err.message.includes('revoked')) throw err;
    console.log(`  ❌ ${platformName} token refresh error: ${err.message}`);
    return currentToken;
  }
}

/**
 * Debug/inspect a Facebook access token
 * Uses app access token (app_id|app_secret) for debug API
 */
async function debugFacebookToken(token, appId, appSecret) {
  try {
    const appToken = `${appId}|${appSecret}`;

    const res = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${token}&access_token=${appToken}`
    );

    const data = await res.json();

    // Log debug response for troubleshooting
    if (data.error) {
      console.log(`  ⚠️ Token debug API error: ${data.error.message} (code: ${data.error.code})`);
    }

    return data;
  } catch (err) {
    console.log(`  ⚠️ Token debug network error: ${err.message}`);
    return { data: null };
  }
}

// ---------------------------------------------------------------------------
// Secret persistence — GitHub Secrets (CI) or .env (local)
// ---------------------------------------------------------------------------

/**
 * Update a secret/token — detects environment and persists accordingly
 */
async function updateSecret(key, value) {
  if (IS_CI) {
    await updateGitHubSecret(key, value);
  } else {
    await updateEnvFile(key, value);
  }
}

/**
 * Update GitHub Secret via gh CLI
 * Uses GH_PAT (Personal Access Token with repo scope) for secrets write access
 * Falls back to GITHUB_TOKEN (limited, may not work for secrets)
 */
async function updateGitHubSecret(key, value) {
  try {
    // Use PAT if available (has secrets write access)
    const pat = process.env.GH_PAT;
    const env = pat
      ? { ...process.env, GITHUB_TOKEN: pat }
      : { ...process.env };

    await execFileAsync('gh', ['secret', 'set', key, '--body', value], {
      env,
      timeout: 15000,
    });
    console.log(`  🔐 GitHub Secret updated: ${key}`);
  } catch (err) {
    console.log(`  ⚠️ Failed to update GitHub Secret ${key}: ${err.message}`);
    if (!process.env.GH_PAT) {
      console.log(`  💡 Set GH_PAT secret (Personal Access Token with repo scope) for auto-update`);
    }
  }
}

/**
 * Update a value in local .env file
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
    console.log(`  ⚠️ Failed to update .env ${key}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Execute with auto-refresh — retry API call if auth error
// ---------------------------------------------------------------------------

/**
 * Execute a Facebook API call with automatic token refresh on auth error.
 * Wraps the publisher function to handle token expiration transparently.
 *
 * @param {string} envKey — Environment variable key (INSTAGRAM_ACCESS_TOKEN or THREADS_ACCESS_TOKEN)
 * @param {string} platformName — Display name for logging
 * @param {Function} apiFn — Async function that takes (accessToken) and makes the API call
 * @returns {Promise<any>} Result from apiFn
 */
export async function executeWithTokenRefresh(envKey, platformName, apiFn) {
  // First attempt with current token
  let token = process.env[envKey];

  try {
    return await apiFn(token);
  } catch (err) {
    // Check if it's an auth error (token expired/invalid)
    const isAuthError = err.message.includes('OAuth') ||
      err.message.includes('access token') ||
      err.message.includes('Invalid token') ||
      err.message.includes('code 190') ||
      err.message.includes('code 102');

    if (!isAuthError) throw err;

    console.log(`  🔄 ${platformName} auth error — attempting token refresh...`);

    // Try to refresh
    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;

    if (!appId || !appSecret) {
      throw new Error(`${platformName} token expired and FB_APP_ID/FB_APP_SECRET not set for refresh`);
    }

    const refreshed = await refreshFacebookToken(token, envKey, platformName, appId, appSecret);

    if (refreshed === token) {
      throw new Error(`${platformName} token refresh failed — token unchanged`);
    }

    // Retry with new token
    console.log(`  🔄 Retrying ${platformName} with refreshed token...`);
    return await apiFn(refreshed);
  }
}

// ---------------------------------------------------------------------------
// Scheduled token health check — call from cron workflow
// ---------------------------------------------------------------------------

/**
 * Check and refresh ALL platform tokens
 * Returns status report for each platform
 */
export async function checkAllTokens() {
  const report = {};

  // Instagram
  try {
    await getValidInstagramToken();
    report.instagram = { status: 'ok' };
  } catch (err) {
    report.instagram = { status: 'error', message: err.message };
  }

  // Threads
  try {
    await getValidThreadsToken();
    report.threads = { status: 'ok' };
  } catch (err) {
    report.threads = { status: 'error', message: err.message };
  }

  // YouTube
  try {
    await getValidYouTubeToken();
    report.youtube = { status: 'ok' };
  } catch (err) {
    report.youtube = { status: 'error', message: err.message };
  }

  return report;
}
