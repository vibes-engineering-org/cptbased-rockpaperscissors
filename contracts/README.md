# Rock Paper Scissors Smart Contract Deployment

## Contract Overview

The `RockPaperScissorsGame.sol` contract implements a fully automated betting system that:

1. **Enforces exactly $1 USDC payment** for entry
2. **Automatically rakes $0.09 USDC** to the platform wallet (0x9AE06d099415A8cD55ffCe40f998bC7356c9c798)
3. **Adds remaining $0.91 USDC** to the prize pool
4. **Prevents double entry** per round per player
5. **Only records entry after successful payment**

## Pre-Deployment Setup

1. Install dependencies:
```bash
npm install @openzeppelin/contracts
```

2. Set up Hardhat or Foundry for deployment

## Deployment Steps

### Using Hardhat

1. Create deployment script `scripts/deploy.js`:
```javascript
const { ethers } = require("hardhat");

async function main() {
  const RockPaperScissorsGame = await ethers.getContractFactory("RockPaperScissorsGame");
  const game = await RockPaperScissorsGame.deploy();
  await game.deployed();

  console.log("RockPaperScissorsGame deployed to:", game.address);

  // Verify contract on Basescan
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("Waiting for block confirmations...");
    await game.deployTransaction.wait(6);

    await hre.run("verify:verify", {
      address: game.address,
      constructorArguments: [],
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

2. Deploy to Base:
```bash
npx hardhat run scripts/deploy.js --network base
```

### Using Foundry

1. Deploy:
```bash
forge create --rpc-url https://mainnet.base.org \
  --private-key $PRIVATE_KEY \
  --verify --verifier-url https://api.basescan.org/api \
  --etherscan-api-key $BASESCAN_API_KEY \
  src/RockPaperScissorsGame.sol:RockPaperScissorsGame
```

## Post-Deployment

1. **Update Frontend**: Replace the mock address in `src/hooks/use-rock-paper-scissors.ts`:
```typescript
const CONTRACT_ADDRESS = "YOUR_DEPLOYED_CONTRACT_ADDRESS";
```

2. **Test Entry Flow**:
   - User must have USDC in wallet
   - First transaction: Approve USDC spending
   - Second transaction: Enter game (automatic rake + prize pool distribution)

3. **Verify Rake Distribution**:
   - Check that 0x9AE06d099415A8cD55ffCe40f998bC7356c9c798 receives 0.09 USDC per entry
   - Verify prize pool increases by 0.91 USDC per entry

## Key Contract Features

- **Single Transaction Entry**: After USDC approval, entry is atomic
- **Automatic Rake**: No manual rake collection needed
- **Entry Validation**: Prevents duplicate entries per round
- **Emergency Functions**: Owner can withdraw funds if needed
- **Gas Optimized**: Minimal gas usage for frequent transactions

## Security Notes

- Contract uses OpenZeppelin's battle-tested components
- Reentrancy protection on all external functions
- Entry validation prevents gaming the system
- Emergency withdraw only accessible to contract owner

## Integration with Frontend

The React hook automatically handles the two-step process:
1. **Approval Step**: User approves USDC spending
2. **Entry Step**: Contract transfers USDC, distributes rake, adds to prize pool

Users see clear feedback during both steps with loading states and error handling.