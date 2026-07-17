// pexels-fetcher.js — Fetch Pexels stock footage & images for DynamicVideo
//
// Searches Pexels API with topic-relevant keywords, downloads portrait
// video clips and images for use as Remotion video backgrounds.
//
// All downloads are cached locally to avoid re-fetching within the same run.

import { join } from 'node:path';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { config } from '../utils/config.js';

const OUTPUT_DIR = join(process.cwd(), 'output', 'pexels-cache');

// ---------------------------------------------------------------------------
// Pillar → Search keywords (Indonesian + English mix for better results)
// ---------------------------------------------------------------------------

const PILLAR_KEYWORDS = {
  tips_hemat: [
    'saving money wallet',
    'coffee shop lifestyle',
    'calculator budget',
    'piggy bank coins',
    'grocery shopping',
  ],
  fakta_finansial: [
    'stock market chart',
    'money counting cash',
    'business data analytics',
    'finance office work',
    'banking technology',
  ],
  challenge: [
    'fitness motivation goals',
    'lifestyle productivity',
    'morning routine active',
    'running exercise energy',
    'team challenge celebration',
  ],
  mentor_wise: [
    'business meeting mentor',
    'office discussion advice',
    'professional handshake',
    'teaching coaching guidance',
    'success celebration',
  ],
  feature_deep_dive: [
    'mobile app technology',
    'smartphone usage modern',
    'dashboard screen interface',
    'digital banking fintech',
    'online payment contactless',
  ],
  edukasi_siklus: [
    'calendar planning schedule',
    'notebook writing notes',
    'organization productivity',
    'time management clock',
    'monthly planning',
  ],
  before_after: [
    'transformation progress',
    'happy success celebration',
    'before after improvement',
    'growth progress chart',
    'positive change lifestyle',
  ],
  behind_product: [
    'team working office',
    'developer coding laptop',
    'startup workspace creative',
    'product design process',
    'tech company culture',
  ],
};

// ---------------------------------------------------------------------------
// Main: Fetch videos + images for a topic
// ---------------------------------------------------------------------------

/**
 * Fetch Pexels media for a given topic.
 *
 * @param {Object} topic — { pillar, topic, angle }
 * @param {Object} [options]
 * @param {number} [options.videoCount=2] — Number of video clips to fetch
 * @param {number} [options.imageCount=2] — Number of images to fetch
 * @returns {Promise<{videoPaths: string[], imagePaths: string[]}>}
 */
export async function fetchPexelsMedia(topic, options = {}) {
  const { videoCount = 2, imageCount = 2 } = options;

  if (!config.pexels?.apiKey) {
    throw new Error('PEXELS_API_KEY not configured');
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const pillar = topic?.pillar || 'tips_hemat';
  const keywords = PILLAR_KEYWORDS[pillar] || PILLAR_KEYWORDS.tips_hemat;

  // Pick a random keyword set for variety
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];

  console.log(`  🔍 Pexels search: "${keyword}" (pillar: ${pillar})`);

  // Fetch videos and images in parallel
  const [videoPaths, imagePaths] = await Promise.all([
    fetchVideos(keyword, videoCount),
    fetchImages(keyword, imageCount),
  ]);

  return { videoPaths, imagePaths };
}

// ---------------------------------------------------------------------------
// Fetch portrait videos from Pexels
// ---------------------------------------------------------------------------

async function fetchVideos(query, count) {
  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${count * 2}&orientation=portrait&size=medium`;
    const res = await fetch(url, {
      headers: { Authorization: config.pexels.apiKey },
    });

    if (!res.ok) {
      console.log(`  ⚠️ Pexels videos API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!data.videos?.length) {
      console.log(`  ⚠️ No Pexels videos found for "${query}"`);
      return [];
    }

    const paths = [];
    for (const video of data.videos.slice(0, count)) {
      // Pick best quality ≤1080p portrait
      const file = video.video_files
        ?.filter(f => f.width && f.width <= 1080 && f.file_type === 'video/mp4')
        .sort((a, b) => (b.width || 0) - (a.width || 0))[0];

      if (!file?.link) continue;

      const path = await downloadFile(file.link, `video-${video.id}.mp4`);
      if (path) paths.push(path);
    }

    console.log(`  📹 Downloaded ${paths.length}/${count} Pexels videos`);
    return paths;
  } catch (err) {
    console.log(`  ⚠️ Pexels video fetch failed: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fetch portrait images from Pexels
// ---------------------------------------------------------------------------

async function fetchImages(query, count) {
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count * 2}&orientation=portrait&size=medium`;
    const res = await fetch(url, {
      headers: { Authorization: config.pexels.apiKey },
    });

    if (!res.ok) {
      console.log(`  ⚠️ Pexels images API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!data.photos?.length) {
      console.log(`  ⚠️ No Pexels images found for "${query}"`);
      return [];
    }

    const paths = [];
    for (const photo of data.photos.slice(0, count)) {
      // Pick medium quality (good enough for 1080x1920)
      const imageUrl = photo.src?.large2x || photo.src?.large || photo.src?.medium;
      if (!imageUrl) continue;

      const path = await downloadFile(imageUrl, `image-${photo.id}.jpg`);
      if (path) paths.push(path);
    }

    console.log(`  🖼️ Downloaded ${paths.length}/${count} Pexels images`);
    return paths;
  } catch (err) {
    console.log(`  ⚠️ Pexels image fetch failed: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Download file to cache directory
// ---------------------------------------------------------------------------

async function downloadFile(url, filename) {
  const path = join(OUTPUT_DIR, filename);

  // Skip if already cached
  try {
    await access(path);
    return path;
  } catch {
    // Not cached, download
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(path, buffer);
    return path;
  } catch (err) {
    console.log(`  ⚠️ Download failed (${filename}): ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cleanup old cache files (older than 24 hours)
// ---------------------------------------------------------------------------

export async function cleanupCache(maxAgeHours = 24) {
  try {
    const { readdir, stat, unlink } = await import('node:fs/promises');
    const files = await readdir(OUTPUT_DIR);
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = join(OUTPUT_DIR, file);
      const stats = await stat(filePath);
      if (now - stats.mtimeMs > maxAge) {
        await unlink(filePath);
      }
    }
  } catch {
    // Cache dir might not exist yet
  }
}
