// moneyq-social-engine/src/generators/image-gen.js
import { config } from '../utils/config.js';
import { supabase } from '../db.js';
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUTPUT_DIR = join(process.cwd(), 'output', 'images');

// Gemini image generation models (in order of preference)
const GEMINI_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
];

// Pillar-specific image prompts for AI generation
const AI_IMAGE_PROMPTS = {
  tips_hemat: (topic) =>
    `A modern, minimal financial illustration about saving money. ${topic}. Dark blue gradient background (#0f1628), teal accent (#06B5A5), clean professional style. Square 1:1 format. No text.`,
  edukasi_siklus: (topic) =>
    `An educational financial illustration. ${topic}. Clean design with dark background, soft lighting, professional. Square 1:1 format. No text.`,
  fakta_finansial: (topic) =>
    `A striking financial data visualization illustration. ${topic}. Dark dramatic background with yellow (#FFD166) and teal (#06B5A5) accents. Bold, eye-catching. Square 1:1. No text.`,
  before_after: (topic) =>
    `A transformation illustration showing financial improvement. ${topic}. Split composition, dark background, green (#22C55E) accent for positive change. Square 1:1. No text.`,
  challenge: (topic) =>
    `An energetic challenge illustration about finance. ${topic}. Dynamic composition, dark background, orange (#FF8C42) and teal accents. Square 1:1. No text.`,
  mentor_wise: (topic) =>
    `A wise mentorship illustration about finance. ${topic}. Calm, sophisticated, dark background with warm golden tones. Square 1:1. No text.`,
  feature_deep_dive: (topic) =>
    `A detailed product feature illustration for fintech. ${topic}. Modern, tech-forward, dark background with teal glow. Square 1:1. No text.`,
};

/**
 * Generate AI image using Gemini API
 * Returns buffer or null if failed
 */
async function generateAIImage(copy, topic) {
  const apiKey = config.gemini?.apiKey;
  if (!apiKey) return null;

  const pillar = topic?.pillar || 'tips_hemat';
  const promptFn = AI_IMAGE_PROMPTS[pillar] || AI_IMAGE_PROMPTS.tips_hemat;
  const topicText = topic?.topic || copy.hook?.slice(0, 80) || 'personal finance';
  const prompt = promptFn(topicText);

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      console.log(`  🤖 Trying Gemini image: ${model}...`);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
            },
          }),
        }
      );

      const data = await res.json();

      if (data.error) {
        const msg = data.error.message || '';
        if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
          console.log(`  ⚠️ ${model}: quota exceeded`);
          continue; // Try next model
        }
        console.log(`  ⚠️ ${model}: ${msg.slice(0, 80)}`);
        continue;
      }

      // Extract image from response
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const buffer = Buffer.from(part.inlineData.data, 'base64');
          console.log(`  ✅ AI image generated via ${model} (${buffer.length} bytes)`);
          return buffer;
        }
      }

      console.log(`  ⚠️ ${model}: no image in response`);
    } catch (err) {
      console.log(`  ⚠️ ${model}: ${err.message}`);
    }
  }

  return null;
}

/**
 * Convert emoji character to PNG buffer using Twemoji CDN
 * @param {string} emoji - Emoji character (e.g., '💡')
 * @param {number} size - Output size in pixels
 * @returns {Promise<Buffer>} PNG buffer
 */
async function emojiToBuffer(emoji, size = 128) {
  // Convert emoji to codepoint
  const codepoint = Array.from(emoji)
    .map(char => char.codePointAt(0).toString(16))
    .join('-')
    .replace(/-fe0f$/, ''); // Remove variation selector

  const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codepoint}.png`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return sharp(buffer).resize(size, size).png().toBuffer();
  } catch (err) {
    console.log(`  ⚠️ Emoji fetch failed (${emoji}): ${err.message}`);
    return null;
  }
}

/**
 * Create a circular emoji buffer
 */
async function emojiToCircleBuffer(emoji, size = 200) {
  const emojiBuffer = await emojiToBuffer(emoji, size - 20);
  if (!emojiBuffer) return null;

  // Create circle mask
  const circleMask = Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/>
    </svg>
  `);

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: emojiBuffer, left: 10, top: 10 },
    ])
    .png()
    .toBuffer();
}

// Content styles - randomly selected for variety
const CONTENT_STYLES = [
  'photo_overlay',    // Stock photo + text overlay
  'emoji_hero',       // Large emoji as focal point
  'gradient_shapes',  // Abstract shapes + gradient
  'split_design',     // Split layout (photo + text area)
  'quote_card',       // Quote-style card design
  'data_visual',      // Data/stats visual style
];

// Color palettes — varied bright colors
const COLOR_PALETTES = [
  { // Teal Blue
    colors: ['#06B5A5', '#049F91', '#038A7E'],
    bg: ['#0a1628', '#0d2b3e', '#0f2035'],
    accent: '#FFD166',
  },
  { // Warm Yellow
    colors: ['#FFD166', '#FFC233', '#FFB800'],
    bg: ['#1a1a0a', '#2e2e1a', '#0f2035'],
    accent: '#06B5A5',
  },
  { // Green
    colors: ['#22C55E', '#16A34A', '#15803D'],
    bg: ['#0a2e1a', '#1a4e2d', '#0f2035'],
    accent: '#FFD166',
  },
  { // White/Light
    colors: ['#FFFFFF', '#F0F0F0', '#E0E0E0'],
    bg: ['#0a1628', '#1a1a2e', '#0d2b3e'],
    accent: '#06B5A5',
  },
  { // Orange
    colors: ['#FF8C42', '#FF7B2E', '#FF6B1A'],
    bg: ['#2e1a0a', '#4e2d1a', '#0f2035'],
    accent: '#06B5A5',
  },
];

// Pillar-specific config (emojis + photo keywords)
const PILLAR_CONFIG = {
  tips_hemat: {
    emojis: ['💡', '✨', '🔥', '💰', '🎯', '📝', '✅', '💸', '🤑', '💵'],
    photoKeywords: ['saving money', 'piggy bank', 'wallet', 'budget planning', 'coins'],
  },
  edukasi_siklus: {
    emojis: ['📚', '💡', '🔄', '📊', '🎓', '📖', '🧠', '💻', '📱', '🎓'],
    photoKeywords: ['studying', 'learning', 'education', 'books', 'laptop work'],
  },
  fakta_finansial: {
    emojis: ['📊', '🚨', '💥', '📈', '⚡', '🔔', '📰', '💹', '🏦', '📉'],
    photoKeywords: ['finance chart', 'money statistics', 'business growth', 'stock market', 'economy'],
  },
  before_after: {
    emojis: ['🔄', '✨', '🚀', '💪', '🌟', '📈', '🎉', '🏆', '💫', '⭐'],
    photoKeywords: ['transformation', 'success', 'celebration', 'happy person', 'achievement'],
  },
  challenge: {
    emojis: ['🏆', '🎯', '💪', '🔥', '⭐', '🏅', '🥇', '🎪', '🎲', '🎯'],
    photoKeywords: ['challenge', 'competition', 'fitness challenge', 'determination', 'sports'],
  },
  behind_product: {
    emojis: ['🚀', '💡', '⚙️', '📱', '✨', '💻', '🔧', '📲', '🖥️', '⚡'],
    photoKeywords: ['technology', 'app interface', 'mobile phone', 'innovation', 'startup'],
  },
};

/**
 * Generate an Instagram-ready image with variety.
 * Priority: AI (Gemini) → SVG templates → fallback
 */
export async function generateImage(copy, topic) {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const pillar = topic?.pillar || 'tips_hemat';
  const pillarConfig = PILLAR_CONFIG[pillar] || PILLAR_CONFIG.tips_hemat;

  // --- Tier 1: AI Image Generation (Gemini) ---
  let imageBuffer;
  try {
    imageBuffer = await generateAIImage(copy, topic);
    if (imageBuffer) {
      // Overlay text on AI-generated image
      const finalBuffer = await overlayText(imageBuffer, copy.hook, {
        colors: ['#06B5A5', '#049F91', '#038A7E'],
        bg: ['#0f172a', '#1e293b', '#0d2b3e'],
        accent: '#FFD166',
        emojis: pillarConfig.emojis,
      }, 'ai_generated');

      const pillarSlug = (pillar || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `moneyq-ai-${pillarSlug}-${Date.now()}.jpg`;
      const localPath = join(OUTPUT_DIR, filename);
      await writeFile(localPath, finalBuffer);

      // Upload to Supabase
      const storagePath = `social-media/${filename}`;
      const { error: uploadError } = await supabase.storage.from('content')
        .upload(storagePath, finalBuffer, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) {
        console.log(`  ⚠️ Supabase upload failed: ${uploadError.message}, using local path`);
        return { imagePath: localPath, imageUrl: null };
      }

      const { data: urlData } = supabase.storage.from('content').getPublicUrl(storagePath);
      console.log(`  ✅ AI image saved: ${localPath}`);
      return { imagePath: localPath, imageUrl: urlData.publicUrl };
    }
  } catch (err) {
    console.log(`  ⚠️ AI image failed: ${err.message}, falling back to SVG`);
  }

  // --- Tier 2: SVG Templates (current system) ---


  // Randomly select color palette (varied colors each time)
  const colorPalette = COLOR_PALETTES[Math.floor(Math.random() * COLOR_PALETTES.length)];

  // Merge pillar config with random color palette
  const style = {
    ...colorPalette,
    emojis: pillarConfig.emojis,
    photoKeywords: pillarConfig.photoKeywords,
  };

  // Randomly select content style
  const selectedStyle = CONTENT_STYLES[Math.floor(Math.random() * CONTENT_STYLES.length)];
  console.log(`  🎨 Style: ${selectedStyle} | Colors: ${colorPalette.colors[0]}`);

  let imageBuffer;

  // Generate based on selected style
  try {
    switch (selectedStyle) {
      case 'photo_overlay':
        imageBuffer = await generatePhotoOverlay(copy, topic, style);
        break;
      case 'emoji_hero':
        imageBuffer = await generateEmojiHero(copy, topic, style);
        break;
      case 'gradient_shapes':
        imageBuffer = await generateGradientShapes(copy, topic, style);
        break;
      case 'split_design':
        imageBuffer = await generateSplitDesign(copy, topic, style);
        break;
      case 'quote_card':
        imageBuffer = await generateQuoteCard(copy, topic, style);
        break;
      case 'data_visual':
        imageBuffer = await generateDataVisual(copy, topic, style);
        break;
      default:
        imageBuffer = await generateGradientShapes(copy, topic, style);
    }
  } catch (err) {
    console.log(`  ⚠️ Style ${selectedStyle} failed: ${err.message}, using fallback`);
    imageBuffer = await generateGradientShapes(copy, topic, style);
  }

  // Overlay hook text + watermark
  const finalBuffer = await overlayText(imageBuffer, copy.hook, style, selectedStyle);

  // Save locally
  const pillarSlug = (pillar || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `moneyq-${pillarSlug}-${Date.now()}.jpg`;
  const localPath = join(OUTPUT_DIR, filename);
  await writeFile(localPath, finalBuffer);

  // Upload to Supabase Storage
  const storagePath = `social-media/${filename}`;
  const { error: uploadError } = await supabase
    .storage
    .from('content')
    .upload(storagePath, finalBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (uploadError) {
    console.log(`  ⚠️ Supabase upload failed: ${uploadError.message}, using local path`);
    return { imagePath: localPath, imageUrl: null };
  }

  const { data: urlData } = supabase
    .storage
    .from('content')
    .getPublicUrl(storagePath);

  return { imagePath: localPath, imageUrl: urlData.publicUrl };
}

/**
 * Style 1: Photo overlay - stock photo with text overlay
 */
async function generatePhotoOverlay(copy, topic, style) {
  const photoUrl = await fetchStockPhoto(style.photoKeywords);

  if (photoUrl) {
    try {
      const photoRes = await fetch(photoUrl);
      if (photoRes.ok) {
        const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
        // Apply dark overlay to make text readable
        return await sharp(photoBuffer)
          .resize(1080, 1080, { fit: 'cover' })
          .composite([{
            input: Buffer.from(`
              <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="overlay" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:${style.bg[0]};stop-opacity:0.7"/>
                    <stop offset="100%" style="stop-color:${style.bg[0]};stop-opacity:0.9"/>
                  </linearGradient>
                </defs>
                <rect width="1080" height="1080" fill="url(#overlay)"/>
              </svg>
            `),
            top: 0,
            left: 0,
          }])
          .toBuffer();
      }
    } catch (err) {
      console.log(`  ⚠️ Photo fetch failed: ${err.message}`);
    }
  }

  // Fallback to gradient if photo fails
  return generateGradientShapes(copy, topic, style);
}

/**
 * Style 2: Emoji hero - large emoji as focal point (using real emoji images)
 */
async function generateEmojiHero(copy, topic, style) {
  const emoji = style.emojis[Math.floor(Math.random() * style.emojis.length)];
  const primaryColor = style.colors[0];
  const bgDark = style.bg[0];
  const bgLight = style.bg[1] || style.bg[0];

  // Generate background
  const bgSvg = `
    <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${bgDark}"/>
          <stop offset="100%" style="stop-color:${bgLight}"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="40%">
          <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:0.3"/>
          <stop offset="100%" style="stop-color:${primaryColor};stop-opacity:0"/>
        </radialGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#bg)"/>
      <rect width="1080" height="1080" fill="url(#glow)"/>
    </svg>`;

  let bgBuffer = Buffer.from(bgSvg);

  // Fetch emoji as real image
  const emojiBuffer = await emojiToBuffer(emoji, 250);

  if (emojiBuffer) {
    // Composite emoji onto background
    return sharp(bgBuffer)
      .composite([{
        input: emojiBuffer,
        left: 415,
        top: 350,
      }])
      .toBuffer();
  }

  // Fallback if emoji fetch fails
  return bgBuffer;
}

/**
 * Style 3: Gradient shapes - abstract shapes
 */
async function generateGradientShapes(copy, topic, style) {
  const primaryColor = style.colors[0];
  const bgDark = style.bg[0];
  const bgLight = style.bg[1] || style.bg[0];
  const accent = style.accent;

  const layouts = [
    // Circles
    () => `
      <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${bgDark}"/>
            <stop offset="100%" style="stop-color:${bgLight}"/>
          </linearGradient>
          <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${primaryColor}"/>
            <stop offset="100%" style="stop-color:${accent}"/>
          </linearGradient>
        </defs>
        <rect width="1080" height="1080" fill="url(#bg)"/>
        <circle cx="750" cy="300" r="350" fill="url(#accent)" opacity="0.15"/>
        <circle cx="300" cy="750" r="250" fill="${primaryColor}" opacity="0.1"/>
        <circle cx="900" cy="900" r="150" fill="${accent}" opacity="0.08"/>
      </svg>`,

    // Waves
    () => `
      <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:${bgDark}"/>
            <stop offset="100%" style="stop-color:${bgLight}"/>
          </linearGradient>
          <linearGradient id="wave" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:0.2"/>
            <stop offset="100%" style="stop-color:${accent};stop-opacity:0.1"/>
          </linearGradient>
        </defs>
        <rect width="1080" height="1080" fill="url(#bg)"/>
        <path d="M0,600 Q270,500 540,600 T1080,600 L1080,1080 L0,1080 Z" fill="url(#wave)"/>
        <path d="M0,700 Q270,600 540,700 T1080,700 L1080,1080 L0,1080 Z" fill="${primaryColor}" opacity="0.08"/>
      </svg>`,

    // Geometric
    () => `
      <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${bgDark}"/>
            <stop offset="100%" style="stop-color:${bgLight}"/>
          </linearGradient>
        </defs>
        <rect width="1080" height="1080" fill="url(#bg)"/>
        <rect x="100" y="100" width="300" height="300" rx="20" fill="${primaryColor}" opacity="0.1" transform="rotate(15 250 250)"/>
        <rect x="600" y="500" width="250" height="250" rx="20" fill="${accent}" opacity="0.1" transform="rotate(-10 725 625)"/>
        <circle cx="500" cy="400" r="150" fill="${primaryColor}" opacity="0.08"/>
      </svg>`,
  ];

  const layoutFn = layouts[Math.floor(Math.random() * layouts.length)];
  return Buffer.from(layoutFn());
}

/**
 * Style 4: Split design - photo area + text area
 */
async function generateSplitDesign(copy, topic, style) {
  const primaryColor = style.colors[0];
  const bgDark = style.bg[0];
  const emoji = style.emojis[Math.floor(Math.random() * style.emojis.length)];

  // Background SVG
  const bgSvg = `
    <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${bgDark}"/>
          <stop offset="100%" style="stop-color:${style.bg[1] || bgDark}"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#bg)"/>
      <rect x="0" y="0" width="540" height="1080" fill="${primaryColor}" opacity="0.15"/>
      <line x1="540" y1="100" x2="540" y2="980" stroke="${primaryColor}" stroke-width="2" opacity="0.3"/>
    </svg>`;

  let bgBuffer = Buffer.from(bgSvg);

  // Fetch emoji as real image
  const emojiBuffer = await emojiToBuffer(emoji, 200);

  if (emojiBuffer) {
    return sharp(bgBuffer)
      .composite([{
        input: emojiBuffer,
        left: 170,
        top: 440,
      }])
      .toBuffer();
  }

  return bgBuffer;
}

/**
 * Style 5: Quote card - clean quote-style design
 */
async function generateQuoteCard(copy, topic, style) {
  const primaryColor = style.colors[0];
  const bgDark = style.bg[0];
  const bgLight = style.bg[1] || style.bg[0];

  return Buffer.from(`
    <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${bgDark}"/>
          <stop offset="100%" style="stop-color:${bgLight}"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#bg)"/>
      <!-- Quote marks -->
      <text x="100" y="300" font-family="Georgia, serif" font-size="200" fill="${primaryColor}" opacity="0.2">"</text>
      <text x="980" y="900" font-family="Georgia, serif" font-size="200" fill="${primaryColor}" opacity="0.2">"</text>
      <!-- Accent bar -->
      <rect x="440" y="250" width="200" height="4" rx="2" fill="${primaryColor}" opacity="0.6"/>
    </svg>
  `);
}

/**
 * Style 6: Data visual - stats/numbers style
 */
async function generateDataVisual(copy, topic, style) {
  const primaryColor = style.colors[0];
  const bgDark = style.bg[0];
  const emoji = style.emojis[Math.floor(Math.random() * style.emojis.length)];

  // Random stats
  const stats = [
    { value: '87%', label: 'Orang Indonesia' },
    { value: '3x', label: 'Lebih Hemat' },
    { value: '50%', label: 'Pengeluaran' },
    { value: '10jt', label: 'Per Bulan' },
  ];
  const stat = stats[Math.floor(Math.random() * stats.length)];
  const progressWidth = Math.floor(Math.random() * 300 + 240);

  // Background SVG
  const bgSvg = `
    <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${bgDark}"/>
          <stop offset="100%" style="stop-color:${style.bg[1] || bgDark}"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#bg)"/>
      <text x="540" y="400" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="180" fill="${primaryColor}" opacity="0.15">${stat.value}</text>
      <text x="540" y="750" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" fill="white" opacity="0.6">${stat.label}</text>
      <rect x="270" y="800" width="540" height="8" rx="4" fill="${primaryColor}" opacity="0.3"/>
      <rect x="270" y="800" width="${progressWidth}" height="8" rx="4" fill="${primaryColor}" opacity="0.8"/>
    </svg>`;

  let bgBuffer = Buffer.from(bgSvg);

  // Fetch emoji as real image
  const emojiBuffer = await emojiToBuffer(emoji, 150);

  if (emojiBuffer) {
    return sharp(bgBuffer)
      .composite([{
        input: emojiBuffer,
        left: 465,
        top: 530,
      }])
      .toBuffer();
  }

  return bgBuffer;
}

/**
 * Fetch stock photo from Pexels
 */
async function fetchStockPhoto(keywords) {
  if (!config.pexels?.apiKey) return null;

  const keyword = keywords[Math.floor(Math.random() * keywords.length)];

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=5&orientation=square`,
      { headers: { Authorization: config.pexels.apiKey } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.photos?.length) return null;

    // Pick random photo
    const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
    return photo.src?.large || photo.src?.medium || null;
  } catch {
    return null;
  }
}

/**
 * Overlay text on image with style variations
 */
async function overlayText(imageBuffer, hookText, style, contentStyle) {
  const width = 1080;
  const height = 1080;
  const primaryColor = style.colors[0];
  const emoji = style.emojis[Math.floor(Math.random() * style.emojis.length)];

  // Word wrap
  const words = hookText.split(' ');
  const lines = [];
  let currentLine = '';
  const maxCharsPerLine = 28;

  for (const word of words) {
    if ((currentLine + ' ' + word).length > maxCharsPerLine) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += ' ' + word;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());

  // Text position based on content style
  let textYStart;
  let textAlign = 'middle';

  switch (contentStyle) {
    case 'photo_overlay':
      textYStart = 600; // Bottom area for photo overlays
      break;
    case 'split_design':
      textYStart = 540; // Right side center
      textAlign = 'start';
      break;
    case 'quote_card':
      textYStart = 500; // Center for quotes
      break;
    case 'data_visual':
      textYStart = 850; // Below the data
      break;
    case 'ai_generated':
      textYStart = 750; // Bottom area for AI images
      break;
    default:
      textYStart = 540; // Center
  }

  const lineHeight = 56;
  const textX = textAlign === 'start' ? 700 : 540;
  const textAnchor = textAlign === 'start' ? 'start' : 'middle';

  const textSvg = lines.map((line, i) =>
    `<text x="${textX}" y="${textYStart + i * lineHeight}" text-anchor="${textAnchor}"
           font-family="Plus Jakarta Sans, Arial, sans-serif" font-weight="700"
           font-size="44" fill="white" letter-spacing="-0.5"
           stroke="${primaryColor}" stroke-width="2" paint-order="stroke">
      ${escapeXml(line)}
    </text>`
  ).join('\n');

  // Decorative line (no emoji in SVG)
  const decorY = textYStart - 80;
  const decorSvg = `
    <rect x="${textX - 100}" y="${decorY}" width="200" height="4" rx="2" fill="${primaryColor}" opacity="0.8"/>
  `;

  const overlaySvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="black" opacity="0.25"/>
      ${decorSvg}
      ${textSvg}
      <text x="60" y="1040" font-family="Arial" font-size="18" fill="white" opacity="0.6">
        moneyq.id
      </text>
    </svg>`;

  // Fetch emoji as real image
  const emojiBuffer = await emojiToBuffer(emoji, 64);

  // Build composite operations
  const composites = [
    { input: Buffer.from(overlaySvg), top: 0, left: 0 },
  ];

  // Add emoji if fetched successfully
  if (emojiBuffer) {
    composites.push({
      input: emojiBuffer,
      left: textX - 32,
      top: decorY - 72,
    });
  }

  return sharp(imageBuffer)
    .resize(width, height, { fit: 'cover' })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toBuffer();
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
