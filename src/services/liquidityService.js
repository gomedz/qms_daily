const { ethers } = require('ethers');
const config = require('../config');
const { ROUTER_ABI, FACTORY_ABI, ERC20_ABI, PAIR_ABI } = require('../abis');
const { calculateMinWithSlippage, getDeadline, getTxUrl } = require('../utils/helpers');
const logger = require('../utils/logger');

class LiquidityService {
  constructor(provider) {
    this.provider = provider;
    this.router = new ethers.Contract(config.CONTRACTS.router, ROUTER_ABI, provider);
    this.factory = new ethers.Contract(config.CONTRACTS.factory, FACTORY_ABI, provider);
  }

  /**
   * Ensure token approval for router with unlimited allowance
   */
  async ensureAllowance(wallet, tokenAddress, amount) {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const allowance = await tokenContract.allowance(wallet.address, config.CONTRACTS.router);

    const UNLIMITED_THRESHOLD = ethers.MaxUint256 / 2n;
    if (allowance < UNLIMITED_THRESHOLD || allowance < amount) {
      logger.info(`Approving router for token ${tokenAddress} (unlimited)...`);
      let gasLimit;
      try {
        const est = await tokenContract.approve.estimateGas(config.CONTRACTS.router, ethers.MaxUint256);
        gasLimit = (est * 130n) / 100n;
      } catch (e) {
        gasLimit = 75000n;
      }
      const approveTx = await tokenContract.approve(config.CONTRACTS.router, ethers.MaxUint256, { gasLimit });
      logger.info(`Approval tx: ${approveTx.hash}. Waiting confirmation...`);
      await approveTx.wait();
      logger.success(`Token approved successfully!`);
    }
  }

  /**
   * Get pair address and reserves
   */
  async getPairInfo(tokenAAddress, tokenBAddress) {
    const pairAddress = await this.factory.getPair(tokenAAddress, tokenBAddress);
    if (pairAddress === ethers.ZeroAddress) {
      return null;
    }

    const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
    const [token0, token1, reserves] = await Promise.all([
      pairContract.token0(),
      pairContract.token1(),
      pairContract.getReserves(),
    ]);

    const isToken0A = token0.toLowerCase() === tokenAAddress.toLowerCase();
    const reserveA = isToken0A ? reserves[0] : reserves[1];
    const reserveB = isToken0A ? reserves[1] : reserves[0];

    return {
      pairAddress,
      token0,
      token1,
      reserveA,
      reserveB,
    };
  }

  /**
   * Add Liquidity between two tokens
   * @param {ethers.Wallet} wallet
   * @param {Object} tokenA from config.TOKENS (can be native QMS)
   * @param {Object} tokenB from config.TOKENS
   * @param {string|number} amountADesiredStr human units of tokenA (e.g. "0.05")
   * @param {number} slippagePercent
   */
  async addLiquidity(wallet, tokenA, tokenB, amountADesiredStr, slippagePercent = config.BOT_SETTINGS.slippageTolerancePercent) {
    logger.step(`Preparing to add liquidity: ${tokenA.symbol} + ${tokenB.symbol} for ${wallet.address}`);

    const routerWithSigner = this.router.connect(wallet);
    const wqmsAddress = config.CONTRACTS.weth;
    const addrA = tokenA.isNative ? wqmsAddress : tokenA.address;
    const addrB = tokenB.isNative ? wqmsAddress : tokenB.address;

    const pairInfo = await this.getPairInfo(addrA, addrB);
    if (!pairInfo) {
      throw new Error(`Pair does not exist for ${tokenA.symbol} and ${tokenB.symbol}!`);
    }

    if (pairInfo.reserveA === 0n || pairInfo.reserveB === 0n) {
      throw new Error(`Pair has 0 reserves. Initial liquidity provisioning required.`);
    }

    // Calculate required amountB for desired amountA
    let amountADesired = ethers.parseUnits(amountADesiredStr.toString(), tokenA.decimals);

    // Verify against on-chain balances
    if (tokenA.isNative) {
      const liveBalA = await this.provider.getBalance(wallet.address);
      const minGas = ethers.parseEther(config.BOT_SETTINGS.minGasReserveQMS.toString());
      if (liveBalA <= minGas) {
        throw new Error(`Native balance too low for gas reserve (${config.BOT_SETTINGS.minGasReserveQMS} QMS)`);
      }
      const maxAvailableA = liveBalA - minGas;
      if (amountADesired > maxAvailableA) {
        amountADesired = maxAvailableA;
      }
    } else {
      const contractA = new ethers.Contract(tokenA.address, ERC20_ABI, wallet);
      const liveBalA = await contractA.balanceOf(wallet.address);
      if (amountADesired > liveBalA) {
        amountADesired = liveBalA;
      }
    }

    let amountBDesired = await this.router.quote(amountADesired, pairInfo.reserveA, pairInfo.reserveB);

    // Verify tokenB balance
    if (!tokenB.isNative) {
      const contractB = new ethers.Contract(tokenB.address, ERC20_ABI, wallet);
      const liveBalB = await contractB.balanceOf(wallet.address);
      if (liveBalB < amountBDesired) {
        if (liveBalB === 0n) {
          throw new Error(`Insufficient ${tokenB.symbol} balance for pool pair: 0`);
        }
        // Scale down proportionally to available tokenB
        amountBDesired = liveBalB;
        amountADesired = await this.router.quote(amountBDesired, pairInfo.reserveB, pairInfo.reserveA);
      }
    }

    logger.info(
      `Pair pool ratio: ${ethers.formatUnits(amountADesired, tokenA.decimals)} ${tokenA.symbol} ↔ ` +
      `${ethers.formatUnits(amountBDesired, tokenB.decimals)} ${tokenB.symbol}`
    );

    // Apply slippage
    const amountAMin = calculateMinWithSlippage(amountADesired, slippagePercent);
    const amountBMin = calculateMinWithSlippage(amountBDesired, slippagePercent);
    const deadline = getDeadline(config.BOT_SETTINGS.deadlineMinutes);

    let tx;
    if (tokenA.isNative) {
      // Native QMS + ERC20 (tokenB)
      await this.ensureAllowance(wallet, tokenB.address, amountBDesired);
      logger.info(`Calling addLiquidityETH...`);
      let gasLimit;
      try {
        const est = await routerWithSigner.addLiquidityETH.estimateGas(
          tokenB.address,
          amountBDesired,
          amountBMin,
          amountAMin,
          wallet.address,
          deadline,
          { value: amountADesired }
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      tx = await routerWithSigner.addLiquidityETH(
        tokenB.address,
        amountBDesired,
        amountBMin,
        amountAMin,
        wallet.address,
        deadline,
        { value: amountADesired, gasLimit }
      );
    } else if (tokenB.isNative) {
      // ERC20 (tokenA) + Native QMS
      await this.ensureAllowance(wallet, tokenA.address, amountADesired);
      logger.info(`Calling addLiquidityETH...`);
      let gasLimit;
      try {
        const est = await routerWithSigner.addLiquidityETH.estimateGas(
          tokenA.address,
          amountADesired,
          amountAMin,
          amountBMin,
          wallet.address,
          deadline,
          { value: amountBDesired }
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      tx = await routerWithSigner.addLiquidityETH(
        tokenA.address,
        amountADesired,
        amountAMin,
        amountBMin,
        wallet.address,
        deadline,
        { value: amountBDesired, gasLimit }
      );
    } else {
      // ERC20 (tokenA) + ERC20 (tokenB)
      await this.ensureAllowance(wallet, tokenA.address, amountADesired);
      await this.ensureAllowance(wallet, tokenB.address, amountBDesired);
      logger.info(`Calling addLiquidity...`);
      let gasLimit;
      try {
        const est = await routerWithSigner.addLiquidity.estimateGas(
          tokenA.address,
          tokenB.address,
          amountADesired,
          amountBDesired,
          amountAMin,
          amountBMin,
          wallet.address,
          deadline
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      tx = await routerWithSigner.addLiquidity(
        tokenA.address,
        tokenB.address,
        amountADesired,
        amountBDesired,
        amountAMin,
        amountBMin,
        wallet.address,
        deadline,
        { gasLimit }
      );
    }

    logger.info(`Add liquidity tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    logger.success(
      `Liquidity added successfully! Block #${receipt.blockNumber} | Explorer: ${getTxUrl(config.NETWORK.explorerUrl, tx.hash)}`
    );
    return receipt;
  }

  /**
   * Remove Liquidity from pool
   */
  async removeLiquidity(wallet, tokenA, tokenB, percentToRemove = 100, slippagePercent = 2.0) {
    const routerWithSigner = this.router.connect(wallet);
    const wqmsAddress = config.CONTRACTS.weth;
    const addrA = tokenA.isNative ? wqmsAddress : tokenA.address;
    const addrB = tokenB.isNative ? wqmsAddress : tokenB.address;

    const pairInfo = await this.getPairInfo(addrA, addrB);
    if (!pairInfo) {
      throw new Error(`Pair does not exist!`);
    }

    const pairContract = new ethers.Contract(pairInfo.pairAddress, PAIR_ABI, wallet);
    const lpBalance = await pairContract.balanceOf(wallet.address);

    if (lpBalance === 0n) {
      logger.warn(`No LP tokens held for ${tokenA.symbol}-${tokenB.symbol}`);
      return null;
    }

    const liquidityToRemove = (lpBalance * BigInt(percentToRemove)) / 100n;
    logger.info(`Removing ${percentToRemove}% LP tokens (${ethers.formatEther(liquidityToRemove)} LP)...`);

    // Approve LP to router
    const allowance = await pairContract.allowance(wallet.address, config.CONTRACTS.router);
    const UNLIMITED_THRESHOLD = ethers.MaxUint256 / 2n;
    if (allowance < UNLIMITED_THRESHOLD || allowance < liquidityToRemove) {
      logger.info(`Approving router for LP token (unlimited)...`);
      let gasLimit;
      try {
        const est = await pairContract.approve.estimateGas(config.CONTRACTS.router, ethers.MaxUint256);
        gasLimit = (est * 130n) / 100n;
      } catch (e) {
        gasLimit = 75000n;
      }
      const approveTx = await pairContract.approve(config.CONTRACTS.router, ethers.MaxUint256, { gasLimit });
      await approveTx.wait();
      logger.success(`LP token approved!`);
    }

    const deadline = getDeadline(config.BOT_SETTINGS.deadlineMinutes);
    let tx;
    if (tokenA.isNative) {
      let gasLimit;
      try {
        const est = await routerWithSigner.removeLiquidityETH.estimateGas(
          tokenB.address,
          liquidityToRemove,
          0n,
          0n,
          wallet.address,
          deadline
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      tx = await routerWithSigner.removeLiquidityETH(
        tokenB.address,
        liquidityToRemove,
        0n, // minimum
        0n,
        wallet.address,
        deadline,
        { gasLimit }
      );
    } else if (tokenB.isNative) {
      let gasLimit;
      try {
        const est = await routerWithSigner.removeLiquidityETH.estimateGas(
          tokenA.address,
          liquidityToRemove,
          0n,
          0n,
          wallet.address,
          deadline
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      tx = await routerWithSigner.removeLiquidityETH(
        tokenA.address,
        liquidityToRemove,
        0n,
        0n,
        wallet.address,
        deadline,
        { gasLimit }
      );
    } else {
      let gasLimit;
      try {
        const est = await routerWithSigner.removeLiquidity.estimateGas(
          tokenA.address,
          tokenB.address,
          liquidityToRemove,
          0n,
          0n,
          wallet.address,
          deadline
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      tx = await routerWithSigner.removeLiquidity(
        tokenA.address,
        tokenB.address,
        liquidityToRemove,
        0n,
        0n,
        wallet.address,
        deadline,
        { gasLimit }
      );
    }

    const receipt = await tx.wait();
    logger.success(`Liquidity removed! Explorer: ${getTxUrl(config.NETWORK.explorerUrl, tx.hash)}`);
    return receipt;
  }
}

module.exports = LiquidityService;
