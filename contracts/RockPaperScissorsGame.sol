// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RockPaperScissorsGame is ReentrancyGuard, Ownable {
    IERC20 public constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913); // Base USDC

    uint256 public constant ENTRY_COST = 1000000; // 1 USDC (6 decimals)
    uint256 public constant RAKE_AMOUNT = 90000; // 0.09 USDC (6 decimals)
    uint256 public constant PRIZE_CONTRIBUTION = 910000; // 0.91 USDC (6 decimals)

    address public constant RAKE_ADDRESS = 0x9AE06d099415A8cD55ffCe40f998bC7356c9c798;

    struct GameRound {
        uint256 id;
        uint256 startTime;
        uint256 prizePool;
        uint8 chainMove;
        uint256 playerEntries;
        bool isComplete;
        mapping(address => uint8) playerChoices;
        mapping(address => bool) hasEntered;
        mapping(address => bool) hasClaimed;
        address[] players;
    }

    mapping(uint256 => GameRound) public rounds;
    uint256 public currentRoundId;

    event PlayerEntered(uint256 indexed roundId, address indexed player, uint8 choice);
    event RoundCompleted(uint256 indexed roundId, uint8 chainMove, uint8 winningChoice);
    event WinningsClaimed(uint256 indexed roundId, address indexed player, uint256 amount);
    event RakeTransferred(uint256 amount);

    error AlreadyEntered();
    error InsufficientPayment();
    error TransferFailed();
    error RoundNotComplete();
    error NotWinner();
    error AlreadyClaimed();
    error InvalidChoice();

    constructor() {}

    modifier validChoice(uint8 choice) {
        if (choice > 2) revert InvalidChoice();
        _;
    }

    function enterGame(uint8 choice, uint256 roundId) external validChoice(choice) nonReentrant {
        GameRound storage round = rounds[roundId];

        // Check if player has already entered this round
        if (round.hasEntered[msg.sender]) {
            revert AlreadyEntered();
        }

        // Transfer USDC from player to contract
        if (!USDC.transferFrom(msg.sender, address(this), ENTRY_COST)) {
            revert TransferFailed();
        }

        // Automatically transfer rake to platform wallet
        if (!USDC.transfer(RAKE_ADDRESS, RAKE_AMOUNT)) {
            revert TransferFailed();
        }

        // Add remaining amount to prize pool
        round.prizePool += PRIZE_CONTRIBUTION;

        // Record player entry
        round.hasEntered[msg.sender] = true;
        round.playerChoices[msg.sender] = choice;
        round.players.push(msg.sender);
        round.playerEntries++;

        emit PlayerEntered(roundId, msg.sender, choice);
        emit RakeTransferred(RAKE_AMOUNT);
    }

    function completeRound(uint256 roundId, uint8 chainMove) external onlyOwner validChoice(chainMove) {
        GameRound storage round = rounds[roundId];

        if (round.isComplete) return;

        round.chainMove = chainMove;
        round.isComplete = true;

        uint8 winningChoice = calculateWinningChoice(chainMove);

        // Automatically distribute prizes to winners
        _distributeWinnings(roundId, winningChoice);

        emit RoundCompleted(roundId, chainMove, winningChoice);
    }

    function _distributeWinnings(uint256 roundId, uint8 winningChoice) internal {
        GameRound storage round = rounds[roundId];

        // Count winners first
        uint256 winnerCount = 0;
        for (uint256 i = 0; i < round.players.length; i++) {
            if (round.playerChoices[round.players[i]] == winningChoice) {
                winnerCount++;
            }
        }

        if (winnerCount == 0) {
            // No winners - prize pool stays in contract for next round or emergency withdrawal
            return;
        }

        // Calculate winnings per winner
        uint256 winningsPerPlayer = round.prizePool / winnerCount;

        // Distribute to all winners automatically
        for (uint256 i = 0; i < round.players.length; i++) {
            address player = round.players[i];
            if (round.playerChoices[player] == winningChoice && !round.hasClaimed[player]) {
                round.hasClaimed[player] = true;

                if (USDC.transfer(player, winningsPerPlayer)) {
                    emit WinningsClaimed(roundId, player, winningsPerPlayer);
                }
            }
        }
    }

    // Legacy function kept for compatibility - winnings are now distributed automatically
    function claimWinnings(uint256 roundId) external view {
        // All winnings are automatically distributed when rounds complete
        // This function is kept for compatibility but does nothing
        revert("Winnings distributed automatically");
    }

    function calculateWinningChoice(uint8 chainMove) public pure returns (uint8) {
        // What beats the chain's move?
        if (chainMove == 0) return 1; // Rock -> Paper wins
        if (chainMove == 1) return 2; // Paper -> Scissors wins
        return 0; // Scissors -> Rock wins
    }

    function hasPlayerEntered(uint256 roundId, address player) external view returns (bool) {
        return rounds[roundId].hasEntered[player];
    }

    function getPlayerChoice(uint256 roundId, address player) external view returns (uint8) {
        return rounds[roundId].playerChoices[player];
    }

    function getCurrentRound() external view returns (
        uint256 id,
        uint256 startTime,
        uint256 prizePool,
        uint8 chainMove,
        uint256 playerEntries,
        bool isComplete
    ) {
        GameRound storage round = rounds[currentRoundId];
        return (
            currentRoundId,
            round.startTime,
            round.prizePool,
            round.chainMove,
            round.playerEntries,
            round.isComplete
        );
    }

    // Emergency functions
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = USDC.balanceOf(address(this));
        USDC.transfer(owner(), balance);
    }
}