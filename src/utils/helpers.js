const { ethers } = require('ethers');

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get a random float between min and max (inclusive) with fixed decimal places
 */
function getRandomInRange(min, max, decimals = 4) {
  const rand = Math.random() * (max - min) + min;
  const factor = Math.pow(10, decimals);
  return Math.floor(rand * factor) / factor;
}

/**
 * Get random integer between min and max
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate minimum received amount with slippage
 * @param {bigint} amount
 * @param {number} slippagePercent e.g. 1.0 for 1%
 */
function calculateMinWithSlippage(amount, slippagePercent) {
  const slippageBps = BigInt(Math.floor(slippagePercent * 100)); // 1% = 100 bps
  const bipsBase = 10000n;
  return (amount * (bipsBase - slippageBps)) / bipsBase;
}

/**
 * Calculate deadline timestamp in seconds
 */
function getDeadline(minutes = 20) {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

/**
 * Format explorer link for transaction
 */
function getTxUrl(explorerUrl, txHash) {
  return `${explorerUrl.replace(/\/$/, '')}/tx/${txHash}`;
}

module.exports = {
  sleep,
  getRandomInRange,
  getRandomInt,
  calculateMinWithSlippage,
  getDeadline,
  getTxUrl,
};
