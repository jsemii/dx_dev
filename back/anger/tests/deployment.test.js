import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const composeUrl = new URL('../../../deploy/integrated_player.compose.yml', import.meta.url);

test('통합 배포 구성은 메모리 상태를 사용하는 Anger replica를 1개로 고정한다', async () => {
  const compose = await readFile(composeUrl, 'utf8');
  const angerService = compose.match(/  anger:\n[\s\S]*?(?=\n  integrated-front:)/)?.[0] || '';
  assert.match(angerService, /\n    deploy:\n      replicas: 1\n/);
});
