require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({
    path: "../backend/.env"
});

module.exports = {
    solidity: "0.8.28",

    networks: {
        hardhat: {},

        localhost: {
            url: "http://127.0.0.1:8545"
        },

        // Uses the same variable names as the backend (RPC_URL / PRIVATE_KEY);
        // the old SEPOLIA_* names still work. Skipped when unset so local
        // compile/test does not crash on `accounts: [undefined]`.
        ...((process.env.RPC_URL || process.env.SEPOLIA_RPC_URL) &&
            (process.env.PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY)
            ? {
                sepolia: {
                    url: process.env.RPC_URL || process.env.SEPOLIA_RPC_URL,
                    accounts: [process.env.PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY]
                }
            }
            : {})
    }
};