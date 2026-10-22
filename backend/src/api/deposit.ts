import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { z } from 'zod';
import { logger } from '../utils/logger';
import depositService, { DepositError } from '../services/deposit';
import { solanaNetwork } from '../config/runtime';

const router = Router();

const amountSchema = z.union([z.string(), z.number()])
  .refine((value) => /^\d+(\.\d+)?$/.test(String(value)) && Number(value) > 0, 'Amount must be a positive number');

const quoteSchema = z.object({
  protocol: z.string().min(1),
  inputToken: z.string().min(1),
  amount: amountSchema,
  slippageBps: z.number().int().min(1).max(300).optional(),
});

const buildSchema = quoteSchema.extend({
  userPublicKey: z.string().refine((value) => {
    try {
      new PublicKey(value);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid wallet address'),
});

function handleError(res: Response, error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, error: error.errors[0]?.message || 'Invalid request' });
  }
  if (error instanceof DepositError) {
    return res.status(error.status).json({ success: false, error: error.message });
  }
  if (axios.isAxiosError(error) && error.response) {
    logger.warn(`Jupiter API error while trying to ${action}: ${error.response.status} ${JSON.stringify(error.response.data)}`);
    const status = error.response.status === 429 ? 503 : 502;
    const message = error.response.data?.error || 'Swap provider is unavailable. Try again shortly.';
    return res.status(status).json({ success: false, error: message });
  }

  logger.error(`Failed to ${action}:`, error);
  return res.status(500).json({ success: false, error: `Failed to ${action}` });
}

/**
 * GET /api/deposit/supported?inputToken=SOL
 * Protocols that Hermes can deposit into directly from the given token
 */
router.get('/supported', (req: Request, res: Response) => {
  const inputToken = String(req.query.inputToken || 'SOL');
  const data = depositService.getSupportedProtocols(inputToken);

  return res.json({
    success: true,
    network: solanaNetwork(),
    count: data.length,
    data,
  });
});

/**
 * POST /api/deposit/quote
 * Quote a deposit route without building a transaction
 */
router.post('/quote', async (req: Request, res: Response) => {
  try {
    const request = quoteSchema.parse(req.body);
    const quote = await depositService.getQuote(request);

    return res.json({
      success: true,
      data: quote,
    });
  } catch (error) {
    return handleError(res, error, 'quote deposit');
  }
});

/**
 * POST /api/deposit/build
 * Build an unsigned deposit transaction for the user's wallet to sign and send
 */
router.post('/build', async (req: Request, res: Response) => {
  try {
    const { userPublicKey, ...request } = buildSchema.parse(req.body);
    const result = await depositService.buildTransaction(request, userPublicKey);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleError(res, error, 'build deposit transaction');
  }
});

export default router;
