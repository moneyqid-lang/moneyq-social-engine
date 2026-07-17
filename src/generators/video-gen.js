// moneyq-social-engine/src/generators/video-gen.js
// Task 15: Video Generator — TTS voiceover + Pexels stock footage + FFmpeg compositing
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { accessSync } from 'node:fs';
import { config } from '../utils/config.js';
import ffmpegPath from 'ffmpeg-static';

const execAsync2 = promisify(exec);

const execAsync = promisify(execFile);
const OUTPUT_DIR = join(process.cwd(), 'output', 'videos');

// Known font paths for drawtext filter (macOS first, then Linux fallback)
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];

function findFontFile() {
  for (const fp of FONT_CANDIDATES) {
    try {
      accessSync(fp);
      return fp;
    } catch {
      // continue searching
    }
  }
  return null;
}

const FONT_FILE = findFontFile();

/**
 * Generate a short-form video for TikTok / YouTube Shorts.
 *
 * Pipeline:
 *   1. Edge TTS — generates natural Indonesian voice-over (graceful fallback: silent)
 *   2. Pexels — searches portrait stock footage matching the topic pillar
 *   3. FFmpeg — composites background + drawtext + audio into final MP4
 *
 * @param {Object}  copy        — { hook, body, cta, hashtags } from copy-writer
 * @param {Object}  topic       — { pillar, topic, angle } from topic-selector
 * @param {string}  [type=daily] — 'daily' (15-30 s) or 'hero' (30-60 s)
 * @returns {Promise<string>}    Absolute path to the generated MP4 file
 */
export async function generateVideo(copy, topic, type = 'daily') {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const isHero = type === 'hero';
  const timestamp = Date.now();
  const pillar = (topic?.pillar || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');

  // 1. Generate voice-over with Edge TTS (Indonesian female voice)
  const audioPath = await generateVoiceOver(copy.hook, pillar, timestamp);

  // 2. Get background stock footage from Pexels
  const footagePath = await getBackgroundFootage(topic);

  // 3. Calculate video duration based on content length
  const duration = estimateDuration(copy.hook, copy.body, isHero);

  // 4. Render final video with FFmpeg (background + text + audio)
  const finalPath = join(OUTPUT_DIR, `final-${pillar}-${timestamp}.mp4`);
  await renderVideo(copy.hook, audioPath, footagePath, duration, finalPath);

  console.log(`  Video rendered: ${finalPath}`);
  return finalPath;
}

// ---------------------------------------------------------------------------
// Duration estimation
// ---------------------------------------------------------------------------

function estimateDuration(hook = '', body = '', isHero) {
  const totalText = hook.length + body.length;
  let duration = 15;
  if (totalText > 200) duration = 20;
  if (totalText > 400) duration = 25;
  if (totalText > 600) duration = 30;
  if (isHero) duration = Math.min(duration * 2, 60);
  return duration;
}

// ---------------------------------------------------------------------------
// Step 1 — Edge TTS voice-over
// ---------------------------------------------------------------------------

async function generateVoiceOver(text, pillar, timestamp) {
  if (!text) {
    console.log('  No hook text provided, skipping voice-over');
    return null;
  }

  const audioPath = join(OUTPUT_DIR, `voice-${pillar}-${timestamp}.aiff`);

  // Try Edge TTS first (if available)
  try {
    const { ttsSave } = await import('edge-tts/out/index.js');
    const mp3Path = audioPath.replace('.aiff', '.mp3');
    await ttsSave(text, mp3Path, { voice: 'id-ID-GadisNeural' });
    console.log(`  Voice-over generated (Edge TTS): ${mp3Path}`);
    return mp3Path;
  } catch {
    // Edge TTS not available, try macOS TTS
  }

  // Fallback: macOS built-in TTS
  try {
    // Use macOS `say` command to generate AIFF, then convert to MP3 with ffmpeg
    await execAsync2(`say -v "Samantha" -o "${audioPath}" "${text.replace(/"/g, '\\"')}"`);
    const mp3Path = audioPath.replace('.aiff', '.mp3');
    await execAsync2(`"${ffmpegPath}" -i "${audioPath}" -codec:a libmp3lame -b:a 128k -y "${mp3Path}"`);
    console.log(`  Voice-over generated (macOS TTS): ${mp3Path}`);
    return mp3Path;
  } catch (err) {
    console.log(`  TTS failed: ${err.message}, video will be silent`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Pexels stock footage
// ---------------------------------------------------------------------------

async function getBackgroundFootage(topic) {
  if (!config.pexels?.apiKey) {
    console.log('  Pexels API key not configured, skipping stock footage');
    return null;
  }

  try {
    const pillar = topic?.pillar || 'general';
    const query = encodeURIComponent(
      pillar === 'tips_hemat'    ? 'saving money' :
      pillar === 'fakta_finansial' ? 'finance' :
      pillar === 'challenge'     ? 'lifestyle goals' :
      'business money'
    );

    const res = await fetch(
      `https://api.pexels.com/videos/search?query=${query}&per_page=1&orientation=portrait`,
      { headers: { Authorization: config.pexels.apiKey } },
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.videos?.length) return null;

    // Pick the highest-quality HD file that fits within 1080p
    const videoFile = data.videos[0].video_files
      .filter(f => f.width && f.width <= 1080)
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0];

    if (!videoFile?.link) return null;

    const videoRes = await fetch(videoFile.link);
    if (!videoRes.ok) return null;

    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const path = join(OUTPUT_DIR, `footage-${Date.now()}.mp4`);
    await writeFile(path, buffer);
    console.log(`  Background footage downloaded: ${path}`);
    return path;
  } catch (err) {
    console.log(`  Pexels fallback: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 3 — FFmpeg render (background + drawtext + audio)
// ---------------------------------------------------------------------------

async function renderVideo(hook, audioPath, footagePath, duration, outputPath) {
  // Write hook text to a temporary file for drawtext (avoids shell-escaping hell)
  const textFile = join(OUTPUT_DIR, `drawtext-${Date.now()}.txt`);
  await writeFile(textFile, hook);

  const inputs = [];
  const filters = [];

  // --- Background ---
  if (footagePath) {
    // Use Pexels footage as background, scale to portrait 1080×1920, darken
    inputs.push('-i', footagePath);
    filters.push(
      `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,`
        + `pad=1080:1920:(1080-iw)/2:(1920-ih)/2:color=#0f172a`
        + `,drawbox=w=iw:h=ih:color=black@0.45:t=fill[bg]`,
    );
  } else {
    // No footage — use a solid dark gradient background created in-filter
    filters.push(`color=c=#0f172a:s=1080x1920:d=${duration}[bg]`);
  }

  // --- Text overlays (hook + watermark) ---
  const fontArg = FONT_FILE ? `:fontfile='${FONT_FILE}'` : '';

  filters.push(
    `[bg]drawtext=textfile='${textFile}'${fontArg}`
      + `:fontcolor=white:fontsize=48:x=60:y=(h-text_h)/3`
      + `:line_spacing=12[hook_overlay]`,
    `[hook_overlay]drawtext=text='moneyq.id'${fontArg}`
      + `:fontcolor=#22c55e:fontsize=32:x=60:y=h-120[vid]`,
  );

  // --- Audio input (if available) ---
  if (audioPath) {
    inputs.push('-i', audioPath);
  }

  // --- Build ffmpeg arguments ---
  const args = [
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[vid]',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
  ];

  // --- Audio mapping (if available) ---
  if (audioPath) {
    const audioInputIndex = (inputs.length / 2) - 1; // last input index
    args.push('-map', `${audioInputIndex}:a:0`);
    args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  }

  args.push('-movflags', '+faststart', '-y', outputPath);

  try {
    await execAsync(ffmpegPath, args);
  } catch (err) {
    console.log(`  FFmpeg render failed: ${err.message}`);
    // Last-resort fallback: try without text overlays (just in case font is the issue)
    if (!FONT_FILE) {
      console.log('  Retrying without text overlays (no font available)...');
      await renderRawBackground(audioPath, duration, outputPath);
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Last-resort fallback — solid background with audio only (no text)
// ---------------------------------------------------------------------------

async function renderRawBackground(audioPath, duration, outputPath) {
  const args = [
    '-f', 'lavfi',
    '-i', `color=c=#0f172a:s=1080x1920:d=${duration}`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
  ];

  if (audioPath) {
    args.push('-i', audioPath);
    args.push('-map', '1:a:0');
    args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  }

  args.push('-movflags', '+faststart', '-y', outputPath);

  await execAsync(ffmpegPath, args);
}
