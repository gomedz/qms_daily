const { ethers } = require('ethers');
const config = require('../config');

let providerInstance = null;

function getProvider() {
  if (!providerInstance) {
    providerInstance = new ethers.JsonRpcProvider(config.NETWORK.rpcUrl, {
      chainId: config.NETWORK.chainId,
      name: config.NETWORK.name,
    });
  }
  return providerInstance;
}

module.exports = {
  getProvider,
};
