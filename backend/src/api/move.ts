import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { buildMove, finishMove, quoteMove } from '../services/move';
import { amountSchema, handleError, publicKeySchema } from './deposit';

const router = Router();

const moveSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    amount: amountSchema.optional(), // left out with all: the whole position
    all: z.boolean().optional(),
    userPublicKey: publicKeySchema,
  })
  .refine((body) => body.all || body.amount !== undefined, 'Enter an amount to move');

const finishSchema = moveSchema.and(z.object({ signature: z.string().min(64).max(100) }));

/**
 * POST /api/move/quote
 * What moving a position into another route costs and earns: both ends in the routes' token, the APYs and when the
 * new APY makes the cost back
 */
router.post('/quote', async (req: Request, res: Response) => {
  try {
    const quote = await quoteMove(moveSchema.parse(req.body));
    return res.json({ success: true, data: quote });
  } catch (error) {
    return handleError(res, error, 'quote move');
  }
});

/**
 * POST /api/move/build
 * The first transaction to sign: the whole move when it is one swap, or the withdrawal (step 1 of 2)
 */
router.post('/build', async (req: Request, res: Response) => {
  try {
    const result = await buildMove(moveSchema.parse(req.body));
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'build move');
  }
});

/**
 * POST /api/move/finish
 * Step 2 of a two-step move: the deposit of what step 1 paid into the wallet, read from its confirmed transaction
 */
router.post('/finish', async (req: Request, res: Response) => {
  try {
    const result = await finishMove(finishSchema.parse(req.body));
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'finish move');
  }
});

export default router;
