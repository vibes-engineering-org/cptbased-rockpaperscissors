"use client";

import { useState } from "react";
import { useRockPaperScissors, type GameChoice } from "~/hooks/use-rock-paper-scissors";
import { useMiniAppSdk } from "~/hooks/use-miniapp-sdk";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { Separator } from "~/components/ui/separator";
import { Trophy, Clock, Users, DollarSign, Share2 } from "lucide-react";
import { formatEther } from "viem";

export default function RockPaperScissorsGame() {
  const {
    currentRound,
    gameState,
    timeRemaining,
    playerChoice,
    enterGame,
    claimWinnings,
    isSubmitting,
    isConfirming,
    playerStats,
    leaderboard,
    getChoiceName,
    getChoiceEmoji,
    formatTimeRemaining,
    ENTRY_COST
  } = useRockPaperScissors();

  const { sdk, context, isSDKLoaded } = useMiniAppSdk();
  const [selectedChoice, setSelectedChoice] = useState<GameChoice | null>(null);

  const handleChoiceSelect = async (choice: GameChoice) => {
    setSelectedChoice(choice);
    await enterGame(choice);
  };

  const handleShare = async () => {
    if (!isSDKLoaded || !sdk || !currentRound) return;

    const text = `Just played Rock Paper Scissors! 🪨📄✂️ Prize pool: $${formatEther(currentRound.prizePool)} USDC. Join the next round!`;

    try {
      // Use openUrl to share for now - in production this would be the correct share method
      await sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(window.location.href)}`);
    } catch (error) {
      console.error("Failed to share:", error);
    }
  };

  const getGameStateDisplay = () => {
    switch (gameState) {
      case "entry":
        return (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <Badge variant="default" className="bg-green-500 text-white">
                Entry Open
              </Badge>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>Time remaining: {formatTimeRemaining(timeRemaining)}</span>
              </div>
            </div>

            {!playerChoice ? (
              <div className="space-y-4">
                <p className="text-center text-sm text-muted-foreground">
                  Choose your move to enter this round
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {([0, 1, 2] as GameChoice[]).map((choice) => (
                    <Button
                      key={choice}
                      variant={selectedChoice === choice ? "default" : "outline"}
                      size="lg"
                      className="h-20 flex flex-col gap-2 text-lg"
                      onClick={() => handleChoiceSelect(choice)}
                      disabled={isSubmitting || isConfirming}
                    >
                      <span className="text-2xl">{getChoiceEmoji(choice)}</span>
                      <span className="text-sm">{getChoiceName(choice)}</span>
                    </Button>
                  ))}
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Entry fee: {formatEther(ENTRY_COST)} USDC
                </p>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <div className="text-4xl">{getChoiceEmoji(playerChoice)}</div>
                <p className="font-medium">You chose {getChoiceName(playerChoice)}</p>
                <p className="text-sm text-muted-foreground">
                  Waiting for round to end...
                </p>
              </div>
            )}
          </div>
        );

      case "waiting":
        return (
          <div className="text-center space-y-4">
            <Badge variant="secondary">Next Round</Badge>
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>Starts in: {formatTimeRemaining(timeRemaining)}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Get ready for the next round!
              </p>
            </div>
          </div>
        );

      case "complete":
        return (
          <div className="text-center space-y-4">
            <Badge variant="outline">Round Complete</Badge>
            {currentRound?.chainMove !== undefined && currentRound?.winningChoice !== undefined && (
              <div className="space-y-3">
                <div className="flex justify-center items-center gap-8">
                  <div className="text-center">
                    <div className="text-3xl mb-1">{getChoiceEmoji(currentRound.chainMove)}</div>
                    <p className="text-sm text-muted-foreground">Chain Move</p>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl mb-1">{getChoiceEmoji(currentRound.winningChoice)}</div>
                    <p className="text-sm text-muted-foreground">Winning Move</p>
                  </div>
                </div>

                {playerChoice === currentRound.winningChoice ? (
                  <div className="space-y-3">
                    <div className="text-green-600 font-medium flex items-center justify-center gap-2">
                      <Trophy className="w-4 h-4" />
                      You Won!
                    </div>
                    <Button onClick={() => claimWinnings(currentRound.id)} className="w-full">
                      Claim Winnings
                    </Button>
                  </div>
                ) : playerChoice !== null ? (
                  <div className="text-red-600 font-medium">
                    You lost this round
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    You did not participate in this round
                  </p>
                )}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  if (!currentRound) {
    return (
      <div className="w-[400px] mx-auto py-8 px-4 min-h-screen flex flex-col items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Loading game...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[400px] mx-auto py-8 px-4 min-h-screen space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Rock Paper Scissors</h1>
        <p className="text-sm text-muted-foreground">
          Rounds every 6 hours • 15-minute entry window
        </p>
      </div>

      {/* Current Round Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Round #{currentRound.id}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="h-8 w-8 p-0"
            >
              <Share2 className="w-4 h-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Prize Pool & Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-lg font-semibold text-green-600">
                <DollarSign className="w-4 h-4" />
                {formatEther(currentRound.prizePool)}
              </div>
              <p className="text-xs text-muted-foreground">Prize Pool (USDC)</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-lg font-semibold">
                <Users className="w-4 h-4" />
                {currentRound.playerEntries}
              </div>
              <p className="text-xs text-muted-foreground">Players Entered</p>
            </div>
          </div>

          <Separator />

          {/* Game State */}
          {getGameStateDisplay()}
        </CardContent>
      </Card>

      {/* Player Stats */}
      {context?.user && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Your Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Games Played</p>
                <p className="font-semibold">{playerStats.totalGames}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Win Rate</p>
                <p className="font-semibold">
                  {playerStats.totalGames > 0
                    ? Math.round((playerStats.wins / playerStats.totalGames) * 100)
                    : 0}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Winnings</p>
                <p className="font-semibold text-green-600">
                  {formatEther(playerStats.totalWinnings)} USDC
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Win Streak</p>
                <p className="font-semibold">{playerStats.currentStreak}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {leaderboard.slice(0, 5).map((player, index) => (
              <div key={player.address} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {index + 1}
                  </span>
                  <span className="font-mono text-sm">{player.address}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{player.wins} wins</p>
                  <p className="text-xs text-muted-foreground">{player.totalWinnings} USDC</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Game Rules */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">How It Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>• Rounds start every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)</p>
          <p>• 15-minute entry window, 1 USDC per entry</p>
          <p>• 9% rake, 91% goes to prize pool</p>
          <p>• Chain determines random move after entries close</p>
          <p>• Winners split the pot equally</p>
          <p>• Rock beats Scissors, Paper beats Rock, Scissors beats Paper</p>
        </CardContent>
      </Card>
    </div>
  );
}