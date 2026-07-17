// moneyq-social-engine/src/utils/config.js

const required = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  INSTAGRAM_ACCESS_TOKEN: process.env.INSTAGRAM_ACCESS_TOKEN,
  INSTAGRAM_ACCOUNT_ID: process.env.INSTAGRAM_ACCOUNT_ID,
};

// Validate required env vars
const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

export const config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || null,
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || null,
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || null,
  },
  huggingface: {
    apiToken: process.env.HF_API_TOKEN || null,
    model: 'playgroundai/playground-v2.5-1024px-aesthetic',
  },
  pexels: {
    apiKey: process.env.PEXELS_API_KEY || null,
  },
  seedance: {
    apiKey: process.env.SEEDANCE_API_KEY || null,
    baseUrl: 'https://api.seedance2.ai',
    model: 'seedance-2-0-mini',
    resolution: '480p',
    duration: 12,
    aspectRatio: '9:16',
    dailyBudget: 72, // 2 videos × 36 credits
  },
  vidu: {
    apiKey: process.env.VIDU_API_KEY || null,
    baseUrl: process.env.VIDU_API_BASE_URL || 'https://api.vidu.com',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },
  platforms: {
    instagram: {
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
      accountId: process.env.INSTAGRAM_ACCOUNT_ID,
    },
    tiktok: {
      accessToken: process.env.TIKTOK_ACCESS_TOKEN || null,
      openId: process.env.TIKTOK_OPEN_ID || null,
    },
    youtube: {
      clientId: process.env.YOUTUBE_CLIENT_ID || null,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET || null,
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || null,
    },
    threads: {
      accessToken: process.env.THREADS_ACCESS_TOKEN || null,
      userId: process.env.THREADS_USER_ID || null,
    },
  },
  app: {
    url: process.env.MONEYQ_URL || 'https://moneyq.id',
    contentHistoryLimit: parseInt(process.env.CONTENT_HISTORY_LIMIT || '90', 10),
  },
  timezone: 'Asia/Jakarta',
  schedule: {
    instagram: { times: ['07:00', '12:00', '19:00'], maxPerDay: 25 },
    threads: { times: ['08:00', '16:00'], maxPerDay: 25 },
    tiktok: { times: ['06:30', '11:30', '18:30'], maxPerDay: 1500 },
    youtube: { times: ['09:00', '17:00'], maxPerDay: 6 },
  },
};

export default config;
