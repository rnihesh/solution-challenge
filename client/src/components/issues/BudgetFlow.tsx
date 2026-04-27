"use client";

import { BadgeIndianRupee, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IssueBudgetView {
  currency?: string | null;
  aiEstimatedAmount?: number | null;
  aiEstimatedAt?: string | Date | null;
  aiEstimateSource?: string | null;
  aiEstimateConfidence?: number | null;
  aiSeverityScore?: number | null;
  aiReasoning?: string | null;
  approvedAmount?: number | null;
  approvedAt?: string | Date | null;
  approvalNote?: string | null;
}

function formatAmount(amount?: number | null, currency = "INR") {
  if (amount === null || amount === undefined) {
    return null;
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function BudgetFlow({
  budget,
  className,
  compact = false,
  estimationOnly = false,
}: {
  budget?: IssueBudgetView | null;
  className?: string;
  compact?: boolean;
  estimationOnly?: boolean;
}) {
  if (!budget) {
    return null;
  }

  const currency = budget.currency || "INR";
  const aiAmount = formatAmount(budget.aiEstimatedAmount, currency);
  const approvedAmount = formatAmount(budget.approvedAmount, currency);
  const hasApprovedAmount =
    budget.approvedAmount !== null && budget.approvedAmount !== undefined;
  const currentAmount = hasApprovedAmount ? approvedAmount : aiAmount;

  if (!currentAmount) {
    return null;
  }

  if (estimationOnly) {
    return (
      <div
        className={cn(
          "rounded-lg border border-emerald-200 bg-emerald-50/70 p-3",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <BadgeIndianRupee className="h-4 w-4 text-emerald-700" />
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
            Estimated Cost
          </p>
        </div>
        <p
          className={cn(
            "mt-1 font-semibold text-emerald-950",
            compact ? "text-sm" : "text-base"
          )}
        >
          {aiAmount || currentAmount}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-emerald-200 bg-emerald-50/70 p-3",
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BadgeIndianRupee className="h-4 w-4 text-emerald-700" />
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
            Budget Flow
          </p>
        </div>
        {hasApprovedAmount ? (
          <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Admin Approved</span>
          </div>
        ) : (
          <span className="text-[11px] font-medium text-amber-700">
            Pending Approval
          </span>
        )}
      </div>

      <p className={cn("font-semibold text-emerald-950", compact ? "text-sm" : "text-base")}>
        Current Budget: {currentAmount}
      </p>

      <div className={cn("mt-3 grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
        <div className="rounded-md bg-white/70 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            AI Estimate
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {aiAmount || "Not available"}
          </p>
          {budget.aiSeverityScore ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Photo severity: {budget.aiSeverityScore}/10
            </p>
          ) : null}
        </div>

        <div className="rounded-md bg-white/70 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Admin Approved
          </p>
            <p className="mt-1 text-sm font-medium text-foreground">
            {hasApprovedAmount ? approvedAmount : "Awaiting review"}
          </p>
          {budget.approvalNote ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {budget.approvalNote}
            </p>
          ) : null}
        </div>
      </div>

      {budget.aiReasoning ? (
        <p className="mt-2 text-xs text-emerald-900/80">{budget.aiReasoning}</p>
      ) : null}
    </div>
  );
}
