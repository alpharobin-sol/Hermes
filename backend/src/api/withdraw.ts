import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { buildWithdrawal, quoteWithdrawal } from '../services/withdraw';
import { amountSchema, handleError, publicKeySchema } from './deposit';

const router = Router();

const withdrawSchema = z
  .object({
    routeId: z.string().min(1),
    amount: amountSchema.optional(), // left out with all: the whole position
    all: z.boolean().optional(),
    userPublicKey: publicKeySchema,
  })
  .refine((body) => body.all || body.amount !== undefined, 'Enter an amount to withdraw');

/**
 * POST /api/withdraw/quote
 * What a withdrawal from the wallet's position returns, and how much the position and the reserve allow
 */
router.post('/quote', async (req: Request, res: Response) => {
  try {
    const quote = await quoteWithdrawal(withdrawSchema.parse(req.body));
    return res.json({ success: true, data: quote });
  } catch (error) {
    return handleError(res, error, 'quote withdrawal');
  }
});

/**
 * POST /api/withdraw/build
 * Build an unsigned withdrawal transaction for the user's wallet to sign and send
 */
router.post('/build', async (req: Request, res: Response) => {
  try {
    const result = await buildWithdrawal(withdrawSchema.parse(req.body));
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'build withdrawal');
  }
});

export default router;
