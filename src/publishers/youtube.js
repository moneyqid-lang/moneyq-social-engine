// moneyq-social-engine/src/publishers/youtube.js
// Task 18: YouTube Shorts Publisher — via YouTube Data API v3 (resumable upload)
import { config } from '../utils/config.js';
import { withRetry } from '../utils/retry.js';
import { statSync, createReadStream } from 'node:fs';
import { getValidYouTubeToken } from '../utils/token-manager.js';

/**
 * Publish a Shorts video to YouTube.
 * Uses YouTube Data API v3 with resumable upload.
 *
 * @param {string} videoPath - Local path to MP4 file
 * @param {string} title - Video title (max 100 chars)
 * @param {string} description - Video description
 * @param {string[]} tags - Additional tags
 * @returns {Promise<{postId: string, permalink: string}>}
 */
export async function publishToYouTube(videoPath, title, description, tags = []) {
  const { refreshToken } = config.platforms.youtube;

  if (!refreshToken) {
    console.log('  ⚠️ YouTube API not configured. Save video for manual upload.');
    return { postId: null, permalink: null, manualUpload: true, videoPath };
  }

  // Step 1: Get valid access token (auto-refresh)
  const accessToken = await getValidYouTubeToken();

  // Step 2: Upload video via resumable upload
  console.log('  📤 Uploading to YouTube Shorts...');
  const videoId = await uploadVideo(videoPath, title, description, tags, accessToken);

  console.log(`  🚀 Published to YouTube Shorts: ${videoId}`);

  return {
    postId: videoId,
    permalink: `https://youtube.com/shorts/${videoId}`,
  };
}

async function uploadVideo(videoPath, title, description, tags, accessToken) {
  const fileSize = statSync(videoPath).size;

  // Ensure #Shorts is in description for Shorts classification
  const shortsDescription = description.includes('#Shorts')
    ? description
    : `${description}\n\n#Shorts`;

  // Step 1: Initialize resumable upload
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(fileSize),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: title.slice(0, 100),
          description: `${shortsDescription}\n\n#MoneyQ #Keuangan #Budgeting`,
          tags: ['moneyq', 'keuangan', 'budgeting', 'shorts', 'tips keuangan', ...tags],
          categoryId: '22', // People & Blogs
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      }),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error(`YouTube init failed: ${err.error?.message || initRes.status}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube: no upload URL returned');

  // Step 2: Upload the video bytes
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(fileSize),
    },
    body: createReadStream(videoPath),
    duplex: 'half',
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(`YouTube upload failed: ${err.error?.message || uploadRes.status}`);
  }

  const result = await uploadRes.json();
  return result.id;
}
