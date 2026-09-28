import { SAFETY_CARE_HOME_ID } from './safetyCareApi.mjs';

export const CANONICAL_PLAYER_PATH = '/player';

function locationSuffix(search = '', hash = '') {
  return `${String(search || '')}${String(hash || '')}`;
}

export function resolvePlayerRoute(pathname, search = '', hash = '') {
  const path = String(pathname || '');
  const canonicalUrl = `${CANONICAL_PLAYER_PATH}${locationSuffix(search, hash)}`;

  if (path === CANONICAL_PLAYER_PATH) {
    return { kind: 'PLAYER', homeId: SAFETY_CARE_HOME_ID };
  }
  if (path === `${CANONICAL_PLAYER_PATH}/`) {
    return { kind: 'REDIRECT', url: canonicalUrl };
  }

  const legacy = path.match(/^\/player\/([A-Za-z0-9_-]+)\/?$/);
  if (legacy) {
    return legacy[1] === SAFETY_CARE_HOME_ID
      ? { kind: 'REDIRECT', url: canonicalUrl }
      : { kind: 'NOT_FOUND' };
  }
  if (path.startsWith(`${CANONICAL_PLAYER_PATH}/`)) {
    return { kind: 'NOT_FOUND' };
  }
  return { kind: 'GUARDIAN' };
}
