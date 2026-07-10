// moneyq-social-engine/src/generators/image-gen.js
import { config } from '../utils/config.js';
import { supabase } from '../db.js';
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUTPUT_DIR = join(process.cwd(), 'output', 'images');

/**
 * Generate an Instagram-ready image with AI + text overlay.
 * @returns {Promise<{imagePath: string, imageUrl: string}>}
 */
export async function generateImage(copy, topic) {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let imageBuffer;

  // 1. Try Stable Diffusion via Hugging Face
  try {
    imageBuffer = await generateWithStableDiffusion(copy, topic);
    console.log('  🎨 Image generated via Stable Diffusion');
  } catch (err) {
    console.log(`  ⚠️ SD failed: ${err.message}, trying fallback...`);
    // 2. Fallback: static template with text
    imageBuffer = await generateStaticTemplate(copy, topic);
  }

  // 3. Overlay hook text + watermark
  const finalBuffer = await overlayText(imageBuffer, copy.hook);

  // 4. Save locally
  const filename = `moneyq-${topic.pillar}-${Date.now()}.jpg`;
  const localPath = join(OUTPUT_DIR, filename);
  await writeFile(localPath, finalBuffer);

  // 5. Upload to Supabase Storage
  const storagePath = `social-media/${filename}`;
  const { data: uploadData, error: uploadError } = await supabase
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

async function generateWithStableDiffusion(copy, topic) {
  if (!config.huggingface.apiToken) throw new Error('HF API token not configured');

  const prompt = `Modern clean financial illustration, Indonesian context, ${topic.topic},
    green and white color scheme (#22c55e primary), minimalist flat design,
    professional but friendly, suitable for Instagram post, 1080x1080 square format,
    no text in the image, abstract financial concepts, gradient background`;

  const res = await fetch(
    `https://api-inference.huggingface.co/models/${config.huggingface.model}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.huggingface.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt, parameters: { negative_prompt: 'text, watermark, low quality' } }),
    }
  );

  if (!res.ok) throw new Error(`HF HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateStaticTemplate(copy, topic) {
  // Generate a gradient background with colored shapes
  const width = 1080;
  const height = 1080;

  const svgBg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#0f172a"/>
          <stop offset="100%" style="stop-color:#064e3b"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <circle cx="800" cy="200" r="300" fill="#22c55e" opacity="0.15"/>
      <circle cx="200" cy="800" r="250" fill="#f59e0b" opacity="0.1"/>
    </svg>`;

  return Buffer.from(svgBg);
}

async function overlayText(imageBuffer, hookText) {
  // Create text overlay SVG with the hook
  const width = 1080;
  const height = 1080;

  // Word wrap for hook text
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

  const textYStart = 680;
  const lineHeight = 56;
  const textSvg = lines.map((line, i) =>
    `<text x="540" y="${textYStart + i * lineHeight}" text-anchor="middle"
           font-family="Plus Jakarta Sans, Arial, sans-serif" font-weight="700"
           font-size="42" fill="white" letter-spacing="-0.5">
      ${escapeXml(line)}
    </text>`
  ).join('\n');

  const overlaySvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="black" opacity="0.35"/>
      ${textSvg}
      <text x="60" y="1040" font-family="Arial" font-size="18" fill="white" opacity="0.6">
        moneyq.id
      </text>
    </svg>`;

  return sharp(imageBuffer)
    .resize(width, height, { fit: 'cover' })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
