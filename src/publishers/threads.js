// moneyq-social-engine/src/publishers/threads.js
// Task 17: Threads Publisher — via Threads API (graph.threads.net)
// Uses dedicated Threads app credentials (separate from Instagram)
import { config } from '../utils/config.js';
import { withRetry } from '../utils/retry.js';
import { getValidThreadsToken } from '../utils/token-manager.js';

const THREADS_API = 'https://graph.threads.net/v1.0';

/**
 * Publish a text thread to Threads.
 *
 * @param {string} text - Thread text content
 * @returns {Promise<{postId: string, permalink: string}>}
 */
export async function publishToThreads(text) {
  const { userId } = config.platforms.threads;
  const accessToken = await getValidThreadsToken();

  if (!accessToken || !userId) {
    console.log('  ⚠️ Threads API not configured. Set THREADS_ACCESS_TOKEN and THREADS_USER_ID in .env');
    return { postId: null, permalink: null, manualUpload: true, text };
  }

  // Step 1: Create thread media container
  console.log('  📤 Creating Threads post...');
  const containerId = await createThreadContainer(text, accessToken, userId);

  // Step 2: Wait for container to be ready (Threads containers need processing)
  console.log('  ⏳ Waiting for container processing...');
  await waitForContainer(containerId, accessToken);

  // Step 3: Publish thread
  console.log('  🚀 Publishing to Threads...');
  const result = await publishThread(containerId, accessToken, userId);

  return {
    postId: result.id,
    permalink: `https://www.threads.net/@moneyq/post/${result.id}`,
  };
}

/**
 * Publish a thread with an image.
 *
 * @param {string} imageUrl - URL of the image to attach
 * @param {string} text - Caption text
 * @returns {Promise<{postId: string, permalink: string}>}
 */
export async function publishToThreadsWithImage(imageUrl, text) {
  const { userId } = config.platforms.threads;
  const accessToken = await getValidThreadsToken();

  if (!accessToken || !userId) {
    console.log('  ⚠️ Threads API not configured.');
    return { postId: null, permalink: null, manualUpload: true };
  }

  // Step 1: Create image container
  console.log('  📤 Creating Threads image post...');
  const containerId = await createImageContainer(imageUrl, text, accessToken, userId);

  // Step 2: Wait for processing
  await waitForContainer(containerId, accessToken);

  // Step 3: Publish
  console.log('  🚀 Publishing to Threads...');
  const result = await publishThread(containerId, accessToken, userId);

  return {
    postId: result.id,
    permalink: `https://www.threads.net/@moneyq/post/${result.id}`,
  };
}

async function createThreadContainer(text, accessToken, userId) {
  // Threads has a 500 character limit for text posts
  const truncatedText = text.length > 500 ? text.slice(0, 497) + '...' : text;

  const result = await withRetry(async () => {
    const formData = new URLSearchParams({
      media_type: 'TEXT',
      text: truncatedText,
      access_token: accessToken,
    });

    const res = await fetch(`${THREADS_API}/${userId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = err.error?.message || `HTTP ${res.status}`;
      const errCode = err.error?.code;

      // Token invalid/expired — throw with clear message
      if (errCode === 190 || errMsg.includes('Invalid OAuth') || errMsg.includes('access token')) {
        throw new Error(
          `Threads token INVALID. Generate new token:\n` +
          `  1. Go to https://developers.facebook.com/tools/explorer/\n` +
          `  2. Select Threads app\n` +
          `  3. Generate token with scopes: threads_basic, threads_content_publish\n` +
          `  4. Update THREADS_ACCESS_TOKEN in GitHub Secrets`
        );
      }

      throw new Error(`Threads creation failed: ${errMsg}`);
    }

    return res.json();
  });

  return result.id;
}

async function createImageContainer(imageUrl, text, accessToken, userId) {
  // Threads has a 500 character limit for text
  const truncatedText = text.length > 500 ? text.slice(0, 497) + '...' : text;

  const result = await withRetry(async () => {
    const formData = new URLSearchParams({
      media_type: 'IMAGE',
      image_url: imageUrl,
      text: truncatedText,
      access_token: accessToken,
    });

    const res = await fetch(`${THREADS_API}/${userId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Threads image creation failed: ${err.error?.message || res.status}`);
    }

    return res.json();
  });

  return result.id;
}

async function waitForContainer(containerId, accessToken) {
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    const res = await fetch(
      `${THREADS_API}/${containerId}?fields=status&access_token=${accessToken}`
    );
    const data = await res.json();

    if (data.status === 'FINISHED') return;
    if (data.status === 'ERROR') {
      throw new Error('Threads container processing error');
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  throw new Error('Threads container processing timeout');
}

async function publishThread(containerId, accessToken, userId) {
  const result = await withRetry(async () => {
    const formData = new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
    });

    const res = await fetch(`${THREADS_API}/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Threads publish failed: ${err.error?.message || res.status}`);
    }

    return res.json();
  });

  return result;
}
