import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import type { Marinade, MarinadeState } from '@marinade.finance/marinade-ts-sdk';
import Decimal from 'decimal.js';
import { depositBudgetInstructions } from './compute-budget';
import { DepositError } from './errors';

/**
 * Direct SOL deposits into Marinade liquid staking (mainnet only).
 * mSOL is minted, or taken from Marinade's liquidity pool, at Marinade's mSOL price. There is no slippage.
 *
 * Marinade's SDK builds the deposit instruction. It adds about 45 MB, so it loads on the first Marinade deposit.
 * The token account is created here: the SDK's own lookup uses an indexed RPC call that free RPCs block.
 */

// Marinade stores the mSOL price in SOL as a fixed-point number scaled by 2^32
const PRICE_DENOMINATOR = new Decimal(2).pow(32);

export interface MarinadeDepositPlan {
  outAmount: string; // UI units
  transaction: VersionedTransaction;
  lastValidBlockHeight: number;
}

let marinadeClient: Promise<Marinade> | null = null;

// One SDK client for every deposit. The instruction builder takes the user's key directly.
function getMarinade(connection: Connection): Promise<Marinade> {
  if (!marinadeClient) {
    marinadeClient = import('@marinade.finance/marinade-ts-sdk')
      .then(({ Marinade, MarinadeConfig }) => new Marinade(new MarinadeConfig({ connection })))
      .catch((error) => {
        marinadeClient = null;
        throw error;
      });
  }
  return marinadeClient;
}

// Fresh state on every call: the mSOL price and the paused flag can change
async function loadMarinade(connection: Connection): Promise<{ marinade: Marinade; state: MarinadeState }> {
  const marinade = await getMarinade(connection);
  const state = await marinade.getMarinadeState();

  if (state.state.paused) {
    throw new DepositError('Marinade has paused deposits. Try again later.', 503);
  }
  return { marinade, state };
}

// mSOL for a SOL deposit, mirroring the program's math
function msolForLamports(lamports: Decimal, state: MarinadeState): string {
  const msolPrice = new Decimal(state.state.msolPrice.toString());
  return lamports.mul(PRICE_DENOMINATOR).div(msolPrice).floor().div(1e9).toFixed();
}

function checkMinimum(lamports: Decimal, state: MarinadeState) {
  const minDeposit = new Decimal(state.state.minDeposit.toString());
  if (lamports.lt(minDeposit)) {
    throw new DepositError(`Marinade's minimum deposit is ${minDeposit.div(1e9).toFixed()} SOL`, 422);
  }
}

export async function quoteMarinadeDeposit(connection: Connection, lamports: Decimal): Promise<string> {
  const { state } = await loadMarinade(connection);
  checkMinimum(lamports, state);
  return msolForLamports(lamports, state);
}

export async function buildMarinadeDeposit(connection: Connection, lamports: Decimal, user: PublicKey): Promise<MarinadeDepositPlan> {
  const { BN } = await import('@marinade.finance/marinade-ts-sdk');
  const { marinade, state } = await loadMarinade(connection);
  checkMinimum(lamports, state);

  const msolAccount = getAssociatedTokenAddressSync(state.mSolMintAddress, user);
  const depositInstruction = await marinade.marinadeFinanceProgram.depositInstructionBuilder({
    amountLamports: new BN(lamports.toFixed(0)),
    marinadeState: state,
    transferFrom: user,
    associatedMSolTokenAccountAddress: msolAccount,
  });

  const instructions = [
    ...(await depositBudgetInstructions(connection, [state.marinadeStateAddress, state.mSolMintAddress, state.reserveAddress()])),
    createAssociatedTokenAccountIdempotentInstruction(user, msolAccount, user, state.mSolMintAddress),
    depositInstruction,
  ];

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions }).compileToV0Message();

  return {
    outAmount: msolForLamports(lamports, state),
    transaction: new VersionedTransaction(message),
    lastValidBlockHeight,
  };
}
