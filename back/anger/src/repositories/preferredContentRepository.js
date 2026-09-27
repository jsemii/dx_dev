import { unavailable } from '../errors.js';

export class PreferredContentRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async randomYoutube(homeId) {
    try {
      const result = await this.pool.query(
        `SELECT content_id, content_name, content_url
           FROM public.preferred_content
          WHERE resident_thinq_id = $1
            AND content_type = CAST('YOUTUBE' AS public.content_type_enum)
            AND content_url IS NOT NULL
            AND btrim(content_url) <> ''
          ORDER BY random()
          LIMIT 1`,
        [homeId],
      );
      if (result.rowCount === 0) return null;
      return {
        contentId: String(result.rows[0].content_id),
        contentName: result.rows[0].content_name,
        contentUrl: result.rows[0].content_url,
      };
    } catch (error) {
      throw unavailable('preferred_content_unavailable', '선호 콘텐츠 저장소를 사용할 수 없습니다.', error);
    }
  }
}
