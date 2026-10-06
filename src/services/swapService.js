const { ethers } = require('ethers');
const config = require('../config');
const { ROUTER_ABI, FACTORY_ABI, ERC20_ABI, WETH_ABI, PAIR_ABI } = require('../abis');
const { calculateMinWithSlippage, getDeadline, getTxUrl } = require('../utils/helpers');
const logger = require('../utils/logger');
const chalk = require('chalk');

class SwapService {
  constructor(provider) {
    this.provider = provider;
    this.router = new ethers.Contract(config.CONTRACTS.router, ROUTER_ABI, provider);
    this.factory = new ethers.Contract(config.CONTRACTS.factory, FACTORY_ABI, provider);
    this.weth = new ethers.Contract(config.CONTRACTS.weth, WETH_ABI, provider);
  }

  /**
   * Resolve best swap route between two tokens
   */
  async resolvePath(fromToken, toToken) {
    const wqmsAddress = config.CONTRACTS.weth;
    const fromAddr = fromToken.isNative ? wqmsAddress : fromToken.address;
    const toAddr = toToken.isNative ? wqmsAddress : toToken.address;

    if (fromAddr.toLowerCase() === toAddr.toLowerCase()) {
      throw new Error(`Cannot swap identical token: ${fromToken.symbol} to ${toToken.symbol}`);
    }

    // Direct pair check
    const directPair = await this.factory.getPair(fromAddr, toAddr);
    if (directPair !== ethers.ZeroAddress) {
      // Check if pair has liquidity
      const pairContract = new ethers.Contract(directPair, PAIR_ABI, this.provider);
      const [r0, r1] = await pairContract.getReserves();
      if (r0 > 0n && r1 > 0n) {
        return [fromAddr, toAddr];
      }
    }

    // If neither is WQMS, route through WQMS: [from, WQMS, to]
    if (fromAddr.toLowerCase() !== wqmsAddress.toLowerCase() && toAddr.toLowerCase() !== wqmsAddress.toLowerCase()) {
      const pair1 = await this.factory.getPair(fromAddr, wqmsAddress);
      const pair2 = await this.factory.getPair(wqmsAddress, toAddr);
      if (pair1 !== ethers.ZeroAddress && pair2 !== ethers.ZeroAddress) {
        return [fromAddr, wqmsAddress, toAddr];
      }
    }

    return [fromAddr, toAddr];
  }

  /**
   * Check token allowance and approve router if needed with unlimited allowance
   */
  async ensureAllowance(wallet, tokenAddress, amount) {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const allowance = await tokenContract.allowance(wallet.address, config.CONTRACTS.router);

    // If allowance is not effectively unlimited (or less than needed), approve MaxUint256
    const UNLIMITED_THRESHOLD = ethers.MaxUint256 / 2n;
    if (allowance < UNLIMITED_THRESHOLD || allowance < amount) {
      logger.info(`Approving router for ${tokenAddress} (unlimited)...`);
      let gasLimit;
      try {
        const est = await tokenContract.approve.estimateGas(config.CONTRACTS.router, ethers.MaxUint256);
        gasLimit = (est * 130n) / 100n;
      } catch (e) {
        gasLimit = 75000n;
      }
      const approveTx = await tokenContract.approve(config.CONTRACTS.router, ethers.MaxUint256, { gasLimit });
      logger.info(`Approval tx submitted: ${approveTx.hash}. Waiting for confirmation...`);
      await approveTx.wait();
      logger.success(`Router approved successfully!`);
    }
  }

  /**
   * Get expected amount out from router
   */
  async getAmountsOut(amountIn, path) {
    return await this.router.getAmountsOut(amountIn, path);
  }

  /**
   * Execute Swap between two tokens
   * @param {ethers.Wallet} wallet
   * @param {Object} fromToken from config.TOKENS
   * @param {Object} toToken to config.TOKENS
   * @param {string|number} amountStr amount in human units (e.g. "0.1")
   * @param {number} slippagePercent
   */
  async executeSwap(wallet, fromToken, toToken, amountStr, slippagePercent = config.BOT_SETTINGS.slippageTolerancePercent) {
    logger.step(`Initiating swap: ${amountStr} ${fromToken.symbol} ➔ ${toToken.symbol} on ${wallet.address}`);

    const routerWithSigner = this.router.connect(wallet);
    let amountIn = ethers.parseUnits(amountStr.toString(), fromToken.decimals);
    const deadline = getDeadline(config.BOT_SETTINGS.deadlineMinutes);

    // Verify and clamp against fresh on-chain balance
    if (fromToken.isNative) {
      const liveBal = await this.provider.getBalance(wallet.address);
      const minGas = ethers.parseEther(config.BOT_SETTINGS.minGasReserveQMS.toString());
      if (liveBal <= minGas) {
        throw new Error(`Native balance too low for gas reserve (${config.BOT_SETTINGS.minGasReserveQMS} QMS)`);
      }
      const maxAvailable = liveBal - minGas;
      if (amountIn > maxAvailable) {
        logger.warn(`Clamping swap amount from ${amountStr} to max available ${ethers.formatEther(maxAvailable)} QMS`);
        amountIn = maxAvailable;
      }
    } else {
      const tokenContract = new ethers.Contract(fromToken.address, ERC20_ABI, wallet);
      const liveBal = await tokenContract.balanceOf(wallet.address);
      if (liveBal === 0n) {
        throw new Error(`Insufficient ${fromToken.symbol} balance: 0`);
      }
      if (amountIn > liveBal) {
        logger.warn(`Clamping swap amount from ${amountStr} to live balance ${ethers.formatUnits(liveBal, fromToken.decimals)} ${fromToken.symbol}`);
        amountIn = liveBal;
      }
    }

    if (amountIn === 0n) {
      throw new Error(`Swap amount is 0 after balance check. Skipping.`);
    }

    // 1. Direct Wrap (QMS -> WQMS)
    if (fromToken.isNative && toToken.symbol === 'WQMS') {
      logger.info(`Wrapping ${ethers.formatUnits(amountIn, fromToken.decimals)} QMS into WQMS via deposit()...`);
      const wethWithSigner = this.weth.connect(wallet);
      let gasLimit;
      try {
        const est = await wethWithSigner.deposit.estimateGas({ value: amountIn });
        gasLimit = (est * 130n) / 100n;
      } catch (e) {
        gasLimit = 65000n;
      }
      const tx = await wethWithSigner.deposit({ value: amountIn, gasLimit });
      logger.info(`Tx sent: ${tx.hash}`);
      const receipt = await tx.wait();
      logger.success(`Wrap complete! Gas used: ${receipt.gasUsed.toString()} | Tx: ${getTxUrl(config.NETWORK.explorerUrl, tx.hash)}`);
      return receipt;
    }

    // 2. Direct Unwrap (WQMS -> QMS)
    if (fromToken.symbol === 'WQMS' && toToken.isNative) {
      logger.info(`Unwrapping ${ethers.formatUnits(amountIn, fromToken.decimals)} WQMS into native QMS via withdraw()...`);
      const wethWithSigner = this.weth.connect(wallet);
      let gasLimit;
      try {
        const est = await wethWithSigner.withdraw.estimateGas(amountIn);
        gasLimit = (est * 130n) / 100n;
      } catch (e) {
        gasLimit = 65000n;
      }
      const tx = await wethWithSigner.withdraw(amountIn, { gasLimit });
      logger.info(`Tx sent: ${tx.hash}`);
      const receipt = await tx.wait();
      logger.success(`Unwrap complete! Gas used: ${receipt.gasUsed.toString()} | Tx: ${getTxUrl(config.NETWORK.explorerUrl, tx.hash)}`);
      return receipt;
    }

    // 3. AMM Swap via Router
    const path = await this.resolvePath(fromToken, toToken);
    logger.info(`Swap path: ${path.join(' ➔ ')}`);

    const amountsOut = await this.getAmountsOut(amountIn, path);
    const expectedOut = amountsOut[amountsOut.length - 1];
    const amountOutMin = calculateMinWithSlippage(expectedOut, slippagePercent);

    logger.info(`Expected output: ${ethers.formatUnits(expectedOut, toToken.decimals)} ${toToken.symbol}`);
    logger.info(`Min received (${slippagePercent}% slippage): ${ethers.formatUnits(amountOutMin, toToken.decimals)} ${toToken.symbol}`);

    let tx;
    if (fromToken.isNative) {
      // Native QMS -> ERC20
      let gasLimit;
      try {
        const est = await routerWithSigner.swapExactETHForTokens.estimateGas(
          amountOutMin,
          path,
          wallet.address,
          deadline,
          { value: amountIn }
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 250000n;
      }

      tx = await routerWithSigner.swapExactETHForTokens(
        amountOutMin,
        path,
        wallet.address,
        deadline,
        { value: amountIn, gasLimit }
      );
    } else if (toToken.isNative) {
      // ERC20 -> Native QMS
      await this.ensureAllowance(wallet, fromToken.address, amountIn);
      let gasLimit;
      try {
        const est = await routerWithSigner.swapExactTokensForETH.estimateGas(
          amountIn,
          amountOutMin,
          path,
          wallet.address,
          deadline
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 250000n;
      }

      tx = await routerWithSigner.swapExactTokensForETH(
        amountIn,
        amountOutMin,
        path,
        wallet.address,
        deadline,
        { gasLimit }
      );
    } else {
      // ERC20 -> ERC20
      await this.ensureAllowance(wallet, fromToken.address, amountIn);
      let gasLimit;
      try {
        const est = await routerWithSigner.swapExactTokensForTokens.estimateGas(
          amountIn,
          amountOutMin,
          path,
          wallet.address,
          deadline
        );
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 250000n;
      }

      tx = await routerWithSigner.swapExactTokensForTokens(
        amountIn,
        amountOutMin,
        path,
        wallet.address,
        deadline,
        { gasLimit }
      );
    }

    logger.info(`Swap transaction submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    logger.success(`Swap confirmed! Block #${receipt.blockNumber} | Explorer: ${getTxUrl(config.NETWORK.explorerUrl, tx.hash)}`);
    return receipt;
  }
}

module.exports = SwapService;
