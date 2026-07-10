// moneyq-social-engine/src/utils/compressor.js
// Image and video compression utilities using sharp and ffmpeg-static

import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import ffmpegPath from 'ffmpeg-static';

const execAsync = promisify(execFile);
const OUTPUT_DIR = join(process.cwd(), 'output', 'compressed');

const PLATFORM_SPECS = {
  instagram: { image: { maxBytes: 8 * 1024 * 1024, quality: 85 }, video: { maxBytes: 100 * 1024 * 1024 } },
  tiktok: { video: { maxBytes: 1024 * 1024 * 1024 } },
  youtube: { video: { maxBytes: 256 * 1024 * 1024 * 1024 } },
};

/**
 * Compress an image to platform-safe size and quality.
 * Resizes to fit within 1080x1080, outputs progressive JPEG at quality 85.
 * @param {string} inputPath - Path to source image
 * @returns {Promise<string>} Path to compressed output file
 */
export async function compressImage(inputPath) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `compressed-${Date.now()}.jpg`);

  await sharp(inputPath)
    .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: PLATFORM_SPECS.instagram.image.quality, progressive: true })
    .toFile(outputPath);

  return outputPath;
}

/**
 * Compress a video for a given platform using ffmpeg.
 * Uses libx264 CRF 28, AAC audio, faststart for web streaming.
 * @param {string} inputPath - Path to source video
 * @param {string} platform - Target platform key (instagram, tiktok, youtube)
 * @returns {Promise<string>} Path to compressed output file
 */
export async function compressVideo(inputPath, platform = 'instagram') {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `compressed-${platform}-${Date.now()}.mp4`);

  await execAsync(ffmpegPath, [
    '-i', inputPath,
    '-vcodec', 'libx264',
    '-crf', '28',
    '-preset', 'fast',
    '-acodec', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ]);

  return outputPath;
}

export { PLATFORM_SPECS };
