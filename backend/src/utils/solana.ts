import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import { logger } from './logger';

/**
 * Get or create Solana connection
 */
export function getConnection(rpcUrl?: string): Connection {
  const url = rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  return new Connection(url, 'confirmed');
}

/**
 * Get SOL balance for a wallet
 */
export async function getSOLBalance(connection: Connection, publicKey: PublicKey): Promise<number> {
  try {
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    logger.error('Error fetching SOL balance:', error);
    throw error;
  }
}

/**
 * Get token balance for a wallet
 */
export async function getTokenBalance(
  connection: Connection,
  walletPublicKey: PublicKey,
  tokenMintAddress: PublicKey
): Promise<number> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(
      tokenMintAddress,
      walletPublicKey
    );
    
    const accountInfo = await getAccount(connection, tokenAccount);
    return Number(accountInfo.amount);
  } catch (error) {
    logger.warn('Token account not found or error fetching balance:', error);
    return 0;
  }
}

/**
 * Create associated token account if it doesn't exist
 */
export async function getOrCreateAssociatedTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  try {
    const associatedToken = await getAssociatedTokenAddress(mint, owner);
    
    // Check if account exists
    try {
      await getAccount(connection, associatedToken);
      logger.info('Associated token account already exists:', associatedToken.toBase58());
      return associatedToken;
    } catch (error) {
      // Account doesn't exist, create it
      logger.info('Creating associated token account...');
      
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          associatedToken,
          owner,
          mint
        )
      );
      
      await sendAndConfirmTransaction(connection, transaction, [payer]);
      logger.info('Associated token account created:', associatedToken.toBase58());
      
      return associatedToken;
    }
  } catch (error) {
    logger.error('Error creating associated token account:', error);
    throw error;
  }
}

/**
 * Validate Solana address
 */
export function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get recent block hash
 */
export async function getRecentBlockhash(connection: Connection): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  return blockhash;
}

/**
 * Confirm transaction
 */
export async function confirmTransaction(
  connection: Connection,
  signature: string,
  maxRetries: number = 30
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      if (status?.value?.confirmationStatus === 'confirmed' || 
          status?.value?.confirmationStatus === 'finalized') {
        return true;
      }
      
      if (status?.value?.err) {
        logger.error('Transaction failed:', status.value.err);
        return false;
      }
      
      await sleep(1000); // Wait 1 second between checks
    } catch (error) {
      logger.warn(`Error checking transaction status (attempt ${i + 1}):`, error);
    }
  }
  
  return false;
}

/**
 * Get transaction details
 */
export async function getTransaction(connection: Connection, signature: string) {
  try {
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    return tx;
  } catch (error) {
    logger.error('Error fetching transaction:', error);
    throw error;
  }
}

/**
 * Estimate transaction fee
 */
export async function estimateTransactionFee(
  connection: Connection,
  transaction: Transaction,
  _payer: PublicKey
): Promise<number> {
  try {
    const { feeCalculator } = await connection.getRecentBlockhash();
    const fee = feeCalculator.lamportsPerSignature * transaction.signatures.length;
    return fee / LAMPORTS_PER_SOL;
  } catch (error) {
    logger.error('Error estimating transaction fee:', error);
    return 0.000005; // Default estimate
  }
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for Solana operations
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Operation failed (attempt ${i + 1}/${maxRetries}):`, error);
      
      if (i < maxRetries - 1) {
        await sleep(delayMs * (i + 1)); // Exponential backoff
      }
    }
  }
  
  throw lastError;
}

/**
 * Get token decimals
 */
export async function getTokenDecimals(
  connection: Connection,
  mintAddress: PublicKey
): Promise<number> {
  try {
    const mintInfo = await connection.getParsedAccountInfo(mintAddress);
    const data = mintInfo.value?.data as ParsedAccountData;
    return data.parsed.info.decimals;
  } catch (error) {
    logger.error('Error fetching token decimals:', error);
    return 9; // Default for SOL
  }
}

/**
 * Convert UI amount to raw amount
 */
export function toRawAmount(uiAmount: number, decimals: number): bigint {
  return BigInt(Math.floor(uiAmount * Math.pow(10, decimals)));
}

/**
 * Convert raw amount to UI amount
 */
export function toUIAmount(rawAmount: bigint, decimals: number): number {
  return Number(rawAmount) / Math.pow(10, decimals);
}
