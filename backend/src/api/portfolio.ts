import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { getPortfolio } from '../services/portfolio';

const router = Router();

/**
 * GET /api/portfolio/:address
 * What the wallet holds in each route Hermes lists, what it is worth and what it has earned. ?fresh=1 reads it again
 * instead of the minute-old answer: the refresh button, and right after a transaction.
 */
router.get('/:address', async (req: Request, res: Response) => {
  let address: string;
  try {
    address = new PublicKey(req.params.address).toBase58();
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid wallet address' });
  }
  try {
    const portfolio = await getPortfolio(address, req.query.fresh === '1');
    // Never kept by the browser: a refresh must reach the API
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, portfolio });
  } catch (error) {
    logger.warn(`Portfolio failed for ${address}: ${error instanceof Error ? error.message : error}`);
    return res.status(502).json({ success: false, error: "Your positions didn't load. Try again." });
  }
});

export default router;
