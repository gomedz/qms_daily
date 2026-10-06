require('dotenv').config();
const { ethers } = require('ethers');

const toChecksum = (addr) => (addr ? ethers.getAddress(addr.toLowerCase()) : null);

module.exports = {
  NETWORK: {
    name: 'QMS Testnet',
    chainId: 19480,
    rpcUrl: process.env.RPC_URL || 'https://rpc.testnet.qms.finance',
    explorerUrl: 'https://testnet.qmsscan.io',
    faucetUrl: 'https://faucet.testnet.qms.finance',
    nativeCurrency: {
      name: 'QMS',
      symbol: 'QMS',
      decimals: 18,
    },
  },

  CONTRACTS: {
    factory: toChecksum('0x93AFD9aC50822F82c7C4f2Ec8Ec2463b086Fb878'),
    router: toChecksum('0x93AFF45f28e5DF1b55f5AEFEfB807De843b12619'),
    weth: toChecksum('0x9AA510295aC664A3d5A3182a3eFe959DE2B12c34'), // Wrapped QMS (WQMS)
  },

  TOKENS: {
    QMS: {
      symbol: 'QMS',
      name: 'QMS (Native)',
      decimals: 18,
      address: null, // native
      isNative: true,
    },
    WQMS: {
      symbol: 'WQMS',
      name: 'Wrapped QMS',
      decimals: 18,
      address: toChecksum('0x9AA510295aC664A3d5A3182a3eFe959DE2B12c34'),
      isNative: false,
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: toChecksum('0xDfF68E53a0A8275212927c12017f5aB5f1842a04'),
      isNative: false,
    },
    USDT: {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      address: toChecksum('0x72577544F4134a25E7F09D0B5ff0Ca05A1249eBF'),
      isNative: false,
    },
    WETH: {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      address: toChecksum('0x9aff7FEe3C9C0599ca9d8F88C1f23A8dbB002325'),
      isNative: false,
    },
    WBTC: {
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      decimals: 8,
      address: toChecksum('0xd0D47e0bfFfDf57d79dC42b03A0AF31E608Ef2C6'),
      isNative: false,
    },
  },


  BOT_SETTINGS: {
    slippageTolerancePercent: parseFloat(process.env.SLIPPAGE_TOLERANCE || '2.5'), // 2.5% default for testnet stability
    deadlineMinutes: parseInt(process.env.DEADLINE_MINUTES || '20', 10),
    minGasReserveQMS: parseFloat(process.env.MIN_GAS_RESERVE || '0.1'), // Minimum QMS to keep for gas fees
    defaultMinSwapAmount: parseFloat(process.env.MIN_SWAP_AMOUNT || '0.01'),
    defaultMaxSwapAmount: parseFloat(process.env.MAX_SWAP_AMOUNT || '0.1'),
    minLiquidityAmount: parseFloat(process.env.MIN_LIQUIDITY_AMOUNT || '0.01'),
    maxLiquidityAmount: parseFloat(process.env.MAX_LIQUIDITY_AMOUNT || '0.05'),
    targetPools: process.env.TARGET_POOLS
      ? process.env.TARGET_POOLS.split(',').map((p) => p.trim())
      : ['QMS-USDC', 'QMS-USDT', 'QMS-WETH'],
    autoRemoveLiquidity: process.env.AUTO_REMOVE_LIQUIDITY === 'true',
    removeLiquidityPercent: parseInt(process.env.REMOVE_LIQUIDITY_PERCENT || '50', 10),
    minDelaySeconds: parseInt(process.env.MIN_DELAY_SECONDS || '10', 10),
    maxDelaySeconds: parseInt(process.env.MAX_DELAY_SECONDS || '25', 10),
    cycles: parseInt(process.env.CYCLES || '5', 10),
    swapCycles: parseInt(process.env.SWAP_CYCLES || process.env.CYCLES || '5', 10),
    liquidityCycles: parseInt(process.env.LIQUIDITY_CYCLES || process.env.CYCLES || '5', 10),

    // Daily Scheduler Settings
    dailyStartHourUtc: parseInt(process.env.DAILY_START_HOUR_UTC || '1', 10),
    dailyEndHourUtc: parseInt(process.env.DAILY_END_HOUR_UTC || '5', 10),
    runImmediatelyOnStart: process.env.RUN_IMMEDIATELY_ON_START === 'true',
  },
};


