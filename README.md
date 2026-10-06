# Qwap DEX Automation Bot (QMS Testnet)

High-performance, direct-on-chain automation bot for **Qwap** (`https://testnet.qwap.xyz`), the native Uniswap V2-style AMM on the **QMS Testnet** (Chain ID `19480`).

---

## 📌 Architecture & On-Chain Parameters

| Parameter | Value |
|---|---|
| **Network Name** | QMS Testnet (`net3`) |
| **Chain ID** | `19480` (`0x4c18`) |
| **RPC Endpoint** | `https://rpc.testnet.qms.finance` |
| **Explorer** | [https://testnet.qmsscan.io](https://testnet.qmsscan.io) |
| **Official Faucet** | [https://faucet.testnet.qms.finance](https://faucet.testnet.qms.finance) (PoW Faucet) |
| **UniswapV2Factory** | `0x93AFD9aC50822F82c7C4f2Ec8Ec2463b086Fb878` |
| **UniswapV2Router02** | `0x93AFF45f28e5DF1b55f5AEFEfB807De843b12619` |
| **Wrapped Token (WQMS)** | `0x9AA510295aC664A3d5A3182a3eFe959DE2B12c34` |

### Verified Token Contracts

- **WQMS**: `0x9AA510295aC664A3d5A3182a3eFe959DE2B12c34` (18 Decimals)
- **USDC**: `0xDfF68E53a0A8275212927c12017f5aB5f1842a04` (6 Decimals)
- **USDT**: `0x72577544F4134a25E7F09D0B5ff0Ca05A1249eBF` (6 Decimals)
- **WETH**: `0x9aff7FEe3C9C0599ca9d8F88C1f23A8dbB002325` (18 Decimals)
- **WBTC**: `0xd0D47e0bfFfDf57d79dC42b03A0AF31E608Ef2C6` (8 Decimals)

### Active Liquidity Pools (Uniswap V2 Pairs)

- `WQMS / USDC`: `0x07e2fc733B75e8107342b58fb49aE311C4DB0643`
- `WQMS / USDT`: `0xBD8D322E8170ab24cF823f3c7315ddE951E7090D`
- `WQMS / WETH`: `0xAccDED73a352887CeCbfEbEa5ddCcA5b6Fb64173`
- `WQMS / WBTC`: `0x07932dbD779BeaF25fdB72E5cE1E5dC380c28f2a`
- `WETH / USDC`: `0x176BB2fC382b959DE635f9aA6B93E3C7d631eC0D`
- `USDT / WBTC`: `0x7dE6D567EE50A2ffCb072bd2910ED694d3E03883`

---

## 🚀 Features

- **⚡ Direct On-Chain Execution**: Interacts directly with the Uniswap V2 Router via RPC. No slow, flaky browser automation.
- **🔄 Auto Swapper**:
  - Native QMS ➔ Any Token (`swapExactETHForTokens`)
  - Any Token ➔ Native QMS (`swapExactTokensForETH`)
  - Token ➔ Token (`swapExactTokensForTokens`) with automatic route discovery.
  - Native QMS Wrap/Unwrap (`deposit` & `withdraw` on WQMS).
  - Dynamic token rotation: automatically balances token holdings.
- **💧 Auto Liquidity Provider**:
  - Dynamically fetches pair reserves (`getReserves`) and computes exact optimal ratios via `router.quote()`.
  - Auto-swaps to obtain paired tokens if one is missing.
  - Automatic ERC20 token approvals (`approve(router, MaxUint256)`).
  - Supports `addLiquidityETH` and `addLiquidity`.
- **🛡️ Gas Protection**: Never drains wallet gas; always preserves a configurable minimum native QMS balance (`MIN_GAS_RESERVE`).
- **👥 Multi-Wallet Support**: Load multiple wallets from `.env` or `wallets.txt` to execute operations in sequence.
- **🎲 Anti-Sybil / Randomization**: Randomizes trade sizes and delays between transactions.

---

## 🛠️ Quick Start

### 1. Installation

```bash
npm install
```

### 2. Configure Wallets

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set your private key(s):
```env
PRIVATE_KEYS=0xYOUR_PRIVATE_KEY_HERE
```
*Or, for multiple wallets, add them line-by-line in `wallets.txt`.*

### 3. Fund Your Wallet

Get testnet QMS tokens from the official faucet:
👉 **[https://faucet.testnet.qms.finance](https://faucet.testnet.qms.finance)**

---

## 🎮 Running the Bot

### Interactive Menu
```bash
npm start
```
Displays an interactive menu where you can view balances, perform single test swaps/liquidity, or start the automated loop.

### Direct Command Line Modes

- **Check all balances**:
  ```bash
  npm run balances
  ```

- **Run Automated Swap Bot**:
  ```bash
  npm run auto-swap
  ```

- **Run Automated Liquidity Bot**:
  ```bash
  npm run auto-liquidity
  ```

- **Run Full Automated Mode (Swaps + Liquidity)**:
  ```bash
  npm run auto-all
  ```

- **Run Daily Random Scheduler (e.g. 1-5 UTC)**:
  ```bash
  npm run daily
  ```

---

## ⚙️ Configuration Options (`.env`)

| Variable | Default | Description |
|---|---|---|
| `RPC_URL` | `https://rpc.testnet.qms.finance` | QMS Testnet JSON-RPC endpoint |
| `PRIVATE_KEYS` | - | Private key(s) (comma-separated or in `wallets.txt`) |
| `SLIPPAGE_TOLERANCE` | `1.0` | Max slippage tolerance in percent (e.g. 1.0 = 1%) |
| `DEADLINE_MINUTES` | `20` | Transaction deadline in minutes |
| `MIN_GAS_RESERVE` | `0.05` | Minimum QMS to reserve for gas fees |
| `MIN_DELAY_SECONDS` | `10` | Minimum delay between transactions (seconds) |
| `MAX_DELAY_SECONDS` | `25` | Maximum delay between transactions (seconds) |
| `CYCLES` | `5` | Number of cycles to run in headless mode |
| `MIN_SWAP_AMOUNT` | `0.01` | Minimum QMS amount per random swap |
| `MAX_SWAP_AMOUNT` | `0.10` | Maximum QMS amount per random swap |
| `MIN_LIQUIDITY_AMOUNT` | `0.01` | Minimum base token amount to supply as liquidity |
| `MAX_LIQUIDITY_AMOUNT` | `0.05` | Maximum base token amount to supply as liquidity |
| `TARGET_POOLS` | `QMS-USDC,QMS-USDT,QMS-WETH` | Comma-separated list of pools for liquidity |
| `AUTO_REMOVE_LIQUIDITY` | `false` | Enable periodic removal of LP tokens |
| `REMOVE_LIQUIDITY_PERCENT` | `50` | Percentage of LP tokens to remove (1-100%) |
| `DAILY_START_HOUR_UTC` | `1` | Start of daily random window (UTC hour, e.g. 1 = 01:00 UTC) |
| `DAILY_END_HOUR_UTC` | `5` | End of daily random window (UTC hour, e.g. 5 = 05:00 UTC) |
| `RUN_IMMEDIATELY_ON_START`| `true` | If true, executes 1 cycle immediately before waiting for the next window |


