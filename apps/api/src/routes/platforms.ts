import { Router } from 'express';
import { enabledProfiles, loadPlatformConfig } from '../services/platform-config.js';

const platformConfig = loadPlatformConfig();

export const platformsRouter: Router = Router();

platformsRouter.get('/platforms', (_req, res) => {
  res.json({
    enabled: platformConfig.enabled,
    adapters: platformConfig.adapters,
    profiles: enabledProfiles(platformConfig),
  });
});
