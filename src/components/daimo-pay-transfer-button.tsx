"use client";

import { DaimoPayButton } from "@daimo/pay";
import { baseUSDC } from "@daimo/contract";
import { getAddress } from "viem";
import { Button } from "~/components/ui/button";
import { useState, useEffect, useRef } from "react";

export function DaimoPayTransferButton({
  text,
  toChainId,
  toAddress,
  tokenAddress,
  amount,
  onPaymentStarted,
  onPaymentCompleted,
  onPaymentCanceled,
}: {
  text: string;
  toAddress: `0x${string}`;
  amount: string;
  tokenAddress?: `0x${string}`;
  toChainId?: number;
  onPaymentStarted?: () => void;
  onPaymentCompleted?: () => void;
  onPaymentCanceled?: () => void;
}) {
  const [isPaymentStarted, setIsPaymentStarted] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePaymentStarted = () => {
    setIsPaymentStarted(true);
    onPaymentStarted?.();

    // Set a timeout to call onPaymentCanceled if payment doesn't complete in 2 minutes
    timeoutRef.current = setTimeout(() => {
      if (isPaymentStarted) {
        console.log("Payment timeout - assuming canceled");
        setIsPaymentStarted(false);
        onPaymentCanceled?.();
      }
    }, 120000); // 2 minutes timeout
  };

  const handlePaymentCompleted = (e: any) => {
    setIsPaymentStarted(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    console.log("Payment completed", e);
    onPaymentCompleted?.();
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="flex justify-center text-xl font-bold rounded-lg shadow-lg">
      <DaimoPayButton.Custom
        appId={process.env.NEXT_PUBLIC_DAIMO_PAY_KEY || "pay-demo"}
        toChain={toChainId || baseUSDC.chainId}
        toUnits={amount}
        toToken={tokenAddress || getAddress(baseUSDC.token)}
        toAddress={toAddress}
        onPaymentStarted={handlePaymentStarted}
        onPaymentCompleted={handlePaymentCompleted}
        closeOnSuccess
      >
        {({ show: showDaimoModal }) => (
          <Button className="w-full" size="lg" onClick={() => showDaimoModal()}>
            {text}
          </Button>
        )}
      </DaimoPayButton.Custom>
    </div>
  );
}
