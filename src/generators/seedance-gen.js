// moneyq-social-engine/src/generators/seedance-gen.js
// AI Video Generator using Seedance 2.0 API
// Generates cinematic short-form videos for TikTok / YouTube Shorts
//
// Config: Seedance 2.0 Mini, 480p, 12s, 9:16 portrait
// Budget: 36 credits/video × 2 videos/day = 72 credits (free tier: 100/day)

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../utils/config.js';

const OUTPUT_DIR = join(process.cwd(), 'output', 'videos');
const POLL_INTERVAL_MS = 10_000; // 10 seconds between polls
const MAX_POLL_ATTEMPTS = 60; // 10 minutes max wait

// ---------------------------------------------------------------------------
// Prompt templates — map content pillars to cinematic video descriptions
// ---------------------------------------------------------------------------

const PILLAR_PROMPTS = {
  tips_hemat: (hook, topic) =>
    `Cinematic close-up of hands counting Indonesian Rupiah bills on a wooden table, warm golden lighting, shallow depth of field. Camera slowly zooms out revealing a modern Indonesian coffee shop background. Text overlay appears: "${hook}". Moody financial atmosphere, professional color grading, 9:16 vertical format.`,

  fakta_finansial: (hook, topic) =>
    `Dynamic animated infographic style: dark navy background with glowing green (#22c55e) financial charts and numbers floating in 3D space. Camera slowly pans through data visualizations showing growth arrows and percentage figures. Modern, tech-forward aesthetic with subtle particle effects. Text: "${hook}". Cinematic lighting, 9:16 vertical.`,

  challenge: (hook, topic) =>
    `Energetic montage: person looking determined at their phone screen showing a savings app, then cut to them putting coins into a glass jar, warm indoor lighting. Camera follows the motion smoothly. Upbeat, motivational atmosphere with golden hour tones. Text overlay: "${hook}". Modern lifestyle aesthetic, 9:16 vertical.`,

  mentor_wise: (hook, topic) =>
    `Professional portrait shot: confident Indonesian professional in smart casual outfit, standing by a window with city skyline background. Soft natural lighting, bokeh effect. Camera slowly pushes in. Authoritative yet approachable mood. Text: "${hook}". Corporate lifestyle aesthetic, 9:16 vertical.`,

  feature_deep_dive: (hook, topic) =>
    `Sleek product showcase: smartphone screen displaying a modern fintech app interface with green accent colors. Camera orbits smoothly around the device. Clean, minimal background with subtle gradient. Tech-forward, trustworthy atmosphere. Text overlay: "${hook}". Premium product visualization, 9:16 vertical.`,
};

// Fallback prompt for unknown pillars
const DEFAULT_PROMPT = (hook, topic) =>
  `Cinematic financial lifestyle scene: modern Indonesian setting with warm lighting, money and technology elements subtly present. Professional color grading with teal and orange tones. Smooth camera movement. Text overlay: "${hook}". Aspirational mood, 9:16 vertical format.`;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate an AI video using Seedance 2.0 API
 *
 * @param {Object}  copy  — { hook, body, cta, hashtags } from copy-writer
 * @param {Object}  topic — { pillar, topic, angle } from topic-selector
 * @param {string}  [type='daily'] — 'daily' or 'hero'
 * @returns {Promise<string>} Absolute path to the downloaded MP4 file
 */
export async function generateSeedanceVideo(copy, topic, type = 'daily') {
  const { apiKey, baseUrl, model, resolution, duration, aspectRatio } = config.seedance;

  if (!apiKey) {
    throw new Error('SEEDANCE_API_KEY not configured');
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  // 1. Build cinematic prompt from content
  const pillar = topic?.pillar || 'tips_hemat';
  const promptFn = PILLAR_PROMPTS[pillar] || DEFAULT_PROMPT;
  const prompt = promptFn(copy.hook, topic?.topic || '');

  console.log(`  🎬 Seedance prompt: ${prompt.slice(0, 80)}...`);

  // 2. Submit video generation task
  const taskId = await submitTask(apiKey, baseUrl, {
    model,
    prompt,
    duration,
    resolution,
    aspectRatio,
  });

  console.log(`  📤 Task submitted: ${taskId}`);

  // 3. Poll for completion
  const result = await pollTask(apiKey, baseUrl, taskId);

  if (!result?.data?.results?.length) {
    throw new Error('Seedance task completed but no video URL returned');
  }

  const videoUrl = result.data.results[0];
  console.log(`  ✅ Video generated: ${videoUrl}`);

  // 4. Download video to local file
  const pillarSlug = (pillar || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = Date.now();
  const outputPath = join(OUTPUT_DIR, `seedance-${pillarSlug}-${timestamp}.mp4`);

  await downloadFile(videoUrl, outputPath);
  console.log(`  💾 Downloaded: ${outputPath}`);

  return outputPath;
}

// ---------------------------------------------------------------------------
// Submit task to Seedance API
// ---------------------------------------------------------------------------

async function submitTask(apiKey, baseUrl, { model, prompt, duration, resolution, aspectRatio }) {
  const res = await fetch(`${baseUrl}/v1/videos/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: {
        prompt,
        generation_type: 'text-to-video',
        duration,
        aspect_ratio: aspectRatio,
        resolution,
        generate_audio: false, // We'll add TTS separately
        watermark: false,
        web_search: false,
        return_last_frame: false,
        seed: -1,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code = err?.error?.code || res.status;
    const msg = err?.error?.message || res.statusText;

    if (code === 'insufficient_credits') {
      throw new Error(`Seedance: insufficient credits (need ${err.error.required}, have ${err.error.available})`);
    }
    throw new Error(`Seedance API error: ${code} — ${msg}`);
  }

  const data = await res.json();
  return data.taskId;
}

// ---------------------------------------------------------------------------
// Poll task status until completed or failed
// ---------------------------------------------------------------------------

async function pollTask(apiKey, baseUrl, taskId) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${baseUrl}/v1/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      console.log(`  ⚠️ Poll attempt ${attempt + 1}: HTTP ${res.status}`);
      continue;
    }

    const data = await res.json();

    if (data.status === 'completed') {
      return data;
    }

    if (data.status === 'failed') {
      throw new Error(`Seedance task failed: ${data.failed_reason || 'unknown'}`);
    }

    // Still processing — log progress
    const elapsed = (attempt + 1) * (POLL_INTERVAL_MS / 1000);
    if (attempt % 3 === 0) {
      console.log(`  ⏳ Generating... (${elapsed}s, status: ${data.status})`);
    }
  }

  throw new Error('Seedance task timed out after 10 minutes');
}

// ---------------------------------------------------------------------------
// Download video file from URL
// ---------------------------------------------------------------------------

async function downloadFile(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download video: ${res.status} ${res.statusText}`);
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
