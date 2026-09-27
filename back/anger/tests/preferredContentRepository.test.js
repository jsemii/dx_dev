import test from 'node:test';
import assert from 'node:assert/strict';
import { PreferredContentRepository } from '../src/repositories/preferredContentRepository.js';

test('생활자의 YouTube 콘텐츠만 무작위 조회하고 이미지와 다른 생활자를 SQL에서 제외한다', async () => {
  let captured;
  const repository = new PreferredContentRepository({
    async query(sql, params) {
      captured = { sql, params };
      return {
        rowCount: 1,
        rows: [{
          content_id: '11111111-1111-4111-8111-111111111111',
          content_name: '선호 영상',
          content_url: 'https://youtu.be/dQw4w9WgXcQ',
        }],
      };
    },
  });
  const result = await repository.randomYoutube('home_23');
  assert.deepEqual(captured.params, ['home_23']);
  assert.match(captured.sql, /resident_thinq_id = \$1/);
  assert.match(captured.sql, /content_type = CAST\('YOUTUBE'/);
  assert.match(captured.sql, /ORDER BY random\(\)/);
  assert.equal(result.contentName, '선호 영상');
});
