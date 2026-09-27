import test from 'node:test';
import assert from 'node:assert/strict';
import { SafetyCareRepository } from '../src/repositories/safetyCareRepository.js';

test('행이 없을 때 기본값을 반환하고 INSERT하지 않는다', async () => {
  const queries = [];
  const repository = new SafetyCareRepository({
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 0, rows: [] };
    },
  });
  const result = await repository.getOrDefault('home_23');
  assert.equal(result.enabled, false);
  assert.equal(result.contentSelectionScope, 'YOUTUBE_ONLY');
  assert.equal(queries.length, 1);
  assert.equal(queries[0].sql.includes('INSERT'), false);
});

test('ON에서 YouTube 콘텐츠가 없으면 ROLLBACK하고 UPSERT하지 않는다', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM public.preferred_content')) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const repository = new SafetyCareRepository({ async connect() { return client; } });
  await assert.rejects(repository.setEnabled('home_23', true), (error) => error.code === 'youtube_content_required');
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO public.safety_care')), false);
  assert.equal(queries.includes('ROLLBACK'), true);
});

test('최초 ON UPSERT는 충돌 시 기존 표현과 scope를 수정하지 않는다', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM public.preferred_content')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('INSERT INTO public.safety_care')) {
        return { rowCount: 1, rows: [{
          is_enabled: true,
          anger_expressions: ['기존 표현'],
          content_selection_scope: 'ALL_CONTENT',
        }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const repository = new SafetyCareRepository({ async connect() { return client; } });
  const result = await repository.setEnabled('home_23', true);
  const upsert = queries.find((sql) => sql.includes('INSERT INTO public.safety_care'));
  assert.match(upsert, /SET is_enabled = EXCLUDED\.is_enabled/);
  assert.equal(upsert.includes('anger_expressions ='), false);
  assert.deepEqual(result.angerExpressions, ['기존 표현']);
  assert.equal(result.contentSelectionScope, 'ALL_CONTENT');
});

test('OFF는 요청한 생활자의 is_enabled만 변경한다', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE public.safety_care')) {
        return { rowCount: 1, rows: [{
          is_enabled: false,
          anger_expressions: ['기존 표현'],
          content_selection_scope: 'YOUTUBE_ONLY',
        }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const repository = new SafetyCareRepository({ async connect() { return client; } });
  const result = await repository.setEnabled('home_23', false);
  const update = calls.find(({ sql }) => sql.includes('UPDATE public.safety_care'));
  assert.deepEqual(update.params, ['home_23']);
  assert.match(update.sql, /WHERE resident_thinq_id = \$1/);
  assert.equal(result.enabled, false);
  assert.deepEqual(result.angerExpressions, ['기존 표현']);
});
