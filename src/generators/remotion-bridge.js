// moneyq-social-engine/src/generators/remotion-bridge.js
// Bridge to Remotion video templates in moneyq-video-templates/
//
// Pipeline:
//   1. Render Remotion template (visual)
//   2. Generate Indonesian TTS voiceover (full duration)
//   3. Merge video + audio with FFmpeg
//
// Wajib: VO Bahasa Indonesia dari awal sampai akhir video.

import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { access, unlink, mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { fetchPexelsMedia } from './pexels-fetcher.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Path to the Remotion project
const REMOTION_DIR = join(process.cwd(), '..', 'moneyq-video-templates');
const RENDER_CLI = join(REMOTION_DIR, 'src', 'render-cli.js');
const TEMP_DIR = join(process.cwd(), 'output', 'temp');

// Edge TTS Neural voices — jauh lebih natural dari macOS TTS
const VOICE = 'id-ID-ArdiNeural';  // Male natural voice (lebih natural dari GadisNeural)
// Alternative: 'id-ID-GadisNeural' (Female)
const VOICE_SPEED = 1.0;  // 1.0x speed — natural, tidak dipaksakan

// ---------------------------------------------------------------------------
// Text cleaning — hapus emoji, raw format, dan karakter aneh
// ---------------------------------------------------------------------------

function cleanText(text) {
  if (!text) return '';
  return String(text)
    // Hapus emoji
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    // Hapus format raw/JSON
    .replace(/\{[^}]*\}/g, '')               // {json blocks}
    .replace(/\[[^\]]*\]/g, '')              // [brackets]
    .replace(/```[\s\S]*?```/g, '')          // code blocks
    .replace(/"[^"]*"\s*:\s*"[^"]*"/g, '')   // "key":"value" pairs
    .replace(/"\d+:\d+"\s*:/g, '')           // "3:40": timestamps
    .replace(/:\s*"[^"]*"/g, '')             // : "value"
    // Hapus karakter aneh
    .replace(/[=<>]/g, '')                    // = < >
    .replace(/\.\.\./g, ',')                  // ... → ,
    .replace(/\.{2,}/g, '.')                  // multiple dots
    .replace(/"/g, '')                        // hapus semua quotes
    // Bersihkan spasi
    .replace(/\s+/g, ' ')
    .replace(/^\s*[,:]\s*/, '')               // leading comma/colon
    .replace(/\s*[,:]\s*$/, '')               // trailing comma/colon
    .trim();
}

// ---------------------------------------------------------------------------
// Pillar → Template mapping
// ---------------------------------------------------------------------------

const PILLAR_TEMPLATES = {
  tips_hemat:        'KineticTypography',
  fakta_finansial:   'KineticTypography',
  challenge:         'KineticTypography',
  mentor_wise:       'KineticTypography',
  feature_deep_dive: 'KineticTypography',
  edukasi_siklus:    'KineticTypography',
  before_after:      'KineticTypography',
  behind_product:    'KineticTypography',
};

// Fallback templates — CinematicEngine first, then DynamicVideo
const FALLBACK_TEMPLATES = {
  tips_hemat:        'CinematicEngine',
  fakta_finansial:   'CinematicEngine',
  challenge:         'CinematicEngine',
  mentor_wise:       'CinematicEngine',
  feature_deep_dive: 'CinematicEngine',
  edukasi_siklus:    'CinematicEngine',
  before_after:      'CinematicEngine',
  behind_product:    'CinematicEngine',
};

// Tier 3: Pro templates (with transitions, Lottie, AudioSystem, Subtitles)
const PRO_TEMPLATES = {
  tips_hemat:        'DailyTipPro',
  fakta_finansial:   'FactBombPro',
  challenge:         'ChallengePro',
  mentor_wise:       'MentorWisePro',
  feature_deep_dive: 'FeatureDeepDivePro',
  edukasi_siklus:    'DailyTipPro',
  before_after:      'DailyTipPro',
  behind_product:    'DailyTipPro',
};

// Last resort if Pro templates also fail (basic, no transitions)
const LAST_RESORT_TEMPLATES = {
  tips_hemat:        'DailyTip',
  fakta_finansial:   'FactBomb',
  challenge:         'Challenge',
  mentor_wise:       'MentorWise',
  feature_deep_dive: 'FeatureDeepDive',
};

// Visual style per pillar (for DynamicVideo)
const PILLAR_STYLES = {
  tips_hemat:        'energetic',
  fakta_finansial:   'cinematic',
  challenge:         'energetic',
  mentor_wise:       'minimal',
  feature_deep_dive: 'cinematic',
  edukasi_siklus:    'minimal',
  before_after:      'energetic',
  behind_product:    'minimal',
};

// CinematicEngine environment style per pillar
const PILLAR_ENV_STYLE = {
  tips_hemat:        'dark',
  fakta_finansial:   'neon',
  challenge:         'dark',
  mentor_wise:       'warm',
  feature_deep_dive: 'dark',
  edukasi_siklus:    'dark',
  before_after:      'dark',
  behind_product:    'warm',
};

// CinematicEngine floating object style per pillar
const PILLAR_OBJECT_STYLE = {
  tips_hemat:        'coins',
  fakta_finansial:   'shapes',
  challenge:         'coins',
  mentor_wise:       'shapes',
  feature_deep_dive: 'coins',
  edukasi_siklus:    'shapes',
  before_after:      'coins',
  behind_product:    'shapes',
};

// Template durations (seconds) — must match Root.jsx
const TEMPLATE_DURATIONS = {
  KineticTypography: 18,
  CinematicEngine: 15,
  DynamicVideo: 15,
  DailyTip: 15,
  DailyTipPro: 15,
  FactBomb: 12,
  FactBombPro: 15,
  Challenge: 15,
  ChallengePro: 15,
  MentorWise: 16,
  MentorWisePro: 16,
  FeatureDeepDive: 15,
  FeatureDeepDivePro: 15,
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate video with Indonesian voiceover using Remotion templates
 *
 * @param {Object}  copy  — { hook, body, cta, hashtags }
 * @param {Object}  topic — { pillar, topic, angle }
 * @param {string}  [type='daily'] — 'daily' or 'hero'
 * @returns {Promise<string>} Absolute path to final MP4 with audio
 */
export async function generateRemotionVideo(copy, topic, type = 'daily') {
  await verifyRemotionSetup();
  await mkdir(TEMP_DIR, { recursive: true });

  const pillar = topic?.pillar || 'tips_hemat';
  const videoDuration = TEMPLATE_DURATIONS.KineticTypography || 10;

  // 1. Build segmented voiceover script with timing
  const { fullScript, segments } = buildSegmentedScript(copy, topic, videoDuration);
  console.log(`  🎙️ VO Script (${fullScript.length} chars): ${fullScript.slice(0, 80)}...`);
  console.log(`  ⏱️ Segments: ${segments.map(s => `${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s`).join(', ')}`);

  // 2. Generate TTS audio
  console.log(`  🎙️ Generating TTS with ${VOICE}...`);
  const audioPath = await generateTTS(fullScript, 'KineticTypography');
  console.log(`  🔊 TTS generated: ${audioPath}`);

  // 3. Cascade: KineticTypography → CinematicEngine → Pro → DynamicVideo → Basic
  let templateName;
  let props;
  let videoPath;

  // Attach segments to copy for extractProps
  copy._segments = segments;

  // Tier 1: KineticTypography (text-based, Lottie, no Pexels needed)
  try {
    templateName = 'KineticTypography';
    props = extractProps(copy, topic, templateName);
    console.log(`  🎨 [Tier 1] Rendering KineticTypography (${pillar})`);
    videoPath = await renderTemplate(templateName, props);
  } catch (err) {
    console.log(`  ⚠️ KineticTypography failed: ${err.message}`);

    // Tier 2: CinematicEngine (3D, no Pexels needed)
    try {
      templateName = 'CinematicEngine';
      props = extractProps(copy, topic, templateName);
      console.log(`  🎨 [Tier 2] Rendering CinematicEngine (${pillar})`);
      videoPath = await renderTemplate(templateName, props);
    } catch (err2) {
      console.log(`  ⚠️ CinematicEngine failed: ${err2.message}`);

      // Tier 3: Pro templates (with transitions, Lottie, AudioSystem)
      try {
        templateName = PRO_TEMPLATES[pillar] || 'DailyTipPro';
        props = extractProps(copy, topic, templateName);
        console.log(`  🎨 [Tier 3] Rendering Pro template: ${templateName} (${pillar})`);
        videoPath = await renderTemplate(templateName, props);
      } catch (err3) {
        console.log(`  ⚠️ Pro template ${templateName} failed: ${err3.message}`);

        // Tier 4: DynamicVideo (Pexels footage + overlays)
        try {
          console.log(`  🔍 [Tier 4] Fetching Pexels media for ${pillar}...`);
          const { videoPaths } = await fetchPexelsMedia(topic, { videoCount: 1 });
          const videoUrl = videoPaths[0] || '';

          templateName = 'DynamicVideo';
          props = extractProps(copy, topic, templateName, videoUrl);
          console.log(`  🎨 Rendering DynamicVideo${videoUrl ? ' (with Pexels footage)' : ' (no footage)'}`);
          videoPath = await renderTemplate(templateName, props);
        } catch (err4) {
          console.log(`  ⚠️ DynamicVideo failed: ${err4.message}`);

          // Tier 5: Basic templates (last resort, no transitions)
          templateName = LAST_RESORT_TEMPLATES[pillar] || 'DailyTip';
          props = extractProps(copy, topic, templateName);
          console.log(`  🎨 [Tier 5] Rendering fallback: ${templateName}`);
          videoPath = await renderTemplate(templateName, props);
        }
      }
    }
  }

  // 4. Merge video + audio (trim audio to video duration)
  console.log(`  🎬 Merging video + VO audio...`);
  console.log(`    Video: ${videoPath}`);
  console.log(`    Audio: ${audioPath}`);
  console.log(`    Duration: ${TEMPLATE_DURATIONS[templateName] || videoDuration}s`);
  const finalPath = videoPath.replace('.mp4', '-final.mp4');
  const actualDuration = TEMPLATE_DURATIONS[templateName] || videoDuration;
  await mergeVideoAudio(videoPath, audioPath, actualDuration, finalPath);
  console.log(`  ✅ Final video with VO+BGM+SFX: ${finalPath}`);

  // 5. Cleanup temp files
  try { await unlink(audioPath); } catch {}
  try { await unlink(videoPath); } catch {}

  return finalPath;
}

// ---------------------------------------------------------------------------
// Build segmented voiceover script with timing
// Returns { fullScript, segments: [{text, startSec, endSec}] }
// ---------------------------------------------------------------------------

function buildSegmentedScript(copy, topic, durationSeconds) {
  // Estimate ~150 words per minute for Indonesian TTS
  const effectiveWPM = VOICE_SPEED > 1 ? 150 * VOICE_SPEED : 150;
  const targetWords = Math.ceil((durationSeconds / 60) * effectiveWPM);

  // Clean hook, tips, cta
  const hook = cleanText(copy.hook) || 'Tips keuangan untuk kamu';
  const bodyLines = (copy.body || '').split('\n').filter(l => l.trim());
  const tips = bodyLines.slice(0, 3).map(l => cleanText(l.replace(/^[\d\.\-\*\s]+/, '').trim()));
  const cta = cleanText(copy.cta) || 'Download MoneyQ sekarang, gratis.';

  // Build segments
  const segments = [];

  // Segment1: Hook
  segments.push({ text: hook, startSec:0, endSec:0 });

  // Segment2-4: Tips (from body, or use defaults)
  const tipTexts = [
    tips[0] || 'Mulai catat semua pengeluaran harianmu',
    tips[1] || 'Kurangi jajan di luar, masak sendiri di rumah',
    tips[2] || 'Gunakan fitur Nabung Otomatis MoneyQ',
  ];
  tipTexts.forEach(tip => {
    segments.push({ text: tip, startSec:0, endSec:0 });
  });

  // Segment5: CTA
  segments.push({ text: cta, startSec:0, endSec:0 });

  // Calculate timing based on word count
  let currentSec =0;
  segments.forEach(seg => {
    const wordCount = seg.text.split(/\s+/).length;
    // Each word takes about0.4 seconds at1.0x speed
    const duration = Math.max(1.5, wordCount *0.4);
    seg.startSec = currentSec;
    seg.endSec = currentSec + duration;
    currentSec = seg.endSec;
  });

  // Scale to fit durationSeconds
  const totalDuration = currentSec;
  const scale = durationSeconds / totalDuration;
  segments.forEach(seg => {
    seg.startSec = Math.round(seg.startSec * scale *10) /10;
    seg.endSec = Math.round(seg.endSec * scale *10) /10;
  });

  // Build full script
  const fullScript = segments.map(s => s.text).join('. ') + '.';

  return { fullScript, segments };
}

// Generate filler text to fill voiceover duration
function generateFillerText(topic, wordsNeeded) {
  const pillar = topic?.pillar || 'tips_hemat';

  const fillers = {
    tips_hemat: [
      'Ingat, menabung itu bukan tentang berapa banyak, tapi tentang konsistensi.',
      'Mulai dari yang kecil, yang penting rutin setiap hari.',
      'Dengan MoneyQ, kamu bisa atur nabung otomatis tanpa ribet.',
      'Yuk mulai hidup lebih hemat dari sekarang.',
    ],
    fakta_finansial: [
      'Fakta ini penting untuk diketahui semua orang.',
      'Jangan sampai kamu termasuk yang tidak siap secara finansial.',
      'Mulai edukasi diri tentang keuangan dari sekarang.',
      'MoneyQ hadir untuk membantu kamu lebih pintar mengelola uang.',
    ],
    challenge: [
      'Tantangan ini bisa mengubah kebiasaan finansialmu.',
      'Ajak teman-temanmu untuk ikut bersama.',
      'Siap untuk jadi lebih disiplin dalam mengelola keuangan?',
      'Download MoneyQ dan ikuti tantangannya sekarang.',
    ],
    mentor_wise: [
      'Belajar dari ahli adalah langkah cerdas untuk masa depan finansialmu.',
      'Jangan ragu untuk mulai, yang penting adalah langkah pertama.',
      'Dengan bimbingan yang tepat, kamu bisa mencapai tujuan keuanganmu.',
      'MoneyQ menyediakan panduan lengkap untuk perjalanan finansialmu.',
    ],
    feature_deep_dive: [
      'Fitur ini dirancang khusus untuk membantu kamu mencapai tujuan keuangan.',
      'Coba sekarang dan rasakan kemudahannya sendiri.',
      'Ribuan pengguna sudah merasakan manfaatnya.',
      'Download MoneyQ sekarang dan mulai perjalanan finansialmu.',
    ],
  };

  const pool = fillers[pillar] || fillers.tips_hemat;
  let result = '';
  let wordCount = 0;

  for (const sentence of pool) {
    if (wordCount >= wordsNeeded) break;
    result += sentence + ' ';
    wordCount += sentence.split(/\s+/).length;
  }

  return result.trim();
}

// ---------------------------------------------------------------------------
// Generate TTS audio with Edge TTS Neural (Indonesian)
// ---------------------------------------------------------------------------

async function generateTTS(text, templateName) {
  const timestamp = Date.now();
  const mp3Path = join(TEMP_DIR, `vo-${templateName}-${timestamp}.mp3`);

  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const result = tts.toStream(text);

    // Collect audio chunks
    const chunks = [];
    for await (const chunk of result.audioStream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    await writeFile(mp3Path, buffer);

    // Cleanup
    tts.close();

    return mp3Path;
  } catch (err) {
    // Fallback: macOS TTS (Damayanti)
    console.log(`  ⚠️ Edge TTS failed (${err.message}), trying macOS TTS...`);
    return await generateTTSFallback(text, templateName);
  }
}

// Fallback: macOS TTS (Damayanti)
async function generateTTSFallback(text, templateName) {
  const timestamp = Date.now();
  const aiffPath = join(TEMP_DIR, `vo-${templateName}-${timestamp}.aiff`);
  const mp3Path = join(TEMP_DIR, `vo-${templateName}-${timestamp}.mp3`);

  const escapedText = text.replace(/"/g, '\\"').replace(/'/g, "'\\''");

  try {
    await execAsync(`say -v "Damayanti" -o "${aiffPath}" "${escapedText}"`);
    await execFileAsync(ffmpegPath, [
      '-i', aiffPath,
      '-codec:a', 'libmp3lame', '-b:a', '128k',
      '-ar', '44100', '-ac', '1', '-y', mp3Path,
    ]);
    try { await unlink(aiffPath); } catch {}
    return mp3Path;
  } catch (err) {
    throw new Error(`All TTS methods failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Merge video + audio with FFmpeg
// ---------------------------------------------------------------------------

async function mergeVideoAudio(videoPath, audioPath, videoDuration, outputPath) {
  // Video already has BGM + SFX audio from Remotion
  // We need to MIX the VO on top of existing audio
  //
  // Filter graph:
  //   [0:a] = BGM+SFX from Remotion video
  //   [1:a] = VO (with speed adjustment)
  //   Mix: [0:a] volume 0.3 + [1:a] volume 1.0 → merged audio

  // Mix levels:
  //   Remotion audio (BGM + SFX) × 0.45 → BGM 45%
  //   VO: volume 1.3 → VO 130%
  const voSpeed = VOICE_SPEED !== 1.0 ? `[1:a]atempo=${VOICE_SPEED}[vo];` : '';
  const voLabel = VOICE_SPEED !== 1.0 ? 'vo' : '1:a';
  const voFilter = `${voSpeed}[0:a]volume=0.45[bgm];[${voLabel}]volume=1.3[vo_adj];[bgm][vo_adj]amix=inputs=2:duration=shortest:dropout_transition=0[out]`;

  const args = [
    '-i', videoPath,     // input 0: video with BGM+SFX
    '-i', audioPath,     // input 1: VO
    '-filter_complex', voFilter,
    '-map', '0:v:0',     // keep original video
    '-map', '[out]',     // mixed audio
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-t', String(videoDuration),
    '-movflags', '+faststart',
    '-y', outputPath,
  ];

  try {
    await execFileAsync(ffmpegPath, args);
  } catch (err) {
    throw new Error(`Video+audio merge failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Verify Remotion project is set up
// ---------------------------------------------------------------------------

async function verifyRemotionSetup() {
  try {
    await access(RENDER_CLI);
  } catch {
    throw new Error(`Remotion render-cli not found at ${RENDER_CLI}. Run: cd ${REMOTION_DIR} && npm install`);
  }

  try {
    await access(join(REMOTION_DIR, 'node_modules'));
  } catch {
    throw new Error(`Remotion node_modules not found. Run: cd ${REMOTION_DIR} && npm install`);
  }
}

// ---------------------------------------------------------------------------
// Build full VO text for subtitles — single continuous string
// ---------------------------------------------------------------------------

function buildVoiceoverText(copy, topic) {
  const parts = [];

  if (copy.hook) parts.push(copy.hook);

  if (copy.body) {
    const sentences = copy.body
      .split(/[.!?\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 5);
    parts.push(...sentences);
  }

  if (copy.cta) {
    parts.push(copy.cta);
  } else {
    parts.push('Download MoneyQ sekarang, gratis.');
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Extract template props from copy content
// ---------------------------------------------------------------------------

function extractProps(copy, topic, templateName, videoUrl = '') {
  const hook = copy.hook || 'Tips Keuangan';
  const bodyLines = (copy.body || '').split('\n').filter(l => l.trim());
  const tips = bodyLines.slice(0, 3).map(l => l.replace(/^[\d\.\-\*\s💡]+/, '').trim());
  const cta = copy.cta || 'Download MoneyQ sekarang, gratis.';

  // Build full VO text for subtitles
  const voText = buildVoiceoverText(copy, topic);
  const pillar = topic?.pillar || 'tips_hemat';
  const style = PILLAR_STYLES[pillar] || 'energetic';

  switch (templateName) {
    case 'KineticTypography':
      return {
        hook: cleanText(hook),
        tips: [
          cleanText(tips[0]) || 'Mulai catat pengeluaran',
          cleanText(tips[1]) || 'Kurangi jajan di luar',
          cleanText(tips[2]) || 'Gunakan MoneyQ',
        ],
        voText: cleanText(voText),
        pillar,
        segments: copy._segments || null, // timing segments from buildSegmentedScript
      };
    case 'CinematicEngine':
      return {
        hook: cleanText(hook),
        tips: [
          cleanText(tips[0]) || 'Mulai catat pengeluaran',
          cleanText(tips[1]) || 'Kurangi jajan di luar',
          cleanText(tips[2]) || 'Gunakan MoneyQ',
        ],
        cta: cleanText(cta) || 'Download Sekarang!',
        voText: cleanText(voText),
        pillar,
        envStyle: PILLAR_ENV_STYLE[pillar] || 'dark',
        objectStyle: PILLAR_OBJECT_STYLE[pillar] || 'coins',
        textAnimation: 'word-by-word',
      };
    case 'DynamicVideo':
      return {
        videoUrl,
        hook,
        tips: [
          tips[0] || 'Mulai menabung hari ini',
          tips[1] || 'Tetap konsisten setiap hari',
          tips[2] || 'Gunakan fitur otomatis',
        ],
        cta: cta || 'Download Sekarang!',
        voText,
        style,
      };
    case 'DailyTip':
      return {
        hook,
        tip1: tips[0] || 'Mulai menabung hari ini',
        tip2: tips[1] || 'Tetap konsisten setiap hari',
        tip3: tips[2] || 'Gunakan fitur otomatis',
        voText,
      };
    case 'DailyTipPro':
      return {
        hook: cleanText(hook),
        tip1: cleanText(tips[0]) || 'Mulai menabung hari ini',
        tip2: cleanText(tips[1]) || 'Tetap konsisten setiap hari',
        tip3: cleanText(tips[2]) || 'Gunakan fitur otomatis',
        voText: cleanText(voText),
        pillar,
        segments: copy._segments || null,
      };
    case 'FactBomb':
      return {
        hook,
        fact1: tips[0] || 'Mayoritas orang Indonesia belum punya dana darurat',
        fact2: tips[1] || 'Investasi sejak dini bisa tumbuh signifikan',
        fact3: tips[2] || 'Inflasi mengikis nilai uang setiap tahun',
        source: 'moneyq.id',
      };
    case 'FactBombPro':
      return {
        hook: cleanText(hook),
        fact1: cleanText(tips[0]) || 'Mayoritas orang Indonesia belum punya dana darurat',
        fact2: cleanText(tips[1]) || 'Investasi sejak dini bisa tumbuh signifikan',
        fact3: cleanText(tips[2]) || 'Inflasi mengikis nilai uang setiap tahun',
        source: 'moneyq.id',
        voText: cleanText(voText),
        pillar,
        segments: copy._segments || null,
      };
    case 'Challenge':
      return {
        hook,
        challenge: tips[0] || 'Catat semua pengeluaran harianmu selama 7 hari',
        prize: 'E-wallet Rp50.000',
      };
    case 'ChallengePro':
      return {
        hook: cleanText(hook),
        challenge: cleanText(tips[0]) || 'Catat semua pengeluaran harianmu selama 7 hari',
        prize: 'E-wallet Rp50.000',
        voText: cleanText(voText),
        pillar,
        segments: copy._segments || null,
      };
    case 'MentorWise':
      return {
        mentorName: 'MoneyQ Mentor',
        tagline: hook,
        sellingPoint1: tips[0] || 'Tips keuangan praktis',
        sellingPoint2: tips[1] || 'Panduan investasi pemula',
        sellingPoint3: tips[2] || 'Strategi nabung otomatis',
      };
    case 'MentorWisePro':
      return {
        mentorName: 'MoneyQ Mentor',
        tagline: cleanText(hook),
        sellingPoint1: cleanText(tips[0]) || 'Tips keuangan praktis',
        sellingPoint2: cleanText(tips[1]) || 'Panduan investasi pemula',
        sellingPoint3: cleanText(tips[2]) || 'Strategi nabung otomatis',
        voText: cleanText(voText),
        pillar,
        segments: copy._segments || null,
      };
    case 'FeatureDeepDive':
      return {
        featureName: topic?.topic || 'Nabung Otomatis',
        benefit1: tips[0] || 'Potong gaji langsung ke tabungan',
        benefit2: tips[1] || 'Atur nominal dan jadwal fleksibel',
        benefit3: tips[2] || 'Lihat progres lewat dashboard',
        statLine: 'Download MoneyQ — Gratis!',
      };
    case 'FeatureDeepDivePro':
      return {
        featureName: topic?.topic || 'Nabung Otomatis',
        benefit1: cleanText(tips[0]) || 'Potong gaji langsung ke tabungan',
        benefit2: cleanText(tips[1]) || 'Atur nominal dan jadwal fleksibel',
        benefit3: cleanText(tips[2]) || 'Lihat progres lewat dashboard',
        statLine: 'Download MoneyQ — Gratis!',
        voText: cleanText(voText),
        pillar,
        segments: copy._segments || null,
      };
    default:
      return { hook, tip1: tips[0] || '', tip2: tips[1] || '', tip3: tips[2] || '' };
  }
}

// ---------------------------------------------------------------------------
// Render template via CLI
// ---------------------------------------------------------------------------

async function renderTemplate(templateName, props) {
  try {
    // Pass props as JSON via environment variable
    const { stdout } = await execFileAsync('node', [RENDER_CLI, templateName], {
      cwd: REMOTION_DIR,
      timeout: 120_000,
      env: {
        ...process.env,
        REMOTION_PROPS: JSON.stringify(props),
      },
    });

    const lines = stdout.trim().split('\n');
    const outputPath = lines[lines.length - 1].trim();

    if (!outputPath || !outputPath.endsWith('.mp4')) {
      throw new Error(`Unexpected render-cli output: ${stdout.slice(0, 200)}`);
    }

    return outputPath;
  } catch (err) {
    throw new Error(`Remotion render failed: ${err.message}`);
  }
}
