import { Router } from 'express';
import { validateEnabled, validateHomeId } from '../validation.js';

function responseBody(homeId, setting) {
  return {
    home_id: homeId,
    enabled: setting.enabled,
    content_selection_scope: setting.contentSelectionScope,
  };
}

export function createSafetyCareRouter(repository) {
  const router = Router();
  router.get('/settings', async (request, response, next) => {
    try {
      const homeId = validateHomeId(request.query.home_id);
      response.json(responseBody(homeId, await repository.getOrDefault(homeId)));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/settings', async (request, response, next) => {
    try {
      const homeId = validateHomeId(request.body?.home_id);
      const enabled = validateEnabled(request.body?.enabled);
      response.json(responseBody(homeId, await repository.setEnabled(homeId, enabled)));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
