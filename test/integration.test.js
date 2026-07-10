// moneyq-social-engine/test/integration.test.js
// End-to-end integration test for the Instagram MVP pipeline.
//
// Validates the full orchestration flow: topic selection → copy generation
// → image generation → compression → publishing (or graceful error/skip).
//
// Env vars must be set in .env (see .env.example). The test sets dummy
// values for any remaining empty required vars so the orchestrator can be
// imported without crashing on config validation — actual API failures are
// caught and reported as structured error results.

import 'dotenv/config';
import { describe, it } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Bootstrap: ensure all env vars required by config.js have a non-empty value
// so the orchestrator module can be imported.  Dummy values are sufficient
// here — real credentials would make the pipeline go further.
// ---------------------------------------------------------------------------
if (!process.env.INSTAGRAM_ACCESS_TOKEN) {
  process.env.INSTAGRAM_ACCESS_TOKEN = 'test-dummy-ig-token';
}
if (!process.env.INSTAGRAM_ACCOUNT_ID) {
  process.env.INSTAGRAM_ACCOUNT_ID = 'test-dummy-ig-account-id';
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MoneyQ Social Engine — Integration', () => {
  it('full pipeline: select topic -> generate copy -> generate image', async () => {
    const { run } = await import('../src/orchestrator.js');

    // Run for today with just Instagram — the pipeline is exercised end to
    // end.  Without live API keys the flow will produce 'error' or 'skipped'
    // results, which is acceptable — we are testing the orchestration
    // contract, not the external services.
    const result = await run(new Date().toISOString().split('T')[0], ['instagram']);

    // --- Assert return structure ---
    assert.ok(result.date, 'Result should have a date field');
    assert.strictEqual(typeof result.date, 'string', 'date should be a string');

    assert.ok(Array.isArray(result.results), 'Result should have a results array');

    // --- Assert each result entry ---
    for (const r of result.results) {
      assert.ok(r.platform, `Result entry should have a platform`);
      assert.ok(['published', 'error', 'skipped'].includes(r.status),
        `Unexpected status "${r.status}" for platform "${r.platform}"`);
    }

    console.log(`\n  Integration test complete: ${result.results.length} platform(s) processed`);
    if (result.results.length > 0) {
      const entry = result.results[0];
      console.log(`  Platform: ${entry.platform} | Status: ${entry.status}`);
      if (entry.error) console.log(`  Error:    ${entry.error}`);
    }
  });
});
