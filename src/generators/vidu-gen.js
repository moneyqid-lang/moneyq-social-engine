// moneyq-social-engine/src/generators/vidu-gen.js
// AI Video Generator using Vidu API (Off-Peak Mode — 0 credits)
//
// Cascade: Vidu → Remotion → FFmpeg
// Vidu Off-Peak: free, no credits, longer processing, daily reset
//
// API Docs: https://platform.vidu.com/docs

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../utils/config.js';

const OUTPUT_DIR = join(process.cwd(), 'output', 'videos');
const POLL_INTERVAL_MS = 15_000; // 15s between polls (off-peak is slower)
const MAX_POLL_ATTEMPTS = 80; // 20 minutes max wait

// ---------------------------------------------------------------------------
// Prompt templates — cinematic descriptions for financial content
// ---------------------------------------------------------------------------

const PILLAR_PROMPTS = {
  tips_hemat: (hook) =>
    `Cinematic close-up of Indonesian Rupiah bills being carefully arranged on a warm wooden table, golden hour lighting streaming through a window. Camera slowly pulls back to reveal a cozy modern Indonesian cafe. Professional color grading, shallow depth of field. Mood: thoughtful, aspirational. 9:16 vertical format.`,

  fakta_finansial: (hook) =>
    `Dynamic motion graphics: dark navy background with glowing green financial charts, percentage numbers, and growth arrows floating in 3D space. Smooth camera dolly through data visualizations. Modern fintech aesthetic with subtle particle effects. Professional, data-driven mood. 9:16 vertical format.`,

  challenge: (hook) =>
    `Energetic lifestyle montage: determined young Indonesian professional checking their smartphone savings app, then confidently putting coins into a glass jar. Warm indoor lighting, golden hour tones. Smooth tracking shot. Motivational, upbeat atmosphere. 9:16 vertical format.`,

  mentor_wise: (hook) =>
    `Professional portrait: confident Indonesian business person in smart casual attire, standing by a floor-to-ceiling window with Jakarta cityscape background. Soft natural lighting, beautiful bokeh. Slow push-in camera move. Authoritative yet approachable. 9:16 vertical format.`,

  feature_deep_dive: (hook) =>
    `Sleek product showcase: modern smartphone displaying a green-accented fintech app interface. Camera orbits smoothly around the device against a clean minimal gradient background. Tech-forward, trustworthy atmosphere. Premium product aesthetic. 9:16 vertical format.`,
};

const DEFAULT_PROMPT = () =>
  `Cinematic financial lifestyle: modern Indonesian setting with warm natural lighting, subtle money and technology elements. Professional teal-and-orange color grading. Smooth dolly camera movement. Aspirational, premium mood. 9:16 vertical format.`;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate an AI video using Vidu API (Off-Peak Mode)
 *
 * @param {Object}  copy  — { hook, body, cta, hashtags } from copy-writer
 * @param {Object}  topic — { pillar, topic, angle } from topic-selector
 * @returns {Promise<string>} Absolute path to the downloaded MP4 file
 * @throws {Error} If Vidu API fails (caller should fallback to next provider)
 */
export async function generateViduVideo(copy, topic) {
  const { viduApiKey, viduBaseUrl } = getViduConfig();

  if (!viduApiKey) {
    throw new Error('VIDU_API_KEY not configured');
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  // 1. Build cinematic prompt
  const pillar = topic?.pillar || 'tips_hemat';
  const promptFn = PILLAR_PROMPTS[pillar] || DEFAULT_PROMPT;
  const prompt = promptFn(copy.hook);

  console.log(`  🎬 Vidu prompt: ${prompt.slice(0, 80)}...`);

  // 2. Submit text-to-video task (off-peak mode)
  const taskId = await submitTask(viduApiKey, viduBaseUrl, prompt);

  if (!taskId) {
    throw new Error('Vidu: no taskId returned — possibly rate limited or off-peak unavailable');
  }

  console.log(`  📤 Vidu task submitted: ${taskId}`);

  // 3. Poll for completion (off-peak is slower)
  const videoUrl = await pollForResult(viduApiKey, viduBaseUrl, taskId);

  // 4. Download
  const pillarSlug = (pillar || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = Date.now();
  const outputPath = join(OUTPUT_DIR, `vidu-${pillarSlug}-${timestamp}.mp4`);

  await downloadFile(videoUrl, outputPath);
  console.log(`  💾 Vidu video saved: ${outputPath}`);

  return outputPath;
}

// ---------------------------------------------------------------------------
// Get Vidu config from env
// ---------------------------------------------------------------------------

function getViduConfig() {
  return {
    viduApiKey: process.env.VIDU_API_KEY || null,
    viduBaseUrl: process.env.VIDU_API_BASE_URL || 'https://api.vidu.com',
  };
}

// ---------------------------------------------------------------------------
// Submit video generation task
// ---------------------------------------------------------------------------

async function submitTask(apiKey, baseUrl, prompt) {
  try {
    const res = await fetch(`${baseUrl}/v1/videos/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'vidu2',
        prompt,
        duration: 8, // Vidu default ~4-8s clips
        aspect_ratio: '9:16',
        // off_peak: true, // Uncomment if API supports this flag
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const code = err?.error?.code || err?.code || res.status;
      const msg = err?.error?.message || err?.message || res.statusText;

      // Specific error handling for cascade
      if (res.status === 429) {
        throw new Error(`Vidu rate limited: ${msg}`);
      }
      if (res.status === 402) {
        throw new Error(`Vidu insufficient credits: ${msg}`);
      }
      if (res.status === 503) {
        throw new Error(`Vidu service unavailable (peak hours?): ${msg}`);
      }
      throw new Error(`Vidu API error ${code}: ${msg}`);
    }

    const data = await res.json();
    return data.task_id || data.taskId || data.id;
  } catch (err) {
    if (err.message.startsWith('Vidu')) throw err;
    throw new Error(`Vidu network error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Poll for task completion
// ---------------------------------------------------------------------------

async function pollForResult(apiKey, baseUrl, taskId) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${baseUrl}/v1/videos/generations/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Vidu task not found: ${taskId}`);
      }
      console.log(`  ⚠️ Vidu poll ${attempt + 1}: HTTP ${res.status}`);
      continue;
    }

    const data = await res.json();
    const status = data.status || data.state;

    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const url = data.video_url || data.result?.video_url || data.data?.video_url
        || data.output?.video_url || data.results?.[0]?.url || data.results?.[0];
      if (url) return url;
      throw new Error('Vidu completed but no video URL found');
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(`Vidu task failed: ${data.error || data.message || 'unknown'}`);
    }

    const elapsed = Math.round((attempt + 1) * (POLL_INTERVAL_MS / 1000));
    if (attempt % 4 === 0) {
      console.log(`  ⏳ Vidu generating... (${elapsed}s, status: ${status})`);
    }
  }

  throw new Error('Vidu task timed out after 20 minutes');
}

// ---------------------------------------------------------------------------
// Download file
// ---------------------------------------------------------------------------

async function downloadFile(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download Vidu video: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, buffer);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
