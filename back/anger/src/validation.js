import { badRequest } from './errors.js';

const HOME_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateHomeId(value) {
  if (typeof value !== 'string' || !HOME_ID_PATTERN.test(value)) {
    throw badRequest('invalid_home_id', '생활자 ID 형식이 올바르지 않습니다.');
  }
  return value;
}

export function validateUuid(value, fieldName = 'UUID') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw badRequest('invalid_uuid', `${fieldName} 형식이 올바르지 않습니다.`);
  }
  return value.toLowerCase();
}

export function validateEnabled(value) {
  if (typeof value !== 'boolean') {
    throw badRequest('invalid_enabled', 'enabled는 boolean 값이어야 합니다.');
  }
  return value;
}

export function parseYouTubeUrl(input) {
  try {
    if (typeof input !== 'string' || !input.trim()) return null;
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    let videoId = '';
    if (hostname === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (hostname === 'youtube.com') {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
      else videoId = url.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/)?.[1] || '';
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    return {
      videoId,
      normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch {
    return null;
  }
}
