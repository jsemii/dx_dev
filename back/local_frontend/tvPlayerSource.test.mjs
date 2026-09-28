import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const componentUrl = new URL('./TvPlayerPage.jsx', import.meta.url);
const mainUrl = new URL('./main.jsx', import.meta.url);
const playerMainUrl = new URL('./playerMain.jsx', import.meta.url);
const cssUrl = new URL('./tv-player.css', import.meta.url);
const nginxUrl = new URL('../../deploy/integrated_front/nginx.conf', import.meta.url);

test('/player 경로는 보호자 main 대신 Player 전용 entry만 로드한다', async () => {
  const source = await readFile(mainUrl, 'utf8');
  assert.match(source, /resolvePlayerRoute/);
  assert.match(source, /playerRoute\.kind === 'PLAYER'/);
  assert.match(source, /import\('\.\/playerMain\.jsx'\)/);
  assert.match(source, /else[\s\S]*import\('\.\.\/\.\.\/frontend\/frontend\/src\/main\.jsx'\)/);
});

test('기존 Player 주소는 replace redirect하고 잘못된 생활자 경로는 404로 차단한다', async () => {
  const source = await readFile(mainUrl, 'utf8');
  assert.match(source, /window\.location\.replace\(playerRoute\.url\)/);
  assert.match(source, /playerRoute\.kind === 'NOT_FOUND'/);
  assert.match(source, /올바르지 않은 Player 주소입니다/);
});

test('Player entry는 production에서도 전용 CSS를 직접 적용한다', async () => {
  const source = await readFile(playerMainUrl, 'utf8');
  assert.match(source, /SAFETY_CARE_HOME_ID/);
  assert.match(source, /import playerCss from '\.\/tv-player\.css\?inline'/);
  assert.match(source, /nulbom-tv-player-style/);
  assert.match(source, /style\.textContent = playerCss/);
});

test('Player는 고정 생활자로 pairing과 WebSocket REGISTER를 수행한다', async () => {
  const mainSource = await readFile(playerMainUrl, 'utf8');
  const componentSource = await readFile(componentUrl, 'utf8');
  assert.match(mainSource, /homeId=\{SAFETY_CARE_HOME_ID\}/);
  assert.match(componentSource, /pairPlayer\(fetch, homeId, pairingCode\.trim\(\)\)/);
  assert.match(componentSource, /send\(\{ type: 'REGISTER', home_id: homeId \}\)/);
});

test('Nginx는 exact /player와 기존 하위 Player 경로를 SPA로 전달한다', async () => {
  const source = await readFile(nginxUrl, 'utf8');
  assert.match(source, /location = \/player \{\s*try_files \/index\.html =404;/);
  assert.match(source, /location \^~ \/player\/ \{\s*try_files \$uri \$uri\/ \/index\.html;/);
});

test('Player는 검은 전체 화면이며 READY에서 안내와 커서를 숨긴다', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /:root, body, #root[^}]*background: #000/);
  assert.match(css, /\.tv-player--cursor-hidden[^}]*cursor: none/);
  assert.match(css, /\.tv-player__video[^}]*opacity: 0/);
  assert.match(css, /\.tv-player--playing \.tv-player__video[^}]*opacity: 1/);
});

test('Player는 같은 IFrame에서 0초 재생하고 외부 창 fallback을 만들지 않는다', async () => {
  const source = await readFile(componentUrl, 'utf8');
  assert.match(source, /loadVideoById\(\{ videoId: command\.video_id, startSeconds: 0 \}\)/);
  assert.match(source, /decidePlayCommand/);
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\('debug'\) === '1'/);
  assert.doesNotMatch(source, /window\.open|target=['"]_blank|youtube\.com\/watch/);
});

test('준비 클릭 전 READY를 전송하지 않고 준비 완료 후에만 등록한다', async () => {
  const source = await readFile(componentUrl, 'utf8');
  const prepare = source.match(/const prepare = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[/)?.[0] || '';
  assert.match(prepare, /loadYouTubeApi\(\), connectSocket\(\)/);
  assert.match(prepare, /createYouTubePlayer/);
  assert.match(prepare, /prepared\.current = true/);
  assert.match(prepare, /announceReady\(\)/);
  assert.match(source, /requestFullscreen/);
  assert.match(source, /wakeLock/);
});

test('잘못된 pairing code 뒤에도 입력을 고쳐 다시 시도할 수 있다', async () => {
  const source = await readFile(componentUrl, 'utf8');
  assert.match(source, /setState\(paired \? TV_PLAYER_STATE\.ERROR : TV_PLAYER_STATE\.SETUP\)/);
  assert.match(source, /tv-player__setup-error/);
});
