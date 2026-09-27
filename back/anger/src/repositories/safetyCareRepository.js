import { DEFAULT_ANGER_EXPRESSIONS } from '../constants/defaultAngerExpressions.js';
import { conflict, unavailable } from '../errors.js';

const DEFAULT_SETTING = Object.freeze({
  enabled: false,
  angerExpressions: DEFAULT_ANGER_EXPRESSIONS,
  contentSelectionScope: 'YOUTUBE_ONLY',
});

function mapRow(row) {
  return {
    enabled: row.is_enabled,
    angerExpressions: Array.isArray(row.anger_expressions) ? row.anger_expressions : [],
    contentSelectionScope: row.content_selection_scope,
  };
}

export class SafetyCareRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async find(homeId) {
    try {
      const result = await this.pool.query(
        `SELECT is_enabled, anger_expressions, content_selection_scope::text AS content_selection_scope
           FROM public.safety_care
          WHERE resident_thinq_id = $1`,
        [homeId],
      );
      return result.rowCount === 0 ? null : mapRow(result.rows[0]);
    } catch (error) {
      throw unavailable('safety_care_unavailable', '안정 돌봄 설정 저장소를 사용할 수 없습니다.', error);
    }
  }

  async getOrDefault(homeId) {
    return (await this.find(homeId)) || { ...DEFAULT_SETTING };
  }

  async setEnabled(homeId, enabled) {
    const client = await this.pool.connect().catch((error) => {
      throw unavailable('safety_care_unavailable', '안정 돌봄 설정 저장소를 사용할 수 없습니다.', error);
    });
    try {
      await client.query('BEGIN');
      if (enabled) {
        const content = await client.query(
          `SELECT 1
             FROM public.preferred_content
            WHERE resident_thinq_id = $1
              AND content_type = CAST('YOUTUBE' AS public.content_type_enum)
              AND content_url IS NOT NULL
              AND btrim(content_url) <> ''
            LIMIT 1`,
          [homeId],
        );
        if (content.rowCount === 0) {
          throw conflict('youtube_content_required', '선호 YouTube 콘텐츠를 먼저 등록해 주세요.');
        }
        const result = await client.query(
          `INSERT INTO public.safety_care
             (resident_thinq_id, is_enabled, anger_expressions, content_selection_scope)
           VALUES ($1, true, $2::jsonb, CAST('YOUTUBE_ONLY' AS public.content_selection_scope_enum))
           ON CONFLICT (resident_thinq_id) DO UPDATE
             SET is_enabled = EXCLUDED.is_enabled
           RETURNING is_enabled, anger_expressions,
                     content_selection_scope::text AS content_selection_scope`,
          [homeId, JSON.stringify(DEFAULT_ANGER_EXPRESSIONS)],
        );
        await client.query('COMMIT');
        return mapRow(result.rows[0]);
      }

      const result = await client.query(
        `UPDATE public.safety_care
            SET is_enabled = false
          WHERE resident_thinq_id = $1
          RETURNING is_enabled, anger_expressions,
                    content_selection_scope::text AS content_selection_scope`,
        [homeId],
      );
      await client.query('COMMIT');
      return result.rowCount === 0 ? { ...DEFAULT_SETTING } : mapRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error?.status) throw error;
      throw unavailable('safety_care_unavailable', '안정 돌봄 설정 저장소를 사용할 수 없습니다.', error);
    } finally {
      client.release();
    }
  }
}
