"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { VerificationResponse } from "@/hooks";

type DomainVerificationAlertProps = {
  verification: VerificationResponse;
  isAdmin: boolean;
};

export function DomainVerificationAlert({ verification, isAdmin }: DomainVerificationAlertProps) {
  const [requestNotice, setRequestNotice] = useState<string | null>(null);

  const getTitle = () => {
    switch (verification.allowStatus) {
      case "pending":
        return "Needs admin approval";
      case "blocked":
        return "Domain blocked";
      default:
        return "Domain not verified";
    }
  };

  const getDescription = () => {
    switch (verification.allowStatus) {
      case "pending":
        return "An admin must approve this domain before importing.";
      case "blocked":
        return "This domain is blocked for schedule imports. Try an iCal/ICS link or manual entry.";
      default:
        return "This domain could not be verified. Try an iCal/ICS link or manual entry.";
    }
  };

  const scrollToApprovals = () => {
    document.getElementById("schedule-domain-approvals")?.scrollIntoView({ behavior: "smooth" });
  };

  const handleRequestApproval = () => {
    setRequestNotice("Request recorded. Ask an admin to approve this domain.");
  };

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-foreground">
      <p className="font-medium">{getTitle()}</p>
      <p className="text-xs text-muted-foreground mt-1">{getDescription()}</p>
      {verification.allowStatus === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {isAdmin ? (
            <Button variant="secondary" size="sm" onClick={scrollToApprovals}>
              Review approvals
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={handleRequestApproval}>
              Request approval
            </Button>
          )}
        </div>
      )}
      {requestNotice && <p className="mt-2 text-xs text-foreground">{requestNotice}</p>}
    </div>
  );
}
