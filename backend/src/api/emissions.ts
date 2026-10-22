import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { 
  getProtocolEmissions, 
  calculateTotalAPRBoost,
  hasActiveEmissions,
  PROTOCOL_EMISSIONS 
} from '../config/protocolEmissions';

const router = Router();

/**
 * GET /api/emissions
 * Get emission schedules and incentive programs for all protocols
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { protocol, active_only } = req.query;

    let emissions = Object.values(PROTOCOL_EMISSIONS);

    // Filter by protocol if specified
    if (protocol) {
      emissions = emissions.filter(e => e.protocol === protocol);
    }

    // Filter by active emissions only
    if (active_only === 'true') {
      emissions = emissions.filter(e => hasActiveEmissions(e.protocol));
    }

    // Add computed fields
    const enrichedEmissions = emissions.map(e => ({
      ...e,
      totalAPRBoost: calculateTotalAPRBoost(e.protocol),
      isActive: hasActiveEmissions(e.protocol),
    }));

    return res.json({
      success: true,
      count: enrichedEmissions.length,
      data: enrichedEmissions,
    });
  } catch (error) {
    logger.error('Error fetching emissions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch emissions',
    });
  }
});

/**
 * GET /api/emissions/:protocol
 * Get emission schedule and incentives for a specific protocol
 */
router.get('/:protocol', async (req: Request, res: Response) => {
  try {
    const { protocol } = req.params;
    
    const emissions = getProtocolEmissions(protocol);
    
    if (!emissions) {
      return res.status(404).json({
        success: false,
        error: `Protocol ${protocol} not found`,
      });
    }

    const enriched = {
      ...emissions,
      totalAPRBoost: calculateTotalAPRBoost(protocol),
      isActive: hasActiveEmissions(protocol),
    };

    return res.json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    logger.error(`Error fetching emissions for ${req.params.protocol}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch protocol emissions',
    });
  }
});

/**
 * GET /api/emissions/summary/active
 * Get summary of all active emission programs
 */
router.get('/summary/active', async (_req: Request, res: Response) => {
  try {
    const activeProtocols = Object.keys(PROTOCOL_EMISSIONS)
      .filter(p => hasActiveEmissions(p))
      .map(p => {
        const config = PROTOCOL_EMISSIONS[p];
        return {
          protocol: p,
          token: config.emissionSchedule?.token,
          dailyRate: config.emissionSchedule?.dailyRate,
          aprBoost: calculateTotalAPRBoost(p),
          vestingEnd: config.emissionSchedule?.vestingEnd,
          incentiveCount: config.incentivePrograms.filter(i => i.active).length,
        };
      });

    return res.json({
      success: true,
      count: activeProtocols.length,
      totalDailyEmissions: activeProtocols.reduce((sum, p) => sum + (p.dailyRate || 0), 0),
      data: activeProtocols,
    });
  } catch (error) {
    logger.error('Error fetching active emissions summary:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch emissions summary',
    });
  }
});

/**
 * GET /api/emissions/incentives/all
 * Get all active incentive programs across protocols
 */
router.get('/incentives/all', async (_req: Request, res: Response) => {
  try {
    const allIncentives: any[] = [];

    Object.entries(PROTOCOL_EMISSIONS).forEach(([protocol, config]) => {
      config.incentivePrograms
        .filter(i => i.active)
        .forEach(incentive => {
          allIncentives.push({
            protocol,
            ...incentive,
          });
        });
    });

    // Sort by estimated value
    allIncentives.sort((a, b) => b.estimatedValue - a.estimatedValue);

    return res.json({
      success: true,
      count: allIncentives.length,
      data: allIncentives,
    });
  } catch (error) {
    logger.error('Error fetching incentives:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch incentives',
    });
  }
});

export default router;
