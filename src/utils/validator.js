// moneyq-social-engine/src/utils/validator.js
// Content validation — platform limits, structure checks, blacklist scanning

const LIMITS = {
  instagram: { captionMax: 2200, hashtagMax: 30 },
  threads: { bodyMax: 500, hashtagMax: 10 },
  tiktok: { captionMax: 2200 },
  youtube: { titleMax: 100, descriptionMax: 5000 },
};

const BLACKLIST = ['pinjol', 'judol', 'scam'];

/**
 * Validate content copy for a target platform.
 * Checks hook/body length, platform-specific limits, and scans for blacklisted words.
 *
 * @param {{ hook: string, body: string, hashtags?: string[] }} copy - Content to validate
 * @param {string} platform - Target platform key (instagram, threads, tiktok, youtube)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateContent(copy, platform) {
  const errors = [];
  const limits = LIMITS[platform];

  if (!limits) {
    errors.push(`Platform tidak dikenal: "${platform}"`);
    return { valid: false, errors };
  }

  // --- Structural checks ---
  if (!copy.hook || copy.hook.length < 5) {
    errors.push('Hook terlalu pendek (min 5 karakter)');
  }

  if (!copy.body || copy.body.length < 20) {
    errors.push('Body terlalu pendek (min 20 karakter)');
  }

  // --- Platform-specific length limits ---
  if (limits.captionMax && copy.body?.length > limits.captionMax) {
    errors.push(`Body terlalu panjang (${copy.body.length}/${limits.captionMax})`);
  }

  if (limits.titleMax && copy.hook?.length > limits.titleMax) {
    errors.push(`Title terlalu panjang (${copy.hook.length}/${limits.titleMax})`);
  }

  if (limits.descriptionMax && copy.body?.length > limits.descriptionMax) {
    errors.push(`Deskripsi terlalu panjang (${copy.body.length}/${limits.descriptionMax})`);
  }

  if (limits.hashtagMax && copy.hashtags?.length > limits.hashtagMax) {
    errors.push(`Terlalu banyak hashtag (${copy.hashtags.length}/${limits.hashtagMax})`);
  }

  // --- Blacklisted words check ---
  const textToCheck = [copy.hook || '', copy.body || ''].join(' ').toLowerCase();
  for (const word of BLACKLIST) {
    if (textToCheck.includes(word)) {
      errors.push(`Mengandung kata terlarang: "${word}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export { LIMITS, BLACKLIST };
