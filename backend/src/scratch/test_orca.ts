import { PublicKey } from '@solana/web3.js';
import orcaService from '../services/orca';

async function testOrca() {
  console.log('Testing Orca Whirlpool SDK integration...\n');

  // SOL/USDC Whirlpool (64 tick spacing, 0.3% fee)
  const SOL_USDC_POOL = new PublicKey('HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ');

  try {
    // Test 1: Check SDK availability
    console.log('1. SDK Availability:', orcaService.isWhirlpoolSDKAvailable());

    // Test 2: Fetch pool data
    console.log('\n2. Fetching SOL/USDC pool data...');
    const poolData = await orcaService.getWhirlpoolData(SOL_USDC_POOL);
    console.log('   Token A:', poolData.tokenMintA);
    console.log('   Token B:', poolData.tokenMintB);
    console.log('   Fee Rate:', poolData.feeRate);
    console.log('   Current Tick:', poolData.tickCurrentIndex);
    console.log('   Liquidity:', poolData.liquidity);

    // Test 3: Calculate optimal tick range
    console.log('\n3. Calculating optimal tick range (±20%)...');
    const tickRange = await orcaService.getOptimalTickRange(SOL_USDC_POOL, 0.2);
    console.log('   Current Tick:', tickRange.currentTickIndex);
    console.log('   Lower Tick:', tickRange.lowerTickIndex);
    console.log('   Upper Tick:', tickRange.upperTickIndex);

    // Test 4: Get position PDA (example)
    console.log('\n4. Testing position PDA calculation...');
    const exampleMint = new PublicKey('11111111111111111111111111111111');
    const positionPda = await orcaService.getPositionAddress(exampleMint);
    console.log('   Position PDA:', positionPda.toBase58());
    
    console.log('\nNote: Swap quotes require more complex fetcher setup and will be added later.');

    console.log('\n All tests passed!');
  } catch (error) {
    console.error('\n Test failed:', error);
    process.exit(1);
  }
}

testOrca().catch(err => {
  console.error(err);
  process.exit(1);
});
