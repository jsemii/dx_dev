import { Router } from 'express';
import multer from 'multer';
import { MAX_AUDIO_BYTES, validateAudio } from '../audioValidation.js';
import { validateHomeId, validateUuid } from '../validation.js';

export function createAngerAnalysisRouter({ analysisService, sessionCache }) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 4 },
  });

  router.post('/analyze', upload.single('audio'), async (request, response, next) => {
    try {
      const homeId = validateHomeId(request.body?.home_id);
      const sessionId = validateUuid(request.body?.session_id, 'session_id');
      const format = validateAudio(request.file);
      const result = await sessionCache.run(`${homeId}:${sessionId}`, () => analysisService.analyze({
        homeId,
        buffer: request.file.buffer,
        format,
      }));
      response.json(result);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
