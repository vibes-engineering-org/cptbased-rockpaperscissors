"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { base } from "wagmi/chains";
import { parseEther, formatEther } from "viem";
import { useMiniAppSdk } from "./use-miniapp-sdk";

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
const RAKE_AMOUNT = BigInt(90000); // 0.09 USDC (6 decimals) - platform fee sent to owner wallet
const POT_AMOUNT = BigInt(910000); // 0.91 USDC (6 decimals) - amount that goes to the pot
const CREATOR_ADDRESS = "0x9AE06d099415A8cD55ffCe40f998bC7356c9c798"; // Creator wallet for 9% fee
const POT_ADDRESS = "0x1234567890123456789012345678901234567890"; // Prize pool address (different from creator)

// USDC Contract ABI for direct transfers
const USDC_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ]
  }
] as const;

const USDC_CONTRACT_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC contract address

// DUAL TRANSACTION ENTRY SYSTEM:
// Players make two USDC transfers:
// 1. $0.91 USDC to the pot address (prize pool)
// 2. $0.09 USDC to the creator address (platform fee)
// Both transactions must complete successfully for entry to be confirmed
// Entry is confirmed when both payments are successful

export function useRockPaperScissors() {
  const { address } = useAccount();
  const { context } = useMiniAppSdk();
  const { writeContract, data: hash, isPending: isWritePending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });
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
  const [playerEntries, setPlayerEntries] = useState<Map<string, Set<number>>>(new Map());
  const [winners, setWinners] = useState<Map<number, string[]>>(new Map()); // roundId -> farcasterIds

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentPendingChoice, setPaymentPendingChoice] = useState<GameChoice | null>(null);
  const [potTransactionHash, setPotTransactionHash] = useState<string | null>(null);
  const [creatorTransactionHash, setCreatorTransactionHash] = useState<string | null>(null);

  // Check if current Farcaster user has already entered this round
  const hasUserEnteredRound = useCallback((roundId: number): boolean => {
    if (!context?.user?.fid) return false;
    const userFid = context.user.fid.toString();
    const userRoundEntries = playerEntries.get(userFid);
    return userRoundEntries?.has(roundId) ?? false;
  }, [context?.user?.fid, playerEntries]);

  // Add entry for current user and round
  const addUserEntry = useCallback((roundId: number) => {
    if (!context?.user?.fid) return;
    const userFid = context.user.fid.toString();
    const updatedEntries = new Map(playerEntries);
    const userRoundEntries = updatedEntries.get(userFid) ?? new Set<number>();
    userRoundEntries.add(roundId);
    updatedEntries.set(userFid, userRoundEntries);
    setPlayerEntries(updatedEntries);

    // Store in localStorage for persistence
    const entriesData = Array.from(updatedEntries.entries()).map(([fid, rounds]) => [
      fid,
      Array.from(rounds)
    ]);
    localStorage.setItem('farcasterGameEntries', JSON.stringify(entriesData));
  }, [context?.user?.fid, playerEntries]);

  // Load entries from localStorage on mount
  useEffect(() => {
    const savedEntries = localStorage.getItem('farcasterGameEntries');
    if (savedEntries) {
      try {
        const entriesData = JSON.parse(savedEntries);
        const entriesMap = new Map<string, Set<number>>();
        entriesData.forEach(([fid, rounds]: [string, number[]]) => {
          entriesMap.set(fid, new Set(rounds));
        });
        setPlayerEntries(entriesMap);
      } catch (error) {
        console.error('Failed to load game entries:', error);
      }
    }

    // Load winners from localStorage
    const savedWinners = localStorage.getItem('farcasterGameWinners');
    if (savedWinners) {
      try {
        const winnersData = JSON.parse(savedWinners);
        const winnersMap = new Map<number, string[]>();
        winnersData.forEach(([roundId, fids]: [number, string[]]) => {
          winnersMap.set(roundId, fids);
        });
        setWinners(winnersMap);
      } catch (error) {
        console.error('Failed to load game winners:', error);
      }
    }
  }, []);


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

  // Calculate live participant count and prize pool based on current entries
  const getLiveGameData = useCallback((roundId: number) => {
    // Count unique FIDs who entered this round
    const uniqueParticipants = Array.from(playerEntries.values()).reduce(
      (count, roundSet) => count + (roundSet.has(roundId) ? 1 : 0),
      0
    );

    // Calculate total pot based on entries (1 USDC per entry)
    const totalEntries = BigInt(uniqueParticipants) * ENTRY_COST;

    // Calculate rake amounts:
    // Each player pays 1 USDC, 0.09 USDC goes to rake wallet, so net contribution is 0.91 USDC
    const netContributionPerPlayer = ENTRY_COST - RAKE_AMOUNT; // 0.91 USDC
    const totalNetContributions = BigInt(uniqueParticipants) * netContributionPerPlayer;

    // The prize pool is the total net contributions (after rake to platform)
    const prizePool = totalNetContributions;

    return {
      playerEntries: uniqueParticipants,
      prizePool: prizePool > 0 ? prizePool : BigInt(0) // Show actual prize pool, 0 if no entries
    };
  }, [playerEntries]);

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

  // Generate winners for completed rounds and update leaderboard
  const updateWinnersAndLeaderboard = useCallback((roundId: number, winningChoice: GameChoice) => {
    // Find all players who entered this round with the winning choice
    // For demo purposes, we'll simulate this by randomly selecting some entries
    const allEntrants = Array.from(playerEntries.entries())
      .filter(([_, rounds]) => rounds.has(roundId))
      .map(([fid]) => fid);

    if (allEntrants.length === 0) return;

    // Simulate winner selection (in production, this would be determined by blockchain)
    const numWinners = Math.max(1, Math.floor(allEntrants.length * 0.3)); // ~30% win rate
    const roundWinners = allEntrants
      .sort(() => Math.random() - 0.5)
      .slice(0, numWinners);

    // Update winners map
    const updatedWinners = new Map(winners);
    updatedWinners.set(roundId, roundWinners);
    setWinners(updatedWinners);

    // Save to localStorage
    const winnersData = Array.from(updatedWinners.entries());
    localStorage.setItem('farcasterGameWinners', JSON.stringify(winnersData));

    // Update leaderboard with actual winner data
    const winnerStats = new Map<string, { wins: number; totalWinnings: bigint }>();

    // Count wins and calculate winnings for each player
    updatedWinners.forEach((roundWinners, completedRoundId) => {
      const liveData = getLiveGameData(completedRoundId);
      const winningsPerPlayer = liveData.prizePool / BigInt(roundWinners.length || 1);

      roundWinners.forEach(fid => {
        const current = winnerStats.get(fid) || { wins: 0, totalWinnings: BigInt(0) };
        winnerStats.set(fid, {
          wins: current.wins + 1,
          totalWinnings: current.totalWinnings + winningsPerPlayer
        });
      });
    });

    // Convert to leaderboard format and sort by wins
    const newLeaderboard = Array.from(winnerStats.entries())
      .map(([fid, stats]) => ({
        address: `FID ${fid}`,
        wins: stats.wins,
        totalWinnings: formatUSDC(stats.totalWinnings)
      }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 10);

    setLeaderboard(newLeaderboard);
  }, [playerEntries, winners, getLiveGameData, formatUSDC]);

  // Generate deterministic but seemingly random chain move based on round ID
  const generateChainMove = useCallback((roundId: number): GameChoice => {
    // Use round ID and current timestamp to generate deterministic randomness
    const seed = roundId * 1337 + Math.floor(Date.now() / (15 * 60 * 1000));

    // Simple hash function to distribute values more evenly
    let hash = seed;
    hash = ((hash >> 16) ^ hash) * 0x45d9f3b;
    hash = ((hash >> 16) ^ hash) * 0x45d9f3b;
    hash = (hash >> 16) ^ hash;

    return Math.abs(hash) % 3 as GameChoice;
  }, []);

  // Calculate winning choice based on chain move
  const calculateWinningChoice = useCallback((chainMove: GameChoice): GameChoice => {
    // What beats the chain's move?
    switch (chainMove) {
      case 0: // Rock - Paper beats Rock
        return 1;
      case 1: // Paper - Scissors beats Paper
        return 2;
      case 2: // Scissors - Rock beats Scissors
        return 0;
    }
  }, []);

  // Update game state every second
  useEffect(() => {
    const updateGameState = () => {
      const roundInfo = getCurrentRoundInfo();
      setGameState(roundInfo.state);
      setTimeRemaining(roundInfo.timeRemaining);

      const liveData = getLiveGameData(roundInfo.id);

      const isComplete = roundInfo.state === "complete";
      const chainMove = isComplete ? generateChainMove(roundInfo.id) : undefined;
      const winningChoice = isComplete && chainMove !== undefined ? calculateWinningChoice(chainMove) : undefined;

      setCurrentRound({
        id: roundInfo.id,
        startTime: roundInfo.startTime,
        entryEndTime: roundInfo.entryEndTime,
        prizePool: liveData.prizePool,
        playerEntries: liveData.playerEntries,
        isComplete,
        chainMove,
        winningChoice
      });

      // Generate winners when round completes
      if (isComplete && winningChoice !== undefined && !winners.has(roundInfo.id)) {
        updateWinnersAndLeaderboard(roundInfo.id, winningChoice);
      }

      // Check if player has choice for current round
      if (hasUserEnteredRound(roundInfo.id) && !playerChoice) {
        setPlayerChoice(0); // Mock choice - in production, retrieve from storage
      } else if (!hasUserEnteredRound(roundInfo.id) && playerChoice) {
        setPlayerChoice(null);
      }

      // Clear pending payment state if round changed
      if (paymentPendingChoice !== null && currentRound && currentRound.id !== roundInfo.id) {
        setPaymentPendingChoice(null);
        setIsSubmitting(false);
        console.log("Round changed - clearing pending payment state");
      }
    };

    updateGameState();
    const interval = setInterval(updateGameState, 1000);
    return () => clearInterval(interval);
  }, [getCurrentRoundInfo, getLiveGameData, hasUserEnteredRound, playerChoice, winners, updateWinnersAndLeaderboard, generateChainMove, calculateWinningChoice, paymentPendingChoice, currentRound]);

  // Mock player stats - in production, calculate from actual data
  useEffect(() => {
    if (address && context?.user?.fid) {
      const userFid = context.user.fid.toString();

      // Calculate actual stats from winners data
      let wins = 0;
      let totalWinnings = BigInt(0);

      winners.forEach((roundWinners, roundId) => {
        if (roundWinners.includes(userFid)) {
          wins += 1;
          const liveData = getLiveGameData(roundId);
          totalWinnings += liveData.prizePool / BigInt(roundWinners.length);
        }
      });

      const totalGames = Array.from(playerEntries.values()).reduce(
        (total, rounds) => total + rounds.size, 0
      );

      setPlayerStats({
        totalGames,
        wins,
        losses: totalGames - wins,
        totalWinnings,
        currentStreak: wins > 0 ? Math.floor(Math.random() * wins) + 1 : 0 // Mock streak
      });
    }
  }, [address, context?.user?.fid, winners, playerEntries, getLiveGameData]);

  const enterGame = useCallback(async (choice: GameChoice) => {
    if (!currentRound || gameState !== "entry" || !address) return;

    // Check if user has already entered this round or has payment pending
    if (hasUserEnteredRound(currentRound.id)) {
      console.log("User has already entered this round");
      return;
    }

    if (paymentPendingChoice !== null) {
      console.log("Payment already pending for this round");
      return;
    }

    setIsSubmitting(true);
    setPaymentPendingChoice(choice);

    try {
      console.log(`Entering game with choice ${choice} - splitting $1 USDC payment...`);
      console.log(`Payment breakdown: $0.91 USDC to pot + $0.09 USDC to creator`);

      // First transfer: $0.91 USDC to pot address
      writeContract({
        address: USDC_CONTRACT_ADDRESS,
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [POT_ADDRESS, POT_AMOUNT],
      });
    } catch (error) {
      console.error("Failed to initiate game entry:", error);
      setIsSubmitting(false);
      setPaymentPendingChoice(null);
    }
  }, [currentRound, gameState, address, hasUserEnteredRound, paymentPendingChoice, writeContract]);

  // Handle transaction confirmations
  useEffect(() => {
    if (isConfirmed && hash && paymentPendingChoice !== null && currentRound) {
      if (!potTransactionHash) {
        // First transaction (pot) confirmed
        setPotTransactionHash(hash);
        console.log(`✅ Pot payment confirmed: $0.91 USDC to ${POT_ADDRESS}`);
        console.log(`🔄 Initiating creator payment: $0.09 USDC to ${CREATOR_ADDRESS}`);

        // Second transfer: $0.09 USDC to creator address
        writeContract({
          address: USDC_CONTRACT_ADDRESS,
          abi: USDC_ABI,
          functionName: 'transfer',
          args: [CREATOR_ADDRESS, RAKE_AMOUNT],
        });
      } else if (!creatorTransactionHash) {
        // Second transaction (creator) confirmed
        setCreatorTransactionHash(hash);
        console.log(`✅ Creator payment confirmed: $0.09 USDC to ${CREATOR_ADDRESS}`);
        console.log(`🎉 Player successfully entered Round ${currentRound.id} with choice ${paymentPendingChoice} (${getChoiceName(paymentPendingChoice)})`);
        console.log(`💰 Total payments: $0.91 USDC to pot + $0.09 USDC to creator = $1.00 USDC`);

        setPlayerChoice(paymentPendingChoice);
        addUserEntry(currentRound.id);

        // Reset all states
        setIsSubmitting(false);
        setPaymentPendingChoice(null);
        setPotTransactionHash(null);
        setCreatorTransactionHash(null);
      }
    }

    if (writeError) {
      console.error("Transaction failed:", writeError);
      console.log("❌ Payment failed - user is NOT entered in this round");
      setIsSubmitting(false);
      setPaymentPendingChoice(null);
      setPotTransactionHash(null);
      setCreatorTransactionHash(null);
    }
  }, [isConfirmed, hash, paymentPendingChoice, currentRound, writeError, addUserEntry, potTransactionHash, creatorTransactionHash, writeContract]);

  // Legacy functions for backwards compatibility with existing UI
  const onPaymentCompleted = useCallback((choice: GameChoice) => {
    // This is now handled by the useEffect above
    console.log(`Payment completed callback called for choice ${choice}`);
  }, []);

  const onPaymentCanceled = useCallback(() => {
    setIsSubmitting(false);
    setPaymentPendingChoice(null);
    console.log("❌ Payment was canceled or failed - user is NOT entered in this round");
  }, []);

  const claimWinnings = useCallback(async (roundId: number) => {
    try {
      // For demo purposes - in production this would call the actual smart contract
      console.log(`Claiming winnings for round ${roundId}`);
    } catch (error) {
      console.error("Failed to claim winnings:", error);
    }
  }, []);

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

  return {
    // Game state
    currentRound,
    gameState,
    timeRemaining,
    playerChoice,

    // Actions
    enterGame,
    claimWinnings,
    onPaymentCompleted,
    onPaymentCanceled,

    // Transaction state
    isSubmitting,
    isConfirming: isConfirming,
    paymentPendingChoice,
    isWritePending,

    // Stats
    playerStats,
    leaderboard,

    // Entry restrictions
    hasUserEnteredRound,

    // Utilities
    getChoiceName,
    getChoiceEmoji,
    formatTimeRemaining,
    formatUSDC,

    // Constants
    ENTRY_COST,
    CREATOR_ADDRESS,
    POT_ADDRESS
  };
}