const readline = require('readline');
const chalk = require('chalk');
const config = require('./config');
const { getProvider } = require('./utils/provider');
const { sleep, getRandomInRange, getRandomInt } = require('./utils/helpers');
const logger = require('./utils/logger');
const { loadWallets, getWalletBalances, printAllBalances } = require('./services/walletService');
const SwapService = require('./services/swapService');
const LiquidityService = require('./services/liquidityService');
const { startDailyScheduler } = require('./services/schedulerService');

const provider = getProvider();
const swapService = new SwapService(provider);
const liquidityService = new LiquidityService(provider);

/**
 * Run Auto Swap Loop across loaded wallets
 */
async function runAutoSwapLoop(wallets, cycles = 5) {
  logger.header(`STARTING AUTO SWAP LOOP (${cycles} CYCLES)`);

  const tradeableTokens = [
    config.TOKENS.USDC,
    config.TOKENS.USDT,
    config.TOKENS.WETH,
    config.TOKENS.WBTC,
  ];

  for (let c = 1; c <= cycles; c++) {
    console.log(chalk.bold.magenta(`\n=== CYCLE ${c} OF ${cycles} ===`));

    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      console.log(chalk.yellow(`\n[Wallet #${i + 1}: ${wallet.address}]`));

      try {
        const balances = await getWalletBalances(wallet.address);
        const nativeBal = parseFloat(balances.QMS.formatted);

        // Find which ERC20 has the largest balance to rotate back, or swap from QMS
        let maxErc20Symbol = null;
        let maxErc20Val = 0;
        for (const [sym, b] of Object.entries(balances)) {
          if (sym === 'QMS' || sym === 'WQMS') continue;
          const val = parseFloat(b.formatted);
          if (val > maxErc20Val) {
            maxErc20Val = val;
            maxErc20Symbol = sym;
          }
        }

        // Strategy: If native QMS > minGasReserve + amount, swap QMS -> random token
        // If wallet already accumulated ERC20 tokens, swap ERC20 -> another token or back to QMS!
        const shouldSwapFromToken = maxErc20Val > 0.5 && Math.random() > 0.4;

        if (shouldSwapFromToken && maxErc20Symbol) {
          const fromToken = config.TOKENS[maxErc20Symbol];
          // Pick destination: either native QMS or another random ERC20
          const destTokens = [config.TOKENS.QMS, ...tradeableTokens.filter((t) => t.symbol !== maxErc20Symbol)];
          const toToken = destTokens[getRandomInt(0, destTokens.length - 1)];

          // Swap 30% - 70% of current token balance
          const percent = getRandomInRange(0.3, 0.7, 2);
          const amountToSwap = (maxErc20Val * percent).toFixed(Math.min(fromToken.decimals, 4));

          if (parseFloat(amountToSwap) > 0) {
            logger.info(`Rotating ${amountToSwap} ${fromToken.symbol} ➔ ${toToken.symbol}`);
            await swapService.executeSwap(wallet, fromToken, toToken, amountToSwap);
          }
        } else {
          // Swap from Native QMS to random ERC20
          if (nativeBal <= config.BOT_SETTINGS.minGasReserveQMS) {
            logger.warn(`Native QMS balance (${nativeBal.toFixed(4)}) too low for gas reserve (${config.BOT_SETTINGS.minGasReserveQMS}). Skipping.`);
            continue;
          }

          const availableToSwap = nativeBal - config.BOT_SETTINGS.minGasReserveQMS;
          const swapAmountNum = Math.min(
            availableToSwap,
            getRandomInRange(config.BOT_SETTINGS.defaultMinSwapAmount, config.BOT_SETTINGS.defaultMaxSwapAmount, 4)
          );

          if (swapAmountNum <= 0) {
            logger.warn(`Calculated swap amount is 0. Skipping.`);
            continue;
          }

          const targetToken = tradeableTokens[getRandomInt(0, tradeableTokens.length - 1)];
          await swapService.executeSwap(wallet, config.TOKENS.QMS, targetToken, swapAmountNum.toString());
        }

        // Random delay between actions
        const delay = getRandomInt(config.BOT_SETTINGS.minDelaySeconds, config.BOT_SETTINGS.maxDelaySeconds);
        logger.info(`Sleeping for ${delay}s before next transaction...`);
        await sleep(delay * 1000);
      } catch (err) {
        logger.error(`Failed swap on wallet ${wallet.address}: ${err.message}`);
      }
    }
  }

  logger.success(`Auto Swap loop completed!`);
}

/**
 * Run Auto Add Liquidity Loop
 */
async function runAutoAddLiquidityLoop(wallets, cycles = 3) {
  logger.header(`STARTING AUTO ADD LIQUIDITY LOOP (${cycles} CYCLES)`);

  // Parse target pools from config
  const poolOptions = config.BOT_SETTINGS.targetPools
    .map((poolName) => {
      const parts = poolName.split('-');
      if (parts.length === 2 && config.TOKENS[parts[0]] && config.TOKENS[parts[1]]) {
        return { tokenA: config.TOKENS[parts[0]], tokenB: config.TOKENS[parts[1]] };
      }
      return null;
    })
    .filter(Boolean);

  const activePools = poolOptions.length > 0 ? poolOptions : [
    { tokenA: config.TOKENS.QMS, tokenB: config.TOKENS.USDC },
    { tokenA: config.TOKENS.QMS, tokenB: config.TOKENS.USDT },
    { tokenA: config.TOKENS.QMS, tokenB: config.TOKENS.WETH },
  ];

  for (let c = 1; c <= cycles; c++) {
    console.log(chalk.bold.magenta(`\n=== LIQUIDITY CYCLE ${c} OF ${cycles} ===`));

    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      console.log(chalk.yellow(`\n[Wallet #${i + 1}: ${wallet.address}]`));

      try {
        const pool = activePools[getRandomInt(0, activePools.length - 1)];
        logger.info(`Target Pool: ${pool.tokenA.symbol} / ${pool.tokenB.symbol}`);

        const balances = await getWalletBalances(wallet.address);
        const balA = parseFloat(balances[pool.tokenA.symbol].formatted);
        const balB = parseFloat(balances[pool.tokenB.symbol].formatted);

        // Check if wallet has tokenB. If not, auto-swap some tokenA into tokenB first
        if (balB === 0 || isNaN(balB)) {
          logger.info(`Wallet lacks ${pool.tokenB.symbol}. Auto-swapping some ${pool.tokenA.symbol} to get it...`);
          const swapSeed = (Math.min(balA * 0.4, 0.1)).toFixed(4);
          if (parseFloat(swapSeed) > 0) {
            await swapService.executeSwap(wallet, pool.tokenA, pool.tokenB, swapSeed);
            await sleep(5000);
          }
        }

        // Amount of tokenA to provide as liquidity (bounded by config settings)
        let amountA;
        const targetAmountA = getRandomInRange(
          config.BOT_SETTINGS.minLiquidityAmount,
          config.BOT_SETTINGS.maxLiquidityAmount,
          4
        );

        if (pool.tokenA.isNative) {
          const safeBal = Math.max(0, balA - config.BOT_SETTINGS.minGasReserveQMS);
          amountA = Math.min(safeBal * 0.4, targetAmountA).toFixed(4);
        } else {
          amountA = Math.min(balA * 0.5, targetAmountA).toFixed(4);
        }

        if (parseFloat(amountA) <= 0) {
          logger.warn(`Insufficient ${pool.tokenA.symbol} to add liquidity. Skipping.`);
          continue;
        }

        await liquidityService.addLiquidity(wallet, pool.tokenA, pool.tokenB, amountA);

        // Optional auto-removal of liquidity to test full LP lifecycle
        if (config.BOT_SETTINGS.autoRemoveLiquidity && Math.random() > 0.5) {
          await sleep(5000);
          logger.info(`Auto-removal enabled: removing ${config.BOT_SETTINGS.removeLiquidityPercent}% LP tokens...`);
          await liquidityService.removeLiquidity(
            wallet,
            pool.tokenA,
            pool.tokenB,
            config.BOT_SETTINGS.removeLiquidityPercent
          );
        }

        const delay = getRandomInt(config.BOT_SETTINGS.minDelaySeconds, config.BOT_SETTINGS.maxDelaySeconds);
        logger.info(`Waiting ${delay}s...`);
        await sleep(delay * 1000);
      } catch (err) {
        logger.error(`Liquidity operation failed: ${err.message}`);
      }
    }
  }


  logger.success(`Auto Liquidity loop completed!`);
}

/**
 * Complete routine: Swaps + Liquidity
 */
async function runFullRoutine(wallets) {
  const swapCycles = config.BOT_SETTINGS.swapCycles;
  const liquidityCycles = config.BOT_SETTINGS.liquidityCycles;
  await runAutoSwapLoop(wallets, swapCycles);
  await runAutoAddLiquidityLoop(wallets, liquidityCycles);
}

/**
 * Interactive Command Line Interface
 */
async function showMenu() {
  const wallets = loadWallets();

  console.clear();
  console.log(chalk.cyan.bold(`
======================================================================
       QWAP DEX AUTOMATION BOT (QMS TESTNET - CHAIN ID: 19480)        
======================================================================
  `));
  console.log(chalk.gray(`Loaded Wallets:   ${wallets.length}`));
  console.log(chalk.gray(`RPC URL:          ${config.NETWORK.rpcUrl}`));
  console.log(chalk.gray(`Daily Window:     ${config.BOT_SETTINGS.dailyStartHourUtc}:00 - ${config.BOT_SETTINGS.dailyEndHourUtc}:00 UTC`));
  console.log(chalk.gray(`Configured Cycles: Swap: ${config.BOT_SETTINGS.swapCycles} | Liquidity: ${config.BOT_SETTINGS.liquidityCycles}`));
  console.log(chalk.gray(`Explorer:         ${config.NETWORK.explorerUrl}`));
  console.log(chalk.gray(`Faucet:           ${config.NETWORK.faucetUrl}\n`));

  console.log(chalk.white('Select an option:'));
  console.log(chalk.green('  [1]') + ' Check Wallet Balances');
  console.log(chalk.green('  [2]') + ' Single Swap (QMS ➔ Any Token or Token ➔ Token)');
  console.log(chalk.green('  [3]') + ' Single Add Liquidity');
  console.log(chalk.green('  [4]') + ` Automated Swap Bot (${config.BOT_SETTINGS.swapCycles} Cycles)`);
  console.log(chalk.green('  [5]') + ` Automated Liquidity Bot (${config.BOT_SETTINGS.liquidityCycles} Cycles)`);
  console.log(chalk.green('  [6]') + ' Full Automated Mode (Swap + Liquidity Now)');
  console.log(chalk.magenta('  [7]') + ' ⏰ Start Daily Scheduler (Runs automatically at random time in UTC window)');
  console.log(chalk.red('  [0]') + ' Exit\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(chalk.bold.cyan('Enter choice: '), async (choice) => {
    rl.close();
    switch (choice.trim()) {
      case '1':
        await printAllBalances(wallets);
        break;
      case '2':
        if (wallets.length === 0) {
          logger.error('No wallets configured!');
          break;
        }
        await printAllBalances(wallets);
        logger.info('Executing sample swap: 0.05 QMS ➔ USDC for Wallet #1...');
        await swapService.executeSwap(wallets[0], config.TOKENS.QMS, config.TOKENS.USDC, '0.05');
        break;
      case '3':
        if (wallets.length === 0) {
          logger.error('No wallets configured!');
          break;
        }
        logger.info('Adding liquidity: QMS + USDC for Wallet #1...');
        await liquidityService.addLiquidity(wallets[0], config.TOKENS.QMS, config.TOKENS.USDC, '0.05');
        break;
      case '4':
        await runAutoSwapLoop(wallets, config.BOT_SETTINGS.swapCycles);
        break;
      case '5':
        await runAutoAddLiquidityLoop(wallets, config.BOT_SETTINGS.liquidityCycles);
        break;
      case '6':
        await runFullRoutine(wallets);
        break;
      case '7':
        await startDailyScheduler(() => runFullRoutine(wallets), {
          startHourUtc: config.BOT_SETTINGS.dailyStartHourUtc,
          endHourUtc: config.BOT_SETTINGS.dailyEndHourUtc,
          runImmediately: config.BOT_SETTINGS.runImmediatelyOnStart,
        });
        break;
      case '0':
        console.log(chalk.yellow('Goodbye!'));
        process.exit(0);
      default:
        console.log(chalk.red('Invalid selection'));
    }
  });
}

/**
 * Handle CLI flags directly (for non-interactive headless / background running)
 */
async function main() {
  const args = process.argv.slice(2);
  const wallets = loadWallets();

  if (args.includes('--balances')) {
    await printAllBalances(wallets);
    process.exit(0);
  }

  if (args.includes('--auto-swap')) {
    await runAutoSwapLoop(wallets, config.BOT_SETTINGS.swapCycles);
    process.exit(0);
  }

  if (args.includes('--auto-liquidity')) {
    await runAutoAddLiquidityLoop(wallets, config.BOT_SETTINGS.liquidityCycles);
    process.exit(0);
  }

  if (args.includes('--all')) {
    await runFullRoutine(wallets);
    process.exit(0);
  }

  if (args.includes('--daily') || args.includes('--scheduler')) {
    await startDailyScheduler(() => runFullRoutine(wallets), {
      startHourUtc: config.BOT_SETTINGS.dailyStartHourUtc,
      endHourUtc: config.BOT_SETTINGS.dailyEndHourUtc,
      runImmediately: config.BOT_SETTINGS.runImmediatelyOnStart,
    });
    return;
  }

  await showMenu();
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  runAutoSwapLoop,
  runAutoAddLiquidityLoop,
  runFullRoutine,
};

