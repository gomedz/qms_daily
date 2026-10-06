const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const config = require('../config');
const { ERC20_ABI } = require('../abis');
const { getProvider } = require('../utils/provider');
const logger = require('../utils/logger');
const chalk = require('chalk');

/**
 * Load wallets from environment variable or wallets.txt file
 */
function loadWallets() {
  const provider = getProvider();
  const keys = [];

  // 1. Check .env PRIVATE_KEYS (comma-separated or single)
  if (process.env.PRIVATE_KEYS) {
    const rawKeys = process.env.PRIVATE_KEYS.split(',');
    for (const k of rawKeys) {
      const clean = k.trim();
      if (clean && !keys.includes(clean)) {
        keys.push(clean);
      }
    }
  }

  // 2. Check wallets.txt in project root
  const walletsFilePath = path.join(__dirname, '..', '..', 'wallets.txt');
  if (fs.existsSync(walletsFilePath)) {
    const lines = fs.readFileSync(walletsFilePath, 'utf-8').split('\n');
    for (const line of lines) {
      const clean = line.trim();
      if (clean && !clean.startsWith('#') && !keys.includes(clean)) {
        keys.push(clean);
      }
    }
  }

  if (keys.length === 0) {
    return [];
  }

  const wallets = [];
  for (const k of keys) {
    try {
      const keyFormatted = k.startsWith('0x') ? k : `0x${k}`;
      const wallet = new ethers.Wallet(keyFormatted, provider);
      wallets.push(wallet);
    } catch (err) {
      logger.error(`Invalid private key format: ${k.slice(0, 10)}... Error: ${err.message}`);
    }
  }

  return wallets;
}

/**
 * Fetch token balances for a wallet
 */
async function getWalletBalances(walletAddress) {
  const provider = getProvider();
  const balances = {};

  // Native QMS
  const nativeBalance = await provider.getBalance(walletAddress);
  balances.QMS = {
    symbol: 'QMS',
    name: 'Native QMS',
    decimals: 18,
    raw: nativeBalance,
    formatted: ethers.formatEther(nativeBalance),
  };

  // ERC20 Tokens
  for (const [key, token] of Object.entries(config.TOKENS)) {
    if (token.isNative) continue;
    try {
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
      const bal = await contract.balanceOf(walletAddress);
      balances[key] = {
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        raw: bal,
        formatted: ethers.formatUnits(bal, token.decimals),
      };
    } catch (err) {
      balances[key] = {
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        raw: 0n,
        formatted: '0.0',
        error: err.message,
      };
    }
  }

  return balances;
}

/**
 * Pretty print balances for all wallets
 */
async function printAllBalances(wallets) {
  logger.header('WALLET BALANCES OVERVIEW');
  if (wallets.length === 0) {
    logger.warn('No wallets loaded. Please add PRIVATE_KEYS to .env or wallets.txt');
    return;
  }

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    console.log(chalk.bold.yellow(`Wallet #${i + 1}: ${w.address}`));
    const balances = await getWalletBalances(w.address);

    console.log(
      chalk.cyan(`  Native QMS: `) +
      chalk.white.bold(parseFloat(balances.QMS.formatted).toFixed(4)) +
      chalk.gray(` (Gas reserve: ~${config.BOT_SETTINGS.minGasReserveQMS} QMS)`)
    );

    for (const [sym, b] of Object.entries(balances)) {
      if (sym === 'QMS') continue;
      const num = parseFloat(b.formatted);
      const color = num > 0 ? chalk.green.bold : chalk.gray;
      console.log(`  ${chalk.cyan(sym.padEnd(8))}: ${color(num.toFixed(6))}`);
    }
    logger.divider();
  }
}

module.exports = {
  loadWallets,
  getWalletBalances,
  printAllBalances,
};
