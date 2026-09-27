import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { createSafetyCareRouter } from './routes/safetyCareRoutes.js';
import { createAngerAnalysisRouter } from './routes/angerAnalysisRoutes.js';
import { createPlaybackStatusRouter } from './routes/playbackStatusRoutes.js';
import { createPlaybackRouter } from './routes/playbackRoutes.js';

export function createApp({
  config, safetyCareRepository, analysisService, playbackClient, sessionCache, logger = console,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('허용되지 않은 Origin입니다.'));
    },
    methods: ['GET', 'PATCH', 'POST', 'OPTIONS'],
  }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.use('/api/safety-care', createSafetyCareRouter(safetyCareRepository));
  app.use('/api/playback', createPlaybackRouter({ config, playbackGateway: playbackClient }));
  app.use('/api/anger', createPlaybackStatusRouter({ playbackClient }));
  app.use('/api/anger', createAngerAnalysisRouter({ analysisService, sessionCache }));

  app.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return response.status(tooLarge ? 413 : 400).json({
        error: {
          code: tooLarge ? 'audio_too_large' : 'invalid_multipart',
          message: tooLarge ? '녹음 파일이 너무 큽니다.' : '녹음 요청 형식이 올바르지 않습니다.',
        },
      });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const code = typeof error?.code === 'string' ? error.code : 'internal_error';
    if (status >= 500) logger.error('Anger API request failed', { code });
    return response.status(status).json({
      error: {
        code,
        message: status >= 500 ? '분노 감지 서비스를 사용할 수 없습니다.' : error.message,
      },
    });
  });
  return app;
}
