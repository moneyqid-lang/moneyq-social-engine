// moneyq-social-engine/src/publishers/instagram.js
import { config } from '../utils/config.js';
import { withRetry } from '../utils/retry.js';

const IG_API_BASE = 'https://graph.facebook.com/v20.0';

/**
 * Publish a single image post to Instagram Business Account.
 * Uses 2-step process: create media container → publish.
 *
 * @param {string} imageUrl - Public URL to the image (must be HTTPS)
 * @param {string} caption - Post caption with hashtags
 * @returns {Promise<{postId: string, permalink: string}>}
 */
export async function publishToInstagram(imageUrl, caption) {
  const { accessToken, accountId } = config.platforms.instagram;

  if (!imageUrl) throw new Error('Image URL is required for Instagram publishing');

  // Step 1: Create media container
  console.log('  📤 Creating Instagram media container...');
  const containerId = await createMediaContainer(imageUrl, caption, accessToken, accountId);

  // Step 2: Wait for processing (Instagram needs time to process the image)
  console.log('  ⏳ Waiting for Instagram processing...');
  await waitForProcessing(containerId, accessToken);

  // Step 3: Publish
  console.log('  🚀 Publishing to Instagram...');
  const publishResult = await publishContainer(containerId, accessToken, accountId);

  return publishResult;
}

async function createMediaContainer(imageUrl, caption, accessToken, accountId) {
  const result = await withRetry(async () => {
    const formData = new URLSearchParams({
      image_url: imageUrl,
      caption: caption || '',
      access_token: accessToken,
    });

    const res = await fetch(`${IG_API_BASE}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`IG media creation failed: ${err.error?.message || res.status}`);
    }

    return res.json();
  }, { maxRetries: 3, baseDelayMs: 5000 });

  return result.id;
}

async function waitForProcessing(containerId, accessToken) {
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    const res = await fetch(
      `${IG_API_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(`IG processing status check failed: ${err.error?.message || res.status}`);
    }

    const data = await res.json();

    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error(`IG processing error: ${data.status}`);

    attempts++;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error('Instagram processing timeout after 60s');
}

async function publishContainer(containerId, accessToken, accountId) {
  const result = await withRetry(async () => {
    const formData = new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
    });

    const res = await fetch(`${IG_API_BASE}/${accountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`IG publish failed: ${err.error?.message || res.status}`);
    }

    return res.json();
  }, { maxRetries: 2, baseDelayMs: 5000 });

  return {
    postId: result.id,
    permalink: `https://instagram.com/p/${result.id}`,
  };
}

/**
 * Publish a carousel (multi-image) post to Instagram.
 */
export async function publishCarouselToInstagram(imageUrls, caption) {
  const { accessToken, accountId } = config.platforms.instagram;

  if (!imageUrls || imageUrls.length < 2) {
    throw new Error('At least 2 images required for carousel');
  }

  // Step 1: Create media containers for each image
  const containerIds = [];
  for (const url of imageUrls) {
    console.log(`  📤 Creating container for slide ${containerIds.length + 1}...`);
    const containerId = await createMediaContainer(url, null, accessToken, accountId);
    containerIds.push(containerId);
  }

  // Step 2: Wait for all containers
  for (const id of containerIds) {
    await waitForProcessing(id, accessToken);
  }

  // Step 3: Create carousel container
  const carouselResult = await withRetry(async () => {
    const formData = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: containerIds.join(','),
      caption: caption || '',
      access_token: accessToken,
    });

    const res = await fetch(`${IG_API_BASE}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`IG carousel creation failed: ${err.error?.message || res.status}`);
    }

    return res.json();
  }, { maxRetries: 3, baseDelayMs: 5000 });

  // Step 4: Wait for carousel processing
  await waitForProcessing(carouselResult.id, accessToken);

  // Step 5: Publish carousel
  return publishContainer(carouselResult.id, accessToken, accountId);
}
