import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { walletName } from '../services/names';

const router = Router();

/**
 * GET /api/names/:address
 * The name the wallet goes by: its SNS primary name ("alpharobin") or AllDomains main domain ("fatcat.wen"),
 * or null when it has neither
 */
router.get('/:address', async (req: Request, res: Response) => {
  let address: string;
  try {
    address = new PublicKey(req.params.address).toBase58();
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid wallet address' });
  }
  const found = await walletName(address);
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ success: true, name: found?.name ?? null, service: found?.service ?? null });
});

export default router;
