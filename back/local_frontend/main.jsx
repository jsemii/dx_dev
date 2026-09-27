import { resolvePlayerRoute } from './playerRoute.mjs';

const playerRoute = resolvePlayerRoute(
  window.location.pathname,
  window.location.search,
  window.location.hash,
);

if (playerRoute.kind === 'REDIRECT') {
  window.location.replace(playerRoute.url);
} else if (playerRoute.kind === 'PLAYER') {
  import('./playerMain.jsx');
} else if (playerRoute.kind === 'NOT_FOUND') {
  document.title = 'Player 경로 오류';
  document.documentElement.style.background = '#000';
  document.body.style.margin = '0';
  document.body.style.background = '#000';
  document.getElementById('root').innerHTML = `
    <main role="alert" style="min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;font-family:sans-serif;text-align:center">
      <div><h1>404</h1><p>올바르지 않은 Player 주소입니다.</p></div>
    </main>
  `;
} else {
  // Run the teammate's actual App and its original navigation/layout.
  import('../../frontend/frontend/src/main.jsx');
}
