// test-full-pipeline.js — Test full video generation with TTS + merge
// Usage: node test-full-pipeline.js

import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const REMOTION_DIR = join(import.meta.dirname, '..', 'moneyq-video-templates');
const RENDER_CLI = join(REMOTION_DIR, 'src', 'render-cli.js');
const TEMP_DIR = join(import.meta.dirname, 'output', 'temp');

const VOICE = 'id-ID-ArdiNeural';
const VOICE_SPEED = 1.0;
const VIDEO_DURATION = 18; // seconds

async function testFullPipeline() {
  await mkdir(TEMP_DIR, { recursive: true });

  // Sample content
  const hook = 'Dana darurat lo udah siap?';
  const tips = [
    'Delapan puluh tujuh persen orang Indonesia tidak punya dana darurat',
    'Mulai dari sepuluh ribu rupiah per hari',
    'Gunakan fitur Nabung Otomatis MoneyQ',
  ];
  const cta = 'Download MoneyQ sekarang, gratis.';

  // Build VO script
  const voScript = [hook, ...tips, cta].join('. ') + '.';
  console.log('🎙️ VO Script:', voScript);

  // 1. Generate TTS
  console.log('\n🔊 Generating TTS...');
  const mp3Path = join(TEMP_DIR, `test-vo-${Date.now()}.mp3`);
  await generateTTS(voScript, mp3Path);
  console.log('✅ TTS generated:', mp3Path);

  // 2. Render Remotion template
  console.log('\n🎨 Rendering KineticTypography...');
  const videoPath = await renderTemplate(hook, tips, cta);
  console.log('✅ Video rendered:', videoPath);

  // 3. Merge video + TTS
  console.log('\n🎬 Merging video + TTS...');
  const finalPath = videoPath.replace('.mp4', '-with-vo.mp4');
  await mergeVideoAudio(videoPath, mp3Path, VIDEO_DURATION, finalPath);
  console.log('✅ Final video:', finalPath);

  // Cleanup
  try { await unlink(mp3Path); } catch {}
  try { await unlink(videoPath); } catch {}

  console.log('\n🎉 Done! Video with VO:', finalPath);
  return finalPath;
}

async function generateTTS(text, outputPath) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const result = tts.toStream(text);
  const chunks = [];
  for await (const chunk of result.audioStream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  await writeFile(outputPath, buffer);
  tts.close();

  console.log('  TTS size:', (buffer.length / 1024).toFixed(1), 'KB');
}

async function renderTemplate(hook, tips, cta) {
  const props = {
    hook,
    tips,
    voText: [hook, ...tips, cta].join(' '),
    pillar: 'fakta_finansial',
    segments: [
      { text: hook, startSec: 0, endSec: 3 },
      { text: tips[0], startSec: 3, endSec: 7 },
      { text: tips[1], startSec: 7, endSec: 11 },
      { text: tips[2], startSec: 11, endSec: 15 },
      { text: cta, startSec: 15, endSec: 18 },
    ],
  };

  const { stdout } = await execFileAsync('node', [RENDER_CLI, 'KineticTypography'], {
    cwd: REMOTION_DIR,
    timeout: 180_000,
    env: { ...process.env, REMOTION_PROPS: JSON.stringify(props) },
  });

  const lines = stdout.trim().split('\n');
  return lines[lines.length - 1].trim();
}

async function mergeVideoAudio(videoPath, audioPath, duration, outputPath) {
  const voSpeed = VOICE_SPEED !== 1.0 ? `[1:a]atempo=${VOICE_SPEED}[vo];` : '';
  const voLabel = VOICE_SPEED !== 1.0 ? 'vo' : '1:a';
  const voFilter = `${voSpeed}[0:a]volume=0.45[bgm];[${voLabel}]volume=1.3[vo_adj];[bgm][vo_adj]amix=inputs=2:duration=shortest:dropout_transition=0[out]`;

  const args = [
    '-i', videoPath,
    '-i', audioPath,
    '-filter_complex', voFilter,
    '-map', '0:v:0',
    '-map', '[out]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-t', String(duration),
    '-movflags', '+faststart',
    '-y', outputPath,
  ];

  await execFileAsync(ffmpegPath, args);
}

testFullPipeline().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
