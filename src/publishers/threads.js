// moneyq-social-engine/src/publishers/threads.js
// Task 17: Threads Publisher — via Instagram Graph API (threads scope)
import { config } from '../utils/config.js';
import { withRetry } from '../utils/retry.js';

const THREADS_API = 'https://graph.threads.net/v1.0';

/**
 * Publish a text thread to Threads (via Instagram Graph API).
 * Threads API is part of the Instagram Graph API with threads_ scope.
 *
 * @param {string} text - Thread text content
 * @returns {Promise<{postId: string, permalink: string}>}
 */
export async function publishToThreads(text) {
  const { accessToken, accountId } = config.platforms.instagram;

  if (!accessToken || !accountId) {
    console.log('  ⚠️ Threads API not configured (uses Instagram credentials).');
    return { postId: null, permalink: null, manualUpload: true, text };
  }

  // Step 1: Create thread media container
  console.log('  📤 Creating Threads post...');
  const containerId = await createThreadContainer(text, accessToken, accountId);

  // Step 2: Wait for container to be ready (Threads containers need processing)
  console.log('  ⏳ Waiting for container processing...');
  await waitForContainer(containerId, accessToken, accountId);

  // Step 3: Publish thread
  console.log('  🚀 Publishing to Threads...');
  const result = await publishThread(containerId, accessToken, accountId);

  return {
    postId: result.id,
    permalink: `https://www.threads.net/@moneyq/post/${result.id}`,
  };
}

/**
 * Publish a thread with an image (carousel-style).
 *
 * @param {string} imageUrl - URL of the image to attach
 * @param {string} text - Caption text
 * @returns {Promise<{postId: string, permalink: string}>}
 */
export async function publishToThreadsWithImage(imageUrl, text) {
  const { accessToken, accountId } = config.platforms.instagram;

  if (!accessToken || !accountId) {
    console.log('  ⚠️ Threads API not configured.');
    return { postId: null, permalink: null, manualUpload: true };
  }

  // Step 1: Create image container
  console.log('  📤 Creating Threads image post...');
  const containerId = await createImageContainer(imageUrl, text, accessToken, accountId);

  // Step 2: Wait for processing
  await waitForContainer(containerId, accessToken, accountId);

  // Step 3: Publish
  console.log('  🚀 Publishing to Threads...');
  const result = await publishThread(containerId, accessToken, accountId);

  return {
    postId: result.id,
    permalink: `https://www.threads.net/@moneyq/post/${result.id}`,
  };
}

async function createThreadContainer(text, accessToken, accountId) {
  const result = await withRetry(async () => {
    const formData = new URLSearchParams({
      media_type: 'TEXT',
      text,
      access_token: accessToken,
    });

    const res = await fetch(`${THREADS_API}/${accountId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Threads creation failed: ${err.error?.message || res.status}`);
    }

    return res.json();
  });

  return result.id;
}

async function createImageContainer(imageUrl, text, accessToken, accountId) {
  const result = await withRetry(async () => {
    const formData = new URLSearchParams({
      media_type: 'IMAGE',
      image_url: imageUrl,
      text,
      access_token: accessToken,
    });

    const res = await fetch(`${THREADS_API}/${accountId}/threads`, {
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

async function waitForContainer(containerId, accessToken, accountId) {
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    const res = await fetch(
      `${THREADS_API}/${containerId}?fields=status,status_code&access_token=${accessToken}`
    );
    const data = await res.json();

    if (data.status === 'FINISHED') return;
    if (data.status === 'ERROR') {
      throw new Error(`Threads container error: ${data.status_code}`);
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

async function publishThread(containerId, accessToken, accountId) {
  const result = await withRetry(async () => {
    const formData = new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
    });

    const res = await fetch(`${THREADS_API}/${accountId}/threads_publish`, {
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
