"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { base } from "wagmi/chains";
import { parseEther, formatEther } from "viem";

export type GameChoice = 0 | 1 | 2; // 0=Rock, 1=Paper, 2=Scissors
export type GameState = "entry" | "waiting" | "complete";

export interface GameRound {
  id: number;
  startTime: number;
  entryEndTime: number;
  prizePool: bigint;
  chainMove?: GameChoice;
  winningChoice?: GameChoice;
  playerEntries: number;
  isComplete: boolean;
}

export interface PlayerStats {
  totalGames: number;
  wins: number;
  losses: number;
  totalWinnings: bigint;
  currentStreak: number;
}

const ROUND_DURATION_MINUTES = 15; // 15 minute rounds
const ENTRY_WINDOW_MINUTES = 15; // 15 minutes to enter (continuous back-to-back rounds)
const ENTRY_COST = BigInt(1000000); // 1 USDC (6 decimals)
const PLATFORM_FEE_PERCENTAGE = 9; // 9% platform fee
const RAKE_ADDRESS = "0x9AE06d099415A8cD55ffCe40f998bC7356c9c798";

// Mock contract ABI - in production, this would be the actual contract ABI
const CONTRACT_ABI = [
  {
    name: "enterGame",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "choice", type: "uint8" },
      { name: "roundId", type: "uint256" }
    ]
  },
  {
    name: "claimWinnings",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roundId", type: "uint256" }]
  },
  {
    name: "getCurrentRound",
    type: "function",
    stateMutability: "view",
    outputs: [{ name: "", type: "tuple", components: [
      { name: "id", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "prizePool", type: "uint256" },
      { name: "chainMove", type: "uint8" },
      { name: "playerEntries", type: "uint256" },
      { name: "isComplete", type: "bool" }
    ]}]
  }
] as const;

const CONTRACT_ADDRESS = "0x1234567890123456789012345678901234567890"; // Mock address

export function useRockPaperScissors() {
  const { address } = useAccount();
  const [currentRound, setCurrentRound] = useState<GameRound | null>(null);
  const [playerChoice, setPlayerChoice] = useState<GameChoice | null>(null);
  const [gameState, setGameState] = useState<GameState>("waiting");
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [playerStats, setPlayerStats] = useState<PlayerStats>({
    totalGames: 0,
    wins: 0,
    losses: 0,
    totalWinnings: BigInt(0),
    currentStreak: 0
  });
  const [leaderboard, setLeaderboard] = useState<Array<{
    address: string;
    wins: number;
    totalWinnings: string;
  }>>([]);

  const { writeContract, data: txHash, isPending: isSubmitting } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Calculate next round start time (15-minute rounds)
  const getNextRoundStartTime = useCallback(() => {
    const now = Date.now();
    const roundDurationMs = ROUND_DURATION_MINUTES * 60 * 1000;

    // Calculate how many rounds have passed since epoch
    const roundsSinceEpoch = Math.floor(now / roundDurationMs);

    // Next round starts at the beginning of the next 15-minute window
    return (roundsSinceEpoch + 1) * roundDurationMs;
  }, []);

  // Calculate current round info
  const getCurrentRoundInfo = useCallback(() => {
    const now = Date.now();
    const roundDurationMs = ROUND_DURATION_MINUTES * 60 * 1000;
    const entryWindowMs = ENTRY_WINDOW_MINUTES * 60 * 1000;

    // Calculate current round start time
    const roundsSinceEpoch = Math.floor(now / roundDurationMs);
    const currentStart = roundsSinceEpoch * roundDurationMs;
    const entryEndTime = currentStart + entryWindowMs;
    const roundEndTime = currentStart + roundDurationMs;

    const roundId = roundsSinceEpoch;

    // For continuous rounds, we're always in entry state
    // except for brief periods when we might show completion
    let state: GameState = "entry";

    // Check if we're near the end of a round (last 30 seconds for completion display)
    const timeUntilEnd = roundEndTime - now;
    if (timeUntilEnd <= 30000 && timeUntilEnd > 0) {
      state = "complete";
    }

    let timeRemaining: number;
    if (state === "entry") {
      timeRemaining = roundEndTime - now;
    } else if (state === "complete") {
      timeRemaining = roundEndTime - now;
    } else {
      // Time until next round starts (should be minimal for continuous rounds)
      timeRemaining = ((roundsSinceEpoch + 1) * roundDurationMs) - now;
    }

    return {
      id: roundId,
      startTime: currentStart,
      entryEndTime,
      state,
      timeRemaining
    };
  }, []);

  // Update game state every second
  useEffect(() => {
    const updateGameState = () => {
      const roundInfo = getCurrentRoundInfo();
      setGameState(roundInfo.state);
      setTimeRemaining(roundInfo.timeRemaining);

      // Mock current round data with 9% fee calculation
      const totalPot = parseEther("150");
      const platformFee = (totalPot * BigInt(PLATFORM_FEE_PERCENTAGE)) / BigInt(100);
      const prizePoolAfterFee = totalPot - platformFee;

      setCurrentRound({
        id: roundInfo.id,
        startTime: roundInfo.startTime,
        entryEndTime: roundInfo.entryEndTime,
        prizePool: prizePoolAfterFee, // Prize pool after 9% platform fee
        playerEntries: 42, // Mock player count
        isComplete: roundInfo.state === "complete",
        chainMove: roundInfo.state === "complete" ? 1 : undefined, // Mock chain move (Paper)
        winningChoice: roundInfo.state === "complete" ? 2 : undefined // Mock winning choice (Scissors beats Paper)
      });
    };

    updateGameState();
    const interval = setInterval(updateGameState, 1000);
    return () => clearInterval(interval);
  }, [getCurrentRoundInfo]);

  // Mock player stats and leaderboard
  useEffect(() => {
    if (address) {
      setPlayerStats({
        totalGames: 12,
        wins: 8,
        losses: 4,
        totalWinnings: parseEther("24.5"),
        currentStreak: 3
      });

      setLeaderboard([
        { address: "0x1234...5678", wins: 25, totalWinnings: "67.8" },
        { address: "0x9876...4321", wins: 22, totalWinnings: "56.2" },
        { address: "0x5555...9999", wins: 18, totalWinnings: "41.9" },
        { address: address.slice(0, 6) + "..." + address.slice(-4), wins: 8, totalWinnings: "24.5" },
      ]);
    }
  }, [address]);

  const enterGame = useCallback(async (choice: GameChoice) => {
    if (!currentRound || gameState !== "entry" || !address) return;

    try {
      // Call the actual smart contract to prompt for transaction
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "enterGame",
        args: [choice, BigInt(currentRound.id)],
        value: ENTRY_COST
      });

      // Set player choice after initiating transaction
      setPlayerChoice(choice);
    } catch (error) {
      console.error("Failed to enter game:", error);
    }
  }, [currentRound, gameState, address, writeContract]);

  const claimWinnings = useCallback(async (roundId: number) => {
    try {
      // Call the actual smart contract to claim winnings
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "claimWinnings",
        args: [BigInt(roundId)]
      });

      console.log(`Claiming winnings for round ${roundId}`);
    } catch (error) {
      console.error("Failed to claim winnings:", error);
    }
  }, [writeContract]);

  const getChoiceName = (choice: GameChoice): string => {
    switch (choice) {
      case 0: return "Rock";
      case 1: return "Paper";
      case 2: return "Scissors";
    }
  };

  const getChoiceEmoji = (choice: GameChoice): string => {
    switch (choice) {
      case 0: return "🪨";
      case 1: return "📄";
      case 2: return "✂️";
    }
  };

  const formatTimeRemaining = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatUSDC = (amount: bigint): string => {
    // USDC has 6 decimals
    const divisor = BigInt(1000000);
    const whole = amount / divisor;
    const fractional = amount % divisor;

    if (fractional === BigInt(0)) {
      return whole.toString();
    }

    // Format fractional part with up to 6 decimal places, removing trailing zeros
    const fractionalStr = fractional.toString().padStart(6, '0');
    const trimmedFractional = fractionalStr.replace(/0+$/, '');

    if (trimmedFractional === '') {
      return whole.toString();
    }

    return `${whole}.${trimmedFractional}`;
  };

  return {
    // Game state
    currentRound,
    gameState,
    timeRemaining,
    playerChoice,

    // Actions
    enterGame,
    claimWinnings,

    // Transaction state
    isSubmitting,
    isConfirming,

    // Stats
    playerStats,
    leaderboard,

    // Utilities
    getChoiceName,
    getChoiceEmoji,
    formatTimeRemaining,
    formatUSDC,

    // Constants
    ENTRY_COST,
    RAKE_ADDRESS
  };
}