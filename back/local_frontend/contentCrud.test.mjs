import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { forwardContentSaveError } from './contentUploadErrors.mjs';

test('local content bridge sends rename and delete to the backend', () => {
  const source = readFileSync('./LocalPreferredContentPage.jsx', 'utf8');
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /home_id: DEFAULT_HOME_ID/);
  assert.match(source, /onUpdateContent=\{updateContent\}/);
  assert.match(source, /onDeleteContent=\{deleteContent\}/);
});

test('upstream page waits for saved content and confirms permanent deletion', () => {
  const source = readFileSync(realpathSync('../../frontend/frontend/src/PreferredContentPage.jsx'), 'utf8');
  const transformed = forwardContentSaveError(source);
  assert.match(transformed, /const savedContent = await onSubmitContent/);
  assert.match(transformed, /savedContent \|\| content/);
  assert.match(transformed, /window\.confirm\('이 콘텐츠를 영구 삭제할까요\?'\)/);
});
