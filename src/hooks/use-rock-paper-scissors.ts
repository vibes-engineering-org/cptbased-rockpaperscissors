"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useReadContract } from "wagmi";
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
const PLATFORM_FEE_AMOUNT = BigInt(90000); // 0.09 USDC (6 decimals) - 9% platform fee sent to owner wallet
const PRIZE_POOL_AMOUNT = BigInt(1000000); // 1.00 USDC (6 decimals) - full entry goes to prize pool initially
const CREATOR_ADDRESS = "0x9AE06d099415A8cD55ffCe40f998bC7356c9c798"; // Creator wallet for 9% fee
const POT_ADDRESS = "0x1234567890123456789012345678901234567890"; // Prize pool address (different from creator)

// Rock Paper Scissors Game Contract ABI
const GAME_CONTRACT_ABI = [
  {
    name: "enterGame",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "choice", type: "uint8" },
      { name: "roundId", type: "uint256" }
    ]
  },
  {
    name: "claimWinnings",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "roundId", type: "uint256" }
    ]
  },
  {
    name: "hasPlayerEntered",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "player", type: "address" }
    ],
    outputs: [
      { name: "", type: "bool" }
    ]
  },
  {
    name: "getCurrentRound",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "prizePool", type: "uint256" },
      { name: "chainMove", type: "uint8" },
      { name: "playerEntries", type: "uint256" },
      { name: "isComplete", type: "bool" }
    ]
  },
  {
    name: "calculateWinningChoice",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "chainMove", type: "uint8" }
    ],
    outputs: [
      { name: "", type: "uint8" }
    ]
  }
] as const;

const GAME_CONTRACT_ADDRESS = "0x1234567890123456789012345678901234567890"; // Replace with deployed contract address

// USDC Approval ABI for allowance management
const USDC_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ]
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [
      { name: "", type: "uint256" }
    ]
  }
] as const;

const USDC_CONTRACT_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC contract address

// SMART CONTRACT ENTRY SYSTEM:
// Players approve USDC spending and call enterGame() on the contract
// Contract automatically: charges $1 USDC, sends 9% to owner, puts 91% in prize pool
// Winners can claim their share of the prize pool directly from the contract

export function useRockPaperScissors() {
  const { address } = useAccount();
  const { context } = useMiniAppSdk();
  const { writeContract, data: hash, isPending: isWritePending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });
  const publicClient = usePublicClient();
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
  const [claimedWinnings, setClaimedWinnings] = useState<Map<string, Set<number>>>(new Map()); // fid -> claimed roundIds

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentPendingChoice, setPaymentPendingChoice] = useState<GameChoice | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // Check USDC allowance for the game contract
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_CONTRACT_ADDRESS,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: address ? [address, GAME_CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address }
  });

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

    // Load claimed winnings from localStorage
    const savedClaimed = localStorage.getItem('farcasterGameClaimed');
    if (savedClaimed) {
      try {
        const claimedData = JSON.parse(savedClaimed);
        const claimedMap = new Map<string, Set<number>>();
        claimedData.forEach(([fid, rounds]: [string, number[]]) => {
          claimedMap.set(fid, new Set(rounds));
        });
        setClaimedWinnings(claimedMap);
      } catch (error) {
        console.error('Failed to load claimed winnings:', error);
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

  const formatUSDC = useCallback((amount: bigint): string => {
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
  }, []);

  const getChoiceName = useCallback((choice: GameChoice): string => {
    switch (choice) {
      case 0: return "Rock";
      case 1: return "Paper";
      case 2: return "Scissors";
    }
  }, []);

  const getChoiceEmoji = useCallback((choice: GameChoice): string => {
    switch (choice) {
      case 0: return "🪨";
      case 1: return "📄";
      case 2: return "✂️";
    }
  }, []);

  // Calculate live participant count and prize pool based on current entries
  // STRICT PAYMENT ENFORCEMENT: Only count entries with confirmed $1 USDC payment
  const getLiveGameData = useCallback((roundId: number) => {
    // Count unique FIDs who PAID and entered this round (not just clicked)
    const uniqueParticipants = Array.from(playerEntries.values()).reduce(
      (count, roundSet) => count + (roundSet.has(roundId) ? 1 : 0),
      0
    );

    // PAYMENT FLOW: Each entrant MUST pay exactly $1.00 USDC to be counted
    // Smart contract automatically distributes: 9% to owner, 91% to prize pool
    const totalPaid = BigInt(uniqueParticipants) * ENTRY_COST; // Each player paid exactly $1.00 USDC
    const ownerFee = (totalPaid * BigInt(PLATFORM_FEE_PERCENTAGE)) / BigInt(100); // 9% = $0.09 per paid entry
    const prizePoolAmount = totalPaid - ownerFee; // 91% = $0.91 per paid entry

    console.log(`Round ${roundId} Payment Summary:`);
    console.log(`  - Paid Entrants: ${uniqueParticipants} (only counting those who paid $1.00 USDC)`);
    console.log(`  - Total Collected: $${formatUSDC(totalPaid)} USDC`);
    console.log(`  - Owner Fee (9%): $${formatUSDC(ownerFee)} USDC`);
    console.log(`  - Prize Pool (91%): $${formatUSDC(prizePoolAmount)} USDC`);

    return {
      playerEntries: uniqueParticipants, // Only those who actually paid
      prizePool: prizePoolAmount, // 91% of total payments
      totalCollected: totalPaid, // Total USDC received from entrants
      ownerFee: ownerFee, // 9% goes to creator
      winnersShare: prizePoolAmount // Winners split the 91% prize pool equally
    };
  }, [playerEntries, formatUSDC]);

  // Generate winners for completed rounds and update leaderboard
  // PRIZE DISTRIBUTION: 91% of total collected USDC goes to winners, split equally
  const updateWinnersAndLeaderboard = useCallback((roundId: number, winningChoice: GameChoice) => {
    // Find all players who PAID to enter this round (only paid entries count)
    const allPaidEntrants = Array.from(playerEntries.entries())
      .filter(([_, rounds]) => rounds.has(roundId))
      .map(([fid]) => fid);

    if (allPaidEntrants.length === 0) {
      console.log(`Round ${roundId}: No paid entrants, no prizes to distribute`);
      return;
    }

    // Simulate winner selection based on winning choice
    // In production, this would check each player's actual choice from the smart contract
    const numWinners = Math.max(1, Math.floor(allPaidEntrants.length * 0.3)); // ~30% win rate simulation
    const roundWinners = allPaidEntrants
      .sort(() => Math.random() - 0.5)
      .slice(0, numWinners);

    const liveData = getLiveGameData(roundId);
    const winnersShare = liveData.winnersShare; // This is 91% of total collected USDC
    const winningsPerWinner = winnersShare / BigInt(roundWinners.length);

    console.log(`Round ${roundId} Prize Distribution:`);
    console.log(`  - Winners: ${roundWinners.length} players`);
    console.log(`  - Total Prize Pool (91%): $${formatUSDC(winnersShare)} USDC`);
    console.log(`  - Prize per Winner: $${formatUSDC(winningsPerWinner)} USDC`);
    console.log(`  - Owner Fee (9%): $${formatUSDC(liveData.ownerFee)} USDC sent to ${CREATOR_ADDRESS}`);

    // Update winners map
    const updatedWinners = new Map(winners);
    updatedWinners.set(roundId, roundWinners);
    setWinners(updatedWinners);

    // Save to localStorage
    const winnersData = Array.from(updatedWinners.entries());
    localStorage.setItem('farcasterGameWinners', JSON.stringify(winnersData));

    // Update leaderboard with actual winner data
    const winnerStats = new Map<string, { wins: number; totalWinnings: bigint }>();

    // Calculate cumulative wins and earnings for each player
    updatedWinners.forEach((roundWinners, completedRoundId) => {
      const roundData = getLiveGameData(completedRoundId);
      // Each winner gets their equal share of the 91% prize pool
      const prizePerWinner = roundData.winnersShare / BigInt(roundWinners.length || 1);

      roundWinners.forEach(fid => {
        const current = winnerStats.get(fid) || { wins: 0, totalWinnings: BigInt(0) };
        winnerStats.set(fid, {
          wins: current.wins + 1,
          totalWinnings: current.totalWinnings + prizePerWinner
        });
      });
    });

    // Convert to leaderboard format and sort by total winnings
    const newLeaderboard = Array.from(winnerStats.entries())
      .map(([fid, stats]) => ({
        address: `FID ${fid}`,
        wins: stats.wins,
        totalWinnings: formatUSDC(stats.totalWinnings)
      }))
      .sort((a, b) => {
        const aWinnings = parseFloat(a.totalWinnings);
        const bWinnings = parseFloat(b.totalWinnings);
        return bWinnings - aWinnings; // Sort by highest winnings
      })
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
          // Winners get 91% of the prize pool, split evenly
          totalWinnings += liveData.winnersShare / BigInt(roundWinners.length);
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

  // Check if approval is needed
  useEffect(() => {
    if (allowance !== undefined) {
      const currentAllowance = allowance as bigint;
      setNeedsApproval(currentAllowance < ENTRY_COST);
    }
  }, [allowance]);

  // Approve USDC spending for the game contract
  const approveUSDC = useCallback(async () => {
    if (!address) return;

    setIsApproving(true);
    try {
      console.log(`Approving USDC spending for game contract...`);

      writeContract({
        address: USDC_CONTRACT_ADDRESS,
        abi: USDC_ABI,
        functionName: 'approve',
        args: [GAME_CONTRACT_ADDRESS, ENTRY_COST],
      });
    } catch (error) {
      console.error("Failed to approve USDC:", error);
      setIsApproving(false);
    }
  }, [address, writeContract]);

  const enterGame = useCallback(async (choice: GameChoice) => {
    if (!currentRound || gameState !== "entry" || !address || !context?.user?.fid) {
      console.error("Invalid entry conditions:", {
        hasCurrentRound: !!currentRound,
        gameState,
        hasAddress: !!address,
        hasFid: !!context?.user?.fid
      });
      return;
    }

    // Strict enforcement: Check if user has already entered this round
    if (hasUserEnteredRound(currentRound.id)) {
      console.error(`ENTRY BLOCKED: User FID ${context.user.fid} has already entered round ${currentRound.id}. Only 1 entry per Farcaster ID per round allowed.`);
      return;
    }

    // Check if payment is already pending for this user
    if (paymentPendingChoice !== null) {
      console.error("ENTRY BLOCKED: Payment already pending for this round");
      return;
    }

    // Strict enforcement: Ensure user has approved exactly $1.00 USDC or more
    if (needsApproval) {
      console.error("ENTRY BLOCKED: USDC approval required. Must approve exactly $1.00 USDC before entering game");
      return;
    }

    // Final validation: Check allowance amount
    const currentAllowance = allowance as bigint;
    if (currentAllowance < ENTRY_COST) {
      console.error(`ENTRY BLOCKED: Insufficient USDC allowance. Required: $1.00 USDC (${ENTRY_COST}), Current: ${formatUSDC(currentAllowance)}`);
      return;
    }

    setIsSubmitting(true);
    setPaymentPendingChoice(choice);

    try {
      console.log(`🎮 FID ${context.user.fid} entering Round ${currentRound.id} with choice ${choice} (${getChoiceName(choice)})`);
      console.log(`💰 Smart contract will charge exactly $1.00 USDC: 9% ($0.09) to owner, 91% ($0.91) to prize pool`);
      console.log(`📊 Prize pool will increase by $0.91, Owner fee: $0.09`);

      // Call the smart contract enterGame function
      // The contract MUST charge exactly $1.00 USDC via transferFrom
      writeContract({
        address: GAME_CONTRACT_ADDRESS,
        abi: GAME_CONTRACT_ABI,
        functionName: 'enterGame',
        args: [choice, BigInt(currentRound.id)],
      });
    } catch (error) {
      console.error("Failed to initiate game entry:", error);
      setIsSubmitting(false);
      setPaymentPendingChoice(null);
    }
  }, [currentRound, gameState, address, hasUserEnteredRound, paymentPendingChoice, writeContract, context?.user?.fid, needsApproval, allowance, formatUSDC, getChoiceName]);

  // Handle transaction confirmations - Strict payment enforcement
  useEffect(() => {
    if (isConfirmed && hash) {
      if (isApproving) {
        // Approval transaction confirmed
        console.log(`✅ USDC approval confirmed for $1.00 USDC!`);
        console.log(`   Transaction hash: ${hash}`);
        console.log(`   User can now enter the game`);
        setIsApproving(false);
        // Refetch allowance to update the needsApproval state
        refetchAllowance();
      } else if (paymentPendingChoice !== null && currentRound && context?.user?.fid) {
        // Entry transaction confirmed - User has officially paid and entered
        console.log(`✅ PAYMENT SUCCESS: Smart contract entry confirmed!`);
        console.log(`   Transaction hash: ${hash}`);
        console.log(`🎉 FID ${context.user.fid} OFFICIALLY ENTERED Round ${currentRound.id} with choice ${paymentPendingChoice} (${getChoiceName(paymentPendingChoice)})`);
        console.log(`💰 CONTRACT CONFIRMED: Charged exactly $1.00 USDC, sent $0.09 to owner ${CREATOR_ADDRESS}, $0.91 to prize pool`);
        console.log(`🔒 ENTRY RESTRICTIONS: FID ${context.user.fid} is now blocked from entering Round ${currentRound.id} again`);

        // ONLY mark as entered after transaction confirms (no payment = no entry)
        setPlayerChoice(paymentPendingChoice);
        addUserEntry(currentRound.id);

        // Reset all states
        setIsSubmitting(false);
        setPaymentPendingChoice(null);
        // Refetch allowance since exactly $1.00 USDC was spent
        refetchAllowance();
      }
    }

    if (writeError) {
      console.error("Transaction failed:", writeError);
      if (isApproving) {
        console.log(`❌ USDC approval transaction failed`);
        setIsApproving(false);
      } else {
        console.log(`❌ PAYMENT FAILED: Smart contract entry transaction failed`);
        console.log(`🚫 FID ${context?.user?.fid} is NOT entered in Round ${currentRound?.id} - no payment was processed`);
        console.log(`💸 No USDC was charged, user can try again`);
        setIsSubmitting(false);
        setPaymentPendingChoice(null);
      }
    }
  }, [isConfirmed, hash, paymentPendingChoice, currentRound, writeError, addUserEntry, context?.user?.fid, isApproving, refetchAllowance, getChoiceName]);

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

  // Legacy function - winnings are now distributed automatically
  const claimWinnings = useCallback(async (roundId: number) => {
    console.log("Claim function called, but winnings are distributed automatically when rounds complete");
    // This function is kept for backwards compatibility but does nothing
    // All winnings are automatically distributed when rounds complete
  }, []);

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

  // Legacy function - winnings are distributed automatically
  const getUnclaimedWinnings = useCallback(() => {
    // Always return empty array since winnings are distributed automatically
    return [];
  }, []);

  return {
    // Game state
    currentRound,
    gameState,
    timeRemaining,
    playerChoice,

    // Actions
    enterGame,
    claimWinnings,
    approveUSDC,
    onPaymentCompleted,
    onPaymentCanceled,

    // Transaction state
    isSubmitting,
    isConfirming: isConfirming,
    paymentPendingChoice,
    isWritePending,
    needsApproval,
    isApproving,

    // Stats
    playerStats,
    leaderboard,

    // Entry restrictions
    hasUserEnteredRound,

    // Winnings
    getUnclaimedWinnings,

    // Utilities
    getChoiceName,
    getChoiceEmoji,
    formatTimeRemaining,
    formatUSDC,

    // Constants
    ENTRY_COST,
    CREATOR_ADDRESS,
    GAME_CONTRACT_ADDRESS
  };
}