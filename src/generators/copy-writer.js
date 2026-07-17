// moneyq-social-engine/src/generators/copy-writer.js
import { config } from '../utils/config.js';
import { db } from '../db.js';

const PLATFORM_LIMITS = {
  instagram: { caption: 300, hashtags: 10 }, // singkat, hook-based
  threads: { body: 150, hashtags: 5 }, // sangat singkat, kayak tweet
  tiktok: { caption: 2200, hashtags: 30 },
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

      // Normalize hashtags - strip # prefix from all to avoid double ##
      const normalizeTag = (tag) => String(tag).replace(/^#+/, '').trim();
      const aiTags = parsed.hashtags.map(normalizeTag).filter(Boolean);
      const dbTags = dbHashtags.map(normalizeTag).filter(Boolean);

      // Merge AI-generated hashtags with least-used pool (no duplicates)
      const maxHashtags = PLATFORM_LIMITS[platform].hashtags;
      const allHashtags = [...new Set([...aiTags, ...dbTags])].slice(0, maxHashtags);

      // Increment hashtag usage
      for (const h of hashtagRows.slice(0, maxHashtags)) {
        await db.incrementHashtagUsage(h.id);
      }

      const bodyLimit = PLATFORM_LIMITS[platform].caption || PLATFORM_LIMITS[platform].body || 2200;

      // Ensure all fields are strings (Mistral sometimes returns objects/arrays)
      const hookStr = typeof parsed.hook === 'string' ? parsed.hook : String(parsed.hook || '');
      const bodyStr = typeof parsed.body === 'string' ? parsed.body : String(parsed.body || '');
      const ctaStr = typeof parsed.cta === 'string' ? parsed.cta : String(parsed.cta || '');

      return {
        hook: hookStr,
        body: bodyStr.slice(0, bodyLimit),
        cta: ctaStr,
        hashtags: allHashtags,
        altText: parsed.altText || hookStr,
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
    instagram: `Instagram post — PRIORITAS: hook kuat, singkat, bikin penasaran, pancing komentar.
- Body MAKSIMAL 2-3 kalimat pendek (bukan paragraf panjang)
- Format: hook → 1 fakta/tips singkat → CTA
- JANGAN pakai list panjang, JANGAN paragraf texty
- Contoh bagus:
  "Gaji 8jt tapi saldo selalu 0 di tanggal 15? Lo bukan boros. Lo salah sistem."
  "Coba hitung: kopi harian lo = Rp900rb/bulan. Itu udah bisa buat dana darurat."
  "Yang gajiannya di atas 10jt, coba cek tabungan. Kalau masih nihil, baca ini."`,

    threads: `Threads post — SANGAT SINGKAT, kayak tweet, bikin orang reply.
- Body MAKSIMAL 1-2 kalimat pendek
- Format: hook provokatif → 1 kalimat penutup
- JANGAN list, JANGAN panjang, JANGAN texty
- Contoh bagus:
  "Lo nabung sisa gaji? Itu cara paling gagal nabung."
  "Kopi harian lo = Rp900rb/bulan. Gak percaya? Hitung sendiri."
  "Gaji naik tapi tabungan gak naik? Masalahnya bukan di gaji."`,

    tiktok: 'TikTok caption pendek + hook untuk video singkat.',
    youtube: 'YouTube Shorts title dan description.',
  };

  return `Kamu adalah copywriter expert untuk MoneyQ, aplikasi budgeting berbasis siklus (moneyq.id).

PRODUK: MoneyQ — Platform manajemen keuangan pribadi dengan sistem budget berbasis siklus (bukan bulanan), auto-sync ke Google Sheets, fitur Recovery Plan untuk yang terlilit utang, dan Mentor Wise untuk konsultasi keuangan. Target: anak muda Indonesia (18-35), generasi sandwich, yang ingin kelola keuangan lebih baik. GRATIS.

TEMPLATE:
${template}

KONTEKS:
- Topik: ${topic.topic}
- Pilar konten: ${topic.pillar}
- Angle: ${topic.angle}
- Platform: ${platform} — ${platformContext[platform]}

ATURAN WAJIB:
1. HOOK harus BIKIN PENASARAN & PANCING KOMENTAR:
   - Pertanyaan yang bikin orang mau jawab
   - Statemen provokatif yang bikin orang mau debate
   - Fakta mengejutkan yang bikin orang mau share
   - Contoh: "Lo masih nabung sisa gaji? Itu cara PALING GAGAL nabung."
   - Contoh: "87% orang Indonesia gak punya dana darurat. Lo termasuk?"
   - Contoh: "Gaji 8jt tapi saldo selalu 0 di tanggal 15..."

2. BODY harus SINGKAT & TO THE POINT:
   - Instagram: MAKSIMAL 2-3 kalimat pendek
   - Threads: MAKSIMAL 1-2 kalimat pendek
   - JANGAN paragraf panjang, JANGAN list panjang
   - 1 fakta/tips yang impactful, langsung ke inti
   - Potong sebelum selesai → bikin penasaran

3. CTA harus SOFT-SELL & BIKIN PENASARAN:
   - "Coba gratis di moneyq.id"
   - "Mulai atur uang lo di moneyq.id"
   - Jangan hard-sell atau spammy

4. HASHTAGS:
   - Mix brand (#MoneyQ) + niche (#TipsHemat) + trending (#FinanceTok)
   - 5-10 hashtag

TONALITAS:
- Santai, relateable, kayak ngobrol sama temen
- Bahasa Indonesia gaul (lo, gue, bro, sis)
- SINGKAT, JANGAN texty
- Fokus ke 1 poin impactful

OUTPUT JSON (hanya JSON, tidak ada teks lain):
{
  "hook": "kalimat pembuka yang bikin orang berhenti scroll & mau komentar (max 100 char)",
  "body": "isi SINGKAT, maksimal 2-3 kalimat pendek (max 200 char untuk instagram, 100 char untuk threads)",
  "cta": "ajakan soft-sell ke moneyq.id",
  "hashtags": ["MoneyQ", "TipsHemat", "tag3"],
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
        { role: 'system', content: 'Kamu copywriter Indonesia untuk MoneyQ. Output JSON only, singkat dan padat.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 2048,
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

// Clean text — hapus emoji, raw format, JSON fragments
function cleanTextField(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/"[^"]*"\s*:\s*"[^"]*"/g, '')
    .replace(/"\d+:\d+"\s*:/g, '')
    .replace(/:\s*"[^"]*"/g, '')
    .replace(/[=<>]/g, '')
    .replace(/\.\.\./g, ',')
    .replace(/\.{2,}/g, '.')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[,:]\s*/, '')
    .replace(/\s*[,:]\s*$/, '')
    .trim();
}

function parseAndValidate(raw, platform) {
  // Extract JSON from response (handle markdown code blocks)
  let json = raw.trim();
  const match = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) json = match[1].trim();

  // Try to find JSON object if surrounded by extra text
  const jsonMatch = json.match(/\{[\s\S]*\}/);
  if (jsonMatch) json = jsonMatch[0];

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    // Try to repair truncated JSON
    const repaired = repairTruncatedJson(json);
    try {
      parsed = JSON.parse(repaired);
    } catch {
      throw new Error(`JSON parse failed: ${e.message}. Raw: ${raw.slice(0, 200)}`);
    }
  }

  // Normalize fields — Mistral sometimes returns arrays/objects instead of strings
  function normalizeField(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map(item => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) return item.text || item.content || JSON.stringify(item);
        return String(item);
      }).join('\n');
    }
    if (typeof value === 'object') return value.text || value.content || JSON.stringify(value);
    return String(value);
  }

  // Normalize + clean
  parsed.body = cleanTextField(normalizeField(parsed.body));
  parsed.hook = cleanTextField(normalizeField(parsed.hook));
  parsed.cta = cleanTextField(normalizeField(parsed.cta));

  // Ensure strings
  parsed.hook = String(parsed.hook || '');
  parsed.body = String(parsed.body || '');
  parsed.cta = String(parsed.cta || '');
  parsed.altText = cleanTextField(String(parsed.altText || parsed.hook || ''));

  // Validate required fields
  const required = ['hook', 'body', 'hashtags'];
  for (const field of required) {
    if (!parsed[field] || (typeof parsed[field] === 'string' && parsed[field].trim().length === 0)) {
      throw new Error(`Missing or empty required field: ${field}`);
    }
  }

  // CTA is optional — provide default if missing
  if (!parsed.cta || (typeof parsed.cta === 'string' && parsed.cta.trim().length === 0)) {
    parsed.cta = 'Cek moneyq.id untuk mulai atur keuanganmu 💚';
  }

  if (!Array.isArray(parsed.hashtags)) {
    // Try to convert string hashtags to array
    if (typeof parsed.hashtags === 'string') {
      parsed.hashtags = parsed.hashtags.split(/[,#\s]+/).filter(Boolean).map(t => t.replace(/^#/, ''));
    } else {
      throw new Error('hashtags must be an array');
    }
  }

  // Clean hashtag format
  parsed.hashtags = parsed.hashtags.map(h => String(h).replace(/^#/, '').trim()).filter(Boolean);

  return parsed;
}

function repairTruncatedJson(json) {
  // Simple repair for truncated JSON responses
  let repaired = json;

  // Count open/close braces and brackets
  const opens = (repaired.match(/\{/g) || []).length;
  const closes = (repaired.match(/\}/g) || []).length;
  const arrOpens = (repaired.match(/\[/g) || []).length;
  const arrCloses = (repaired.match(/\]/g) || []).length;

  // If we're inside a string (odd number of unescaped quotes), close it
  const quotes = (repaired.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 !== 0) {
    repaired += '"';
  }

  // Close any open arrays
  for (let i = 0; i < arrOpens - arrCloses; i++) {
    repaired += ']';
  }

  // Close any open objects
  for (let i = 0; i < opens - closes; i++) {
    repaired += '}';
  }

  return repaired;
}

function getDefaultTemplate(pillar, platform) {
  const templates = {
    tips_hemat: {
      instagram: `Format Instagram:
- Hook (baris 1): Pertanyaan provokatif atau statemen yang bikin berhenti scroll. Contoh: "Lo masih ngeluarin 50% gaji buat makan di luar? 😱"
- Body: 3 tips hemat yang actionable, tiap tip 1-2 kalimat, pakai emoji bullet
- CTA: Soft ajakan ke moneyq.id
- Tone: Santai, kayak ngobrol sama temen`,
      threads: `Format Threads (500 char max):
- Hook: 1 kalimat provokatif
- Body: 3-5 poin pendek pakai emoji ✅
- CTA: Ajakan singkat ke moneyq.id
- Contoh format:
"Hook yang bikin penasaran ✅

✅ Tip 1: [actionable tip]
✅ Tip 2: [actionable tip]
✅ Tip 3: [actionable tip]

CTA ke moneyq.id"`,
      default: 'Buat konten tips hemat. Hook: pertanyaan provokatif. Body: 3 tips actionable. CTA: soft sell ke moneyq.id.'
    },
    edukasi_siklus: {
      instagram: `Format Instagram:
- Hook: Challenge asumsi umum tentang budgeting. Contoh: "Budget bulanan itu MITOS. Gue buktiin sendiri kenapa gagal terus."
- Body: Jelaskan kenapa sistem siklus (7-10 hari) lebih realistis dari bulanan
- Pakai analogi yang relate: "Kayak diet, kalau terlalu lama pasti nyerah"
- CTA: Ajakan coba MoneyQ gratis`,
      threads: `Format Threads (500 char max):
- Hook: "Budget bulanan = diet yang pasti gagal. Kenapa?"
- Body: 3 alasan kenapa siklus lebih baik
- Format: poin-poin singkat
- CTA: "Coba gratis di moneyq.id"`,
      default: 'Jelaskan kenapa sistem siklus lebih baik dari budgeting bulanan. Hook: challenge asumsi umum.'
    },
    fakta_finansial: {
      instagram: `Format Instagram:
- Hook: Statistik mengejutkan. Contoh: "87% orang Indonesia gak punya dana darurat. Lo termasuk?"
- Body: Jelaskan fakta + dampaknya + solusi
- Sertakan angka/data biar credible
- CTA: Ajakan ke moneyq.id untuk solusi`,
      threads: `Format Threads (500 char max):
- Hook: Fakta + emoji 🚨
- Body: Penjelasan singkat 2-3 poin
- CTA: Link ke moneyq.id`,
      default: 'Buka dengan statistik mengejutkan tentang keuangan orang Indonesia. Body: jelaskan dampak + solusi.'
    },
    before_after: {
      instagram: `Format Instagram:
- Hook: Pain point yang relatable. Contoh: "Gaji 8jt tapi saldo selalu 0 di tanggal 15..."
- Body: Ceritakan transformasi: BEFORE (masalah) → AFTER (solusi MoneyQ)
- Pakai storytelling, emosional
- CTA: Ajakan coba MoneyQ`,
      threads: `Format Threads (500 char max):
- Format: "Sebelum vs Sesudah"
- Sebelum: 2-3 poin masalah
- Sesudah: 2-3 poin hasil
- CTA: "Mulai perubahan di moneyq.id"`,
      default: 'Ceritakan transformasi dari kondisi keuangan buruk ke baik. Hook: relatable pain point.'
    },
    challenge: {
      instagram: `Format Instagram:
- Hook: Tantangan playful. Contoh: "CHALLENGE: Gak jajan selama 7 hari. Berani?"
- Body: Rules challenge + benefit + deadline
- Ajak audience ikut serta
- CTA: "Tag temen lo yang perlu ikutan!"`,
      threads: `Format Threads (500 char max):
- Hook: "🚨 CHALLENGE: [nama challenge]"
- Body: Rules singkat (3 poin)
- Target: 7 hari
- CTA: "Siap ikut? Mulai dari moneyq.id"`,
      default: 'Buat challenge seru seputar hemat/keuangan. Hook: tantang pembaca dengan nada playful.'
    },
    behind_product: {
      instagram: `Format Instagram:
- Hook: "Pernah ngalamin [pain point]? Gue juga dulu gitu."
- Body: Jelaskan fitur MoneyQ sebagai solusi (Recovery Plan / Mentor Wise / Sheets Sync)
- Fokus ke benefit, bukan fitur teknis
- CTA: "Coba gratis di moneyq.id"`,
      threads: `Format Threads (500 char max):
- Hook: Pain point dalam 1 kalimat
- Body: Solusi = fitur MoneyQ (2-3 poin)
- CTA: Link ke moneyq.id`,
      default: 'Jelaskan fitur MoneyQ dengan angle user problem. Hook: "Pernah ngalamin [pain]?"'
    },
  };

  const pillarTemplates = templates[pillar] || templates.tips_hemat;
  return pillarTemplates[platform] || pillarTemplates.default || pillarTemplates.instagram;
}
