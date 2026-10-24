import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { primaryName } from '../services/names';

const router = Router();

/**
 * GET /api/names/:address
 * The wallet's main AllDomains name ("duke.abc"), or null when it has none
 */
router.get('/:address', async (req: Request, res: Response) => {
  let address: string;
  try {
    address = new PublicKey(req.params.address).toBase58();
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid wallet address' });
  }
  const name = await primaryName(address);
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ success: true, name });
});

export default router;
