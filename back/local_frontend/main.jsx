const playerRoute = window.location.pathname.match(/^\/player\/([A-Za-z0-9_-]+)\/?$/);

if (playerRoute) {
  import('./playerMain.jsx');
} else {
  // Run the teammate's actual App and its original navigation/layout.
  import('../../frontend/frontend/src/main.jsx');
}
