// moneyq-social-engine/src/orchestrator.js
// Main pipeline controller — ties topic selection → copy generation → image
// → compression → publishing into a single execution cycle.
//
// Called by GitHub Actions cron (via src/index.js generate) every 2-4 hours.

import { selectTopic } from './generators/topic-selector.js';
import { generateCopy } from './generators/copy-writer.js';
import { generateImage } from './generators/image-gen.js';
import { validateContent } from './utils/validator.js';
import { compressImage } from './utils/compressor.js';
import { db } from './db.js';

// ---------------------------------------------------------------------------
// Publisher lazy-loader — publishers are only imported when their platform is
// first processed.  New platforms (TikTok, Threads, YouTube) will be added
// here as they are implemented in later tasks.
// ---------------------------------------------------------------------------
const publishers = {};

async function getPublisher(platform) {
  if (!publishers[platform]) {
    switch (platform) {
      case 'instagram':
        publishers[platform] = await import('./publishers/instagram.js');
        break;
      case 'tiktok':
        publishers[platform] = await import('./publishers/tiktok.js');
        break;
      case 'threads':
        publishers[platform] = await import('./publishers/threads.js');
        break;
      case 'youtube':
        publishers[platform] = await import('./publishers/youtube.js');
        break;
      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
  }
  return publishers[platform];
}

// ---------------------------------------------------------------------------
// run — full pipeline for one execution cycle
// ---------------------------------------------------------------------------

/**
 * @param {string}  [dateStr]        - ISO date string (defaults to today)
 * @param {string[]} [targetPlatforms] - Platforms to process (default:
 *                                      ['instagram'] during MVP)
 * @returns {Promise<{date: string, results: Array<{platform: string, status: string, postId?: string, url?: string, error?: string}>}>}
 */
export async function run(dateStr, targetPlatforms) {
  const today = dateStr || new Date().toISOString().split('T')[0];
  const platforms = targetPlatforms || ['instagram', 'threads', 'tiktok', 'youtube'];
  const results = [];

  console.log(`\n🚀 MoneyQ Social Engine — ${today}`);
  console.log(`   Platforms: ${platforms.join(', ')}\n`);

  for (const platform of platforms) {
    try {
      console.log(`📱 Processing ${platform.toUpperCase()}...`);

      // --- Step 1: Select topic ---
      const topic = await selectTopic(today, platform);
      if (!topic) {
        console.log(`  ⏭️ No topic found for ${platform}, skipping`);
        continue;
      }
      console.log(`  📋 Topic: ${topic.topic} (${topic.pillar})`);

      // --- Step 2: Generate copy ---
      const copy = await generateCopy(topic, platform);
      console.log(`  ✍️ Copy generated via ${copy.provider}`);
      console.log(`  Hook: ${copy.hook.slice(0, 60)}...`);

      // --- Step 3: Validate content ---
      const validation = validateContent(copy, platform);
      if (!validation.valid) {
        console.log(`  ❌ Validation failed: ${validation.errors.join(', ')}`);
        await recordFailure(topic, platform, copy, validation.errors.join('; '));
        continue;
      }

      // --- Step 4: Generate media ---
      const publishContent = `${copy.body}\n\n${copy.hashtags.map(h => '#' + h).join(' ')}`;
      let mediaUrls = [];
      let result;

      const publisher = await getPublisher(platform);

      if (platform === 'instagram') {
        // Instagram: generate image → compress → publish
        const imageResult = await generateImage(copy, topic);
        const mediaPath = await compressImage(imageResult.imagePath);
        mediaUrls = [imageResult.imageUrl || imageResult.imagePath];
        console.log(`  🖼️ Image ready: ${mediaPath}`);

        result = await publisher.publishToInstagram(mediaUrls[0], publishContent);
      } else if (platform === 'threads') {
        // Threads: text-based post (optionally with image)
        const imageResult = await generateImage(copy, topic);
        if (imageResult?.imageUrl) {
          result = await publisher.publishToThreadsWithImage(imageResult.imageUrl, publishContent);
          mediaUrls = [imageResult.imageUrl];
        } else {
          result = await publisher.publishToThreads(publishContent);
        }
      } else if (platform === 'tiktok' || platform === 'youtube') {
        // Video platforms: generate video → publish
        const { generateVideo } = await import('./generators/video-gen.js');
        const videoPath = await generateVideo(copy, topic, 'daily');
        console.log(`  🎥 Video ready: ${videoPath}`);
        mediaUrls = [videoPath];

        if (platform === 'tiktok') {
          result = await publisher.publishToTikTok(videoPath, publishContent);
        } else {
          result = await publisher.publishToYouTube(
            videoPath,
            copy.hook.slice(0, 100),
            publishContent,
            copy.hashtags.slice(0, 5)
          );
        }
      }

      console.log(`  ✅ Published: ${result?.permalink || 'manual upload required'}`);

      // --- Step 8: Record history ---
      const isManualUpload = result?.manualUpload === true;
      await db.insertContentHistory({
        calendarId: topic.id,
        platform,
        postId: result?.postId,
        contentJson: { ...copy, topic: topic.topic },
        mediaUrls,
        publishedAt: isManualUpload ? null : new Date().toISOString(),
        status: isManualUpload ? 'generated' : 'published',
      });

      if (topic.id) {
        await db.updateCalendarStatus(topic.id, 'published');
      }

      results.push({
        platform,
        status: 'published',
        postId: result.postId,
        url: result.permalink,
      });
    } catch (err) {
      console.log(`  💥 Error on ${platform}: ${err.message}`);
      try {
        await db.insertContentHistory({
          platform,
          contentJson: { error: err.message },
          status: 'failed',
        });
      } catch (dbErr) {
        console.error(`  Failed to record failure: ${dbErr.message}`);
      }
      results.push({ platform, status: 'error', error: err.message });
    }
  }

  const published = results.filter(r => r.status === 'published').length;
  console.log(`\n✨ Pipeline complete. ${published}/${results.length} published.`);
  return { date: today, results };
}

// ---------------------------------------------------------------------------
// Failure recorder — persists failed content so the team can audit
// ---------------------------------------------------------------------------

async function recordFailure(topic, platform, copy, error) {
  try {
    await db.insertContentHistory({
      calendarId: topic.id,
      platform,
      contentJson: { ...copy, topic: topic.topic },
      status: 'failed',
    });
  } catch (e) {
    console.error(`  Failed to record failure: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — called by `npm run generate`
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , dateArg, ...platforms] = process.argv.slice(2);
  run(dateArg, platforms.length > 0 ? platforms : undefined)
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
