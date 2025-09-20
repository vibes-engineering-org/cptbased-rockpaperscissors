"use client";

import { useState, useEffect } from "react";
import { useRockPaperScissors, type GameChoice } from "~/hooks/use-rock-paper-scissors";
import { useMiniAppSdk } from "~/hooks/use-miniapp-sdk";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { Separator } from "~/components/ui/separator";
import { Trophy, Clock, Users, DollarSign, Share2, Shield, Zap, Bell } from "lucide-react";
import { formatEther } from "viem";

// Client-only component for time-sensitive displays
function ClientOnlyTimeDisplay({ children }: { children: React.ReactNode }) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return <div className="animate-pulse">Loading...</div>;
  }

  return <>{children}</>;
}

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
  const [showWinnerNotification, setShowWinnerNotification] = useState(false);

  // Check for unclaimed winnings when user returns
  useEffect(() => {
    const checkUnclaimedWinnings = () => {
      const lastVisit = localStorage.getItem('lastVisit');
      const lastRoundCheck = localStorage.getItem('lastRoundCheck');
      const currentTime = Date.now();

      // If user hasn't visited in more than 6 hours and there's a completed round
      if (lastVisit && (currentTime - parseInt(lastVisit)) > 6 * 60 * 60 * 1000) {
        // Mock check for unclaimed winnings - in production this would check the blockchain
        const hasUnclaimedWinnings = Math.random() > 0.7; // 30% chance of unclaimed winnings
        if (hasUnclaimedWinnings && currentRound?.id !== parseInt(lastRoundCheck || '0')) {
          setShowWinnerNotification(true);
        }
      }

      localStorage.setItem('lastVisit', currentTime.toString());
      if (currentRound) {
        localStorage.setItem('lastRoundCheck', currentRound.id.toString());
      }
    };

    checkUnclaimedWinnings();
  }, [currentRound]);

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
            <div className="text-center space-y-3">
              <Badge variant="default" className="bg-gradient-to-r from-lime-400 via-green-500 to-emerald-600 text-white shadow-lg animate-pulse px-6 py-2 text-lg">
                🎮 Entry Window Open
              </Badge>
              <div className="bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 border-2 border-orange-400 rounded-xl p-4 shadow-lg">
                <ClientOnlyTimeDisplay>
                  <div className="flex items-center justify-center gap-3 text-orange-800 font-bold mb-3">
                    <Clock className="w-6 h-6 text-red-600 animate-pulse" />
                    <span className="text-2xl tracking-wide">Closing in: {formatTimeRemaining(timeRemaining)}</span>
                  </div>
                </ClientOnlyTimeDisplay>
                <ClientOnlyTimeDisplay>
                  <Progress
                    value={(timeRemaining / (15 * 60 * 1000)) * 100}
                    className="h-3 mb-2"
                    style={{
                      background: 'linear-gradient(to right, #f97316, #dc2626)'
                    }}
                  />
                </ClientOnlyTimeDisplay>
                <p className="text-sm text-orange-600 font-semibold text-center">
                  Hurry! Entry window closes soon!
                </p>
              </div>
            </div>

            {!playerChoice ? (
              <div className="space-y-4">
                <p className="text-center text-sm text-muted-foreground">
                  Choose your move to enter this round
                </p>
                <div className="grid grid-cols-3 gap-4">
                  {([0, 1, 2] as GameChoice[]).map((choice) => (
                    <Button
                      key={choice}
                      variant={selectedChoice === choice ? "default" : "outline"}
                      size="lg"
                      className={`h-28 flex flex-col gap-3 text-lg transition-all duration-300 hover:scale-110 transform ${
                        selectedChoice === choice
                          ? "bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 text-white shadow-2xl border-0 animate-pulse"
                          : "hover:bg-gradient-to-br hover:from-cyan-50 hover:via-blue-50 hover:to-purple-50 border-3 border-cyan-300 hover:border-cyan-500 hover:shadow-xl bg-gradient-to-br from-white to-blue-50"
                      }`}
                      onClick={() => handleChoiceSelect(choice)}
                      disabled={isSubmitting || isConfirming}
                    >
                      <span className="text-4xl drop-shadow-lg">{getChoiceEmoji(choice)}</span>
                      <span className="text-sm font-bold tracking-wide">{getChoiceName(choice)}</span>
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
            <Badge variant="secondary" className="bg-gradient-to-r from-violet-500 via-purple-500 to-pink-500 text-white px-6 py-2 shadow-lg text-lg animate-pulse">
              ⏳ Next Round Coming
            </Badge>
            <div className="bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 border-2 border-purple-400 rounded-xl p-5 shadow-lg">
              <ClientOnlyTimeDisplay>
                <div className="flex items-center justify-center gap-3 text-purple-800 font-bold mb-3">
                  <Clock className="w-7 h-7 text-indigo-700 animate-spin" style={{ animationDuration: '3s' }} />
                  <span className="text-2xl tracking-wide">Entry opens in: {formatTimeRemaining(timeRemaining)}</span>
                </div>
              </ClientOnlyTimeDisplay>
              <ClientOnlyTimeDisplay>
                <Progress
                  value={100 - ((timeRemaining / (6 * 60 * 60 * 1000)) * 100)}
                  className="h-4 mb-3"
                  style={{
                    background: 'linear-gradient(to right, #8b5cf6, #ec4899)'
                  }}
                />
              </ClientOnlyTimeDisplay>
              <p className="text-sm text-purple-700 font-semibold">
                Get ready for the next round! Set your alarms!
              </p>
            </div>
          </div>
        );

      case "complete":
        return (
          <div className="text-center space-y-4">
            <Badge variant="outline" className="bg-gradient-to-r from-purple-500 to-blue-600 text-white border-0">
              🏁 Round Complete
            </Badge>
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
                    <div className="text-green-600 font-medium flex items-center justify-center gap-2 animate-bounce">
                      <Trophy className="w-4 h-4" />
                      🎉 You Won!
                    </div>
                    <Button
                      onClick={() => claimWinnings(currentRound.id)}
                      className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg"
                    >
                      💰 Claim Winnings
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
    <div className="w-[400px] mx-auto py-8 px-4 min-h-screen space-y-6 bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
      {/* Winner Notification */}
      {showWinnerNotification && (
        <Card className="bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 border-0 shadow-2xl">
          <CardContent className="pt-6">
            <div className="text-center text-white space-y-3">
              <div className="flex items-center justify-center gap-2">
                <Bell className="w-6 h-6 animate-bounce" />
                <span className="text-xl font-bold">You Have Unclaimed Winnings!</span>
              </div>
              <p className="text-sm opacity-90">
                Looks like you won a previous round while away. Check the completed rounds below to claim your prize!
              </p>
              <Button
                onClick={() => setShowWinnerNotification(false)}
                className="bg-white text-orange-600 hover:bg-orange-50 font-semibold px-6"
              >
                Got it!
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <div className="text-center space-y-4 bg-gradient-to-br from-cyan-50 via-blue-50 to-purple-50 rounded-2xl p-6 border-2 border-cyan-200 shadow-xl">
        <h1 className="text-5xl font-extrabold bg-gradient-to-r from-cyan-400 via-blue-500 via-purple-500 to-pink-500 bg-clip-text text-transparent animate-pulse drop-shadow-lg">
          🪨📄✂️ Rock Paper Scissors
        </h1>
        <p className="text-lg text-slate-700 font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Rounds every 6 hours • 15-minute entry window
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-blue-600 font-semibold">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <span>Play smart, win big!</span>
        </div>
      </div>

      {/* Current Round Info */}
      <Card className="border-2 border-blue-200 shadow-xl bg-gradient-to-br from-white via-blue-50 to-purple-50">
        <CardHeader className="pb-3 bg-gradient-to-r from-blue-100 to-purple-100 rounded-t-lg border-b-2 border-blue-200">
          <CardTitle className="text-xl font-bold flex items-center justify-between">
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Round #{currentRound.id}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="h-9 w-9 p-0 bg-gradient-to-r from-cyan-400 to-blue-500 text-white hover:from-cyan-500 hover:to-blue-600 rounded-full shadow-lg"
            >
              <Share2 className="w-4 h-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          {/* Prize Pool & Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 rounded-xl bg-gradient-to-br from-emerald-100 via-green-100 to-lime-100 border-2 border-emerald-300 shadow-lg">
              <div className="flex items-center justify-center gap-2 text-xl font-bold text-emerald-700 mb-1">
                <DollarSign className="w-5 h-5 text-green-600" />
                {formatEther(currentRound.prizePool)}
              </div>
              <p className="text-sm font-semibold text-emerald-600">💰 Prize Pool (USDC)</p>
            </div>
            <div className="text-center p-4 rounded-xl bg-gradient-to-br from-cyan-100 via-blue-100 to-indigo-100 border-2 border-cyan-300 shadow-lg">
              <div className="flex items-center justify-center gap-2 text-xl font-bold text-cyan-700 mb-1">
                <Users className="w-5 h-5 text-blue-600" />
                {currentRound.playerEntries}
              </div>
              <p className="text-sm font-semibold text-cyan-600">👥 Players Entered</p>
            </div>
          </div>

          <Separator />

          {/* Game State */}
          {getGameStateDisplay()}
        </CardContent>
      </Card>

      {/* Player Stats */}
      {context?.user && (
        <Card className="border-2 border-emerald-200 shadow-xl bg-gradient-to-br from-white via-emerald-50 to-green-50">
          <CardHeader className="pb-3 bg-gradient-to-r from-emerald-100 to-green-100 rounded-t-lg border-b-2 border-emerald-200">
            <CardTitle className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">Your Stats</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="p-4 rounded-xl bg-gradient-to-br from-slate-100 via-gray-100 to-zinc-100 border-2 border-slate-300 shadow-lg">
                <p className="text-slate-600 font-medium flex items-center gap-1 mb-1">
                  🎮 Games Played
                </p>
                <p className="font-bold text-slate-800 text-lg">{playerStats.totalGames}</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-blue-100 via-indigo-100 to-purple-100 border-2 border-blue-300 shadow-lg">
                <p className="text-blue-600 font-medium flex items-center gap-1 mb-1">
                  📊 Win Rate
                </p>
                <p className="font-bold text-blue-700 text-lg">
                  {playerStats.totalGames > 0
                    ? Math.round((playerStats.wins / playerStats.totalGames) * 100)
                    : 0}%
                </p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-100 via-green-100 to-lime-100 border-2 border-emerald-300 shadow-lg">
                <p className="text-emerald-600 font-medium flex items-center gap-1 mb-1">
                  💰 Total Winnings
                </p>
                <p className="font-bold text-emerald-700 text-lg">
                  {formatEther(playerStats.totalWinnings)} USDC
                </p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-orange-100 via-yellow-100 to-amber-100 border-2 border-orange-300 shadow-lg">
                <p className="text-orange-600 font-medium flex items-center gap-1 mb-1">
                  🔥 Win Streak
                </p>
                <p className="font-bold text-orange-700 text-lg">{playerStats.currentStreak}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leaderboard */}
      <Card className="border-2 border-yellow-200 shadow-xl bg-gradient-to-br from-white via-yellow-50 to-orange-50">
        <CardHeader className="pb-3 bg-gradient-to-r from-yellow-100 to-orange-100 rounded-t-lg border-b-2 border-yellow-200">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-600" />
            <span className="bg-gradient-to-r from-yellow-600 to-orange-600 bg-clip-text text-transparent">Leaderboard</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
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
      <Card className="border-2 border-indigo-200 shadow-xl bg-gradient-to-br from-white via-indigo-50 to-purple-50">
        <CardHeader className="pb-3 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-t-lg border-b-2 border-indigo-200">
          <CardTitle className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">How It Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-3 p-6">
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-blue-500 mt-0.5" />
            <span>Rounds start every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)</span>
          </div>
          <div className="flex items-start gap-2">
            <DollarSign className="w-4 h-4 text-green-500 mt-0.5" />
            <span>15-minute entry window, 1 USDC per entry</span>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-purple-500 mt-0.5" />
            <span>Small platform fee supports ongoing development and features</span>
          </div>
          <div className="flex items-start gap-2">
            <Zap className="w-4 h-4 text-yellow-500 mt-0.5" />
            <span>Blockchain determines random move after entries close</span>
          </div>
          <div className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-purple-500 mt-0.5" />
            <span>Winners split the pot equally</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-lg mt-0.5">🪨📄✂️</span>
            <span>Rock beats Scissors, Paper beats Rock, Scissors beats Paper</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}