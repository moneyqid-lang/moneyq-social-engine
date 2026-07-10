// moneyq-social-engine/src/db.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const db = {
  /**
   * Get content calendar entries for a specific date
   * @param {string} date - ISO date string
   * @param {number} limit - max entries to return
   * @returns {Promise<Array>}
   */
  async getCalendarEntries(date, limit = 6) {
    const { data, error } = await supabase
      .from('content_calendar')
      .select('*')
      .eq('scheduled_date', date)
      .eq('status', 'pending')
      .limit(limit)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Calendar query failed: ${error.message}`);
    return data;
  },

  /**
   * Get least recently used copy templates for a pillar+platform combo
   */
  async getLeastUsedTemplates(pillar, platform, limit = 3) {
    const { data, error } = await supabase
      .from('copy_templates')
      .select('*')
      .eq('pillar', pillar)
      .eq('platform', platform)
      .order('usage_count', { ascending: true })
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(limit);

    if (error) throw new Error(`Template query failed: ${error.message}`);
    return data;
  },

  /**
   * Get least used hashtags in given categories
   */
  async getLeastUsedHashtags(categories = ['brand', 'keuangan', 'lifestyle'], limit = 10) {
    const { data, error } = await supabase
      .from('hashtag_pool')
      .select('*')
      .in('category', categories)
      .order('usage_count', { ascending: true })
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(limit);

    if (error) throw new Error(`Hashtag query failed: ${error.message}`);
    return data;
  },

  /**
   * Insert published content into history
   */
  async insertContentHistory(entry) {
    const { data, error } = await supabase
      .from('content_history')
      .insert({
        calendar_id: entry.calendarId,
        platform: entry.platform,
        post_id: entry.postId,
        content_json: entry.contentJson,
        media_urls: entry.mediaUrls || [],
        published_at: entry.publishedAt || new Date().toISOString(),
        status: entry.status || 'published'
      })
      .select()
      .single();

    if (error) throw new Error(`History insert failed: ${error.message}`);
    return data;
  },

  /**
   * Update content calendar entry status
   */
  async updateCalendarStatus(id, status) {
    const { error } = await supabase
      .from('content_calendar')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`Calendar update failed: ${error.message}`);
  },

  /**
   * Update content history entry
   */
  async updateContentStatus(id, status, postId = null) {
    const updates = { status };
    if (postId) updates.post_id = postId;

    const { error } = await supabase
      .from('content_history')
      .update(updates)
      .eq('id', id);

    if (error) throw new Error(`History update failed: ${error.message}`);
  },

  /**
   * Get recent content for deduplication check
   */
  async getRecentContent(platform, days = 90) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabase
      .from('content_history')
      .select('content_json, published_at')
      .eq('platform', platform)
      .gte('published_at', since.toISOString())
      .order('published_at', { ascending: false });

    if (error) throw new Error(`Recent content query failed: ${error.message}`);
    return data;
  },

  /**
   * Get a brand asset by key
   */
  async getBrandAsset(key) {
    const { data, error } = await supabase
      .from('brand_assets')
      .select('*')
      .eq('asset_key', key)
      .single();

    if (error) return null; // asset might not exist yet
    return data;
  },

  /**
   * Increment template usage counter
   */
  async incrementTemplateUsage(templateId) {
    const { error } = await supabase
      .from('copy_templates')
      .update({
        usage_count: supabase.rpc ? undefined : undefined, // handled below
        last_used_at: new Date().toISOString()
      })
      .eq('id', templateId);

    // Use raw SQL to increment since supabase-js doesn't have native increment
    const { error: rpcError } = await supabase.rpc('increment_template_usage', {
      template_id: templateId
    });

    if (rpcError) {
      // Fallback: manual increment
      const { data: current } = await supabase
        .from('copy_templates')
        .select('usage_count')
        .eq('id', templateId)
        .single();

      if (current) {
        await supabase
          .from('copy_templates')
          .update({ usage_count: current.usage_count + 1, last_used_at: new Date().toISOString() })
          .eq('id', templateId);
      }
    }
  },

  /**
   * Increment hashtag usage counter
   */
  async incrementHashtagUsage(tagId) {
    const { data: current } = await supabase
      .from('hashtag_pool')
      .select('usage_count')
      .eq('id', tagId)
      .single();

    if (current) {
      await supabase
        .from('hashtag_pool')
        .update({ usage_count: current.usage_count + 1, last_used_at: new Date().toISOString() })
        .eq('id', tagId);
    }
  }
};

export { supabase };
