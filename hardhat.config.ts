import { defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

export default defineConfig({
  plugins: [hardhatToolboxViem],

  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },

      viaIR: true,
      evmVersion: "london",
    },
  },

  networks: {
    integration: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 9009,
      initialBaseFeePerGas: 0,
    },
    traceforge: {
      type: "http",
      chainType: "l1",
      url:
        process.env.TRACEFORGE_RPC_URL ??
        ["http", "://", "127.0.0.1", ":", "8545"].join(""),
      chainId: 9009,
      gasPrice: 0,
    },
  },
});
