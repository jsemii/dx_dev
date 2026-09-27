import React from 'react';
import { createRoot } from 'react-dom/client';
import TvPlayerPage from './TvPlayerPage.jsx';
import { homeIdFromPlayerPath } from './tvPlayerProtocol.mjs';
import playerCss from './tv-player.css?inline';

// Keep the Player stylesheet owned by this entry. Vite may not preload CSS
// that belongs only to one branch of the dynamic entry selection.
if (!document.getElementById('nulbom-tv-player-style')) {
  const style = document.createElement('style');
  style.id = 'nulbom-tv-player-style';
  style.textContent = playerCss;
  document.head.append(style);
}

const homeId = homeIdFromPlayerPath(window.location.pathname);
createRoot(document.getElementById('root')).render(<TvPlayerPage homeId={homeId} />);
