import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { solanaNetwork } from '../config/runtime';
import { InputToken, TOKENS } from '../registry/routes';
import { getYieldRoutes } from '../services/yields';

const router = Router();

/**
 * GET /api/yields?token=SOL
 * Live yield routes Hermes can deposit into, highest APY first. `token` filters by what the user deposits.
 * `all=true` adds the view-only routes the site hides for now.
 */
router.get('/', async (req: Request, res: Response) => {
  const token = req.query.token ? String(req.query.token).toUpperCase() : undefined;
  if (token && !(token in TOKENS)) {
    return res.status(400).json({ success: false, error: `Unsupported token: ${token}` });
  }

  try {
    const data = await getYieldRoutes(token as InputToken | undefined, req.query.all === 'true' || undefined);
    return res.json({
      success: true,
      network: solanaNetwork(),
      count: data.length,
      data,
    });
  } catch (error) {
    logger.error('Error fetching yields:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch yields' });
  }
});

export default router;
