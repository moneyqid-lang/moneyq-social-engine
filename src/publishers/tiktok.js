// moneyq-social-engine/src/publishers/tiktok.js
// Task 16: TikTok Publisher — Direct Post via Content Posting API
import { config } from '../utils/config.js';
import { withRetry } from '../utils/retry.js';
import { createReadStream, statSync } from 'node:fs';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

/**
 * Publish a video to TikTok.
 * Uses TikTok Content Posting API (Direct Post).
 *
 * @param {string} videoPath - Local path to MP4 file
 * @param {string} caption - Video caption with hashtags
 * @returns {Promise<{postId: string, permalink: string}>}
 */
export async function publishToTikTok(videoPath, caption) {
  const { accessToken } = config.platforms.tiktok;

  if (!accessToken) {
    console.log('  ⚠️ TikTok API not configured. Save video for manual upload.');
    return { postId: null, permalink: null, manualUpload: true, videoPath };
  }

  // Step 1: Initialize upload
  console.log('  📤 Initializing TikTok upload...');
  const uploadInit = await initUpload(videoPath, accessToken, caption);

  // Step 2: Upload video bytes
  console.log('  📤 Uploading video...');
  await uploadVideo(uploadInit.upload_url, videoPath);

  // Step 3: Check status
  console.log('  ⏳ Waiting for TikTok processing...');
  const publishResult = await checkStatus(uploadInit.publish_id, accessToken);

  return {
    postId: publishResult.public_video_id,
    permalink: publishResult.public_video_id
      ? `https://www.tiktok.com/@moneyq/video/${publishResult.public_video_id}`
      : null,
  };
}

async function initUpload(videoPath, accessToken, caption) {
  const fileSize = statSync(videoPath).size;

  const result = await withRetry(async () => {
    const res = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: fileSize,
          total_chunk_count: 1,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`TikTok init failed: ${err.error?.message || res.status}`);
    }

    return res.json();
  });

  return result.data;
}

async function uploadVideo(uploadUrl, videoPath) {
  const fileStream = createReadStream(videoPath);

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(statSync(videoPath).size),
    },
    body: fileStream,
  });

  if (!res.ok) {
    throw new Error(`TikTok upload failed: ${res.status}`);
  }
}

async function checkStatus(publishId, accessToken) {
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    const res = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const data = await res.json();

    if (data.data?.status === 'PUBLISH_COMPLETE') {
      return data.data;
    }
    if (data.data?.status === 'FAILED') {
      throw new Error(`TikTok publish failed: ${data.data.fail_reason}`);
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('TikTok processing timeout after 60s');
}
