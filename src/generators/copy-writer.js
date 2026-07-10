// moneyq-social-engine/src/generators/copy-writer.js
import { config } from '../utils/config.js';
import { db } from '../db.js';

const PLATFORM_LIMITS = {
  instagram: { caption: 2200, hashtags: 30 },
  threads: { body: 500, hashtags: 10 },
  tiktok: { caption: 2200, hashtags: 30 }, // caption can be long; video text is short
  youtube: { title: 100, description: 5000 },
};

/**
 * Generate social media copy using AI with multi-provider fallback.
 * @param {Object} topic - { topic, pillar, angle }
 * @param {string} platform - instagram | threads | tiktok | youtube
 * @returns {Promise<{hook: string, body: string, cta: string, hashtags: string[], altText: string}>}
 */
export async function generateCopy(topic, platform) {
  // Pick least-used template for this pillar+platform
  const templates = await db.getLeastUsedTemplates(topic.pillar, platform, 3);
  const template = templates[0]?.template_text || getDefaultTemplate(topic.pillar, platform);

  // Build the prompt
  const prompt = buildPrompt(topic, platform, template);

  // Try providers in priority order
  const providers = [
    { name: 'gemini', fn: callGemini },
    { name: 'mistral', fn: callMistral },
    { name: 'deepseek', fn: callDeepSeek },
    { name: 'claude', fn: callClaude },
  ];

  for (const provider of providers) {
    try {
      console.log(`  🤖 Trying ${provider.name}...`);
      const raw = await provider.fn(prompt);
      const parsed = parseAndValidate(raw, platform);

      // Increment template usage
      if (templates[0]?.id) {
        await db.incrementTemplateUsage(templates[0].id);
      }

      // Get least-used hashtags
      const hashtagRows = await db.getLeastUsedHashtags(['brand', 'keuangan', 'lifestyle', 'edukasi'], 10);
      const dbHashtags = hashtagRows.map(h => h.tag);

      // Merge AI-generated hashtags with least-used pool
      const maxHashtags = PLATFORM_LIMITS[platform].hashtags;
      const allHashtags = [...new Set([...parsed.hashtags, ...dbHashtags])].slice(0, maxHashtags);

      // Increment hashtag usage
      for (const h of hashtagRows.slice(0, maxHashtags)) {
        await db.incrementHashtagUsage(h.id);
      }

      return {
        hook: parsed.hook,
        body: parsed.body.slice(0, PLATFORM_LIMITS[platform].caption || PLATFORM_LIMITS[platform].body),
        cta: parsed.cta,
        hashtags: allHashtags,
        altText: parsed.altText || parsed.hook,
        provider: provider.name,
      };
    } catch (err) {
      console.log(`  ⚠️ ${provider.name} failed: ${err.message}`);
      continue;
    }
  }

  throw new Error('All AI providers failed to generate copy');
}

function buildPrompt(topic, platform, template) {
  const platformContext = {
    instagram: 'Instagram post dengan caption panjang, relatable, storytelling.',
    threads: 'Threads text-only post, 5-7 poin pendek, format thread.',
    tiktok: 'TikTok caption pendek + hook untuk video singkat.',
    youtube: 'YouTube Shorts title dan description.',
  };

  return `Kamu adalah copywriter untuk MoneyQ, aplikasi budgeting berbasis siklus (moneyq.id).

PRODUK: MoneyQ — Platform manajemen keuangan pribadi dengan sistem budget berbasis siklus (bukan bulanan), auto-sync ke Google Sheets, fitur Recovery Plan untuk yang terlilit utang, dan Mentor Wise untuk konsultasi keuangan. Target: anak muda Indonesia, generasi sandwich, yang ingin kelola keuangan lebih baik. Gratis.

TEMPLATE:
${template}

KONTEKS:
- Topik: ${topic.topic}
- Pilar konten: ${topic.pillar}
- Angle: ${topic.angle}
- Platform: ${platform} — ${platformContext[platform]}

TONALITAS:
- Santai, relateable, ada humor ringan (tapi jangan cringe)
- Hook yang provokatif/menggelitik
- Bahasa Indonesia sehari-hari (campur dikit bahasa gaul ok)
- Jangan terlalu jualan — fokus ke VALUE
- Akhiri dengan soft CTA ke moneyq.id

OUTPUT JSON (hanya JSON, tidak ada teks lain):
{
  "hook": "kalimat pembuka yang bikin orang berhenti scroll",
  "body": "isi konten lengkap",
  "cta": "ajakan ke action",
  "hashtags": ["tag1", "tag2", "tag3"],
  "altText": "deskripsi gambar untuk aksesibilitas"
}`;
}

async function callGemini(prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 1024, responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

async function callMistral(prompt) {
  if (!config.mistral.apiKey) throw new Error('Mistral API key not configured');

  const res = await fetch(config.mistral.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.mistral.apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: 'Kamu copywriter Indonesia untuk MoneyQ. Output JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callDeepSeek(prompt) {
  if (!config.deepseek.apiKey) throw new Error('DeepSeek API key not configured');

  const res = await fetch(config.deepseek.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.deepseek.apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Kamu copywriter Indonesia untuk MoneyQ. Output JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callClaude(prompt) {
  if (!config.anthropic.apiKey) throw new Error('Claude API key not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'Kamu copywriter Indonesia untuk MoneyQ. Output JSON only, no other text.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const data = await res.json();
  return data.content[0].text;
}

function parseAndValidate(raw, platform) {
  // Extract JSON from response (handle markdown code blocks)
  let json = raw.trim();
  const match = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) json = match[1].trim();

  const parsed = JSON.parse(json);

  // Validate required fields
  const required = ['hook', 'body', 'cta', 'hashtags'];
  for (const field of required) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`);
  }

  if (!Array.isArray(parsed.hashtags)) throw new Error('hashtags must be an array');

  return parsed;
}

function getDefaultTemplate(pillar, platform) {
  const templates = {
    tips_hemat: 'Buat konten tentang tips hemat dengan {pain_point}. Hook: pertanyaan provokatif. Body: 3 tips actionable.',
    edukasi_siklus: 'Jelaskan kenapa sistem siklus lebih baik dari budgeting bulanan. Hook: challenge asumsi umum.',
    fakta_finansial: 'Buka dengan statistik mengejutkan tentang keuangan orang Indonesia. Body: jelaskan dampak + solusi.',
    before_after: 'Ceritakan transformasi dari kondisi keuangan buruk ke baik. Hook: relatable pain point.',
    challenge: 'Buat challenge seru seputar hemat/keuangan. Hook: tantang pembaca dengan nada playful.',
    behind_product: 'Jelaskan fitur MoneyQ dengan angle user problem. Hook: "Pernah ngalamin [pain]?"',
  };
  return templates[pillar] || templates.tips_hemat;
}
