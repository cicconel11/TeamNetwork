"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui";
import { findBatchAssignmentIssues } from "@/lib/enterprise/batch-org-assignments";
import {
  fetchAllEnterpriseMembers,
  shouldRedirectAfterBatchCreate,
  type BatchOrgSubmissionResult as WizardSubmissionResult,
  type EnterpriseMemberRecord,
} from "@/lib/enterprise/batch-org-wizard";
import { BatchOrgDefineStep } from "./BatchOrgDefineStep";
import { BatchOrgAssignStep } from "./BatchOrgAssignStep";
import { BatchOrgReviewStep } from "./BatchOrgReviewStep";

const orgSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  slug: z.string().min(2, "Slug must be at least 2 characters").max(60).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
  description: z.string().max(800).default(""),
  purpose: z.string().max(500).default(""),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6B21A8"),
});

const batchFormSchema = z.object({
  organizations: z.array(orgSchema).min(1, "Add at least one organization").max(20),
});

export type BatchFormData = z.infer<typeof batchFormSchema>;
export type OrgFormData = z.infer<typeof orgSchema>;

export interface MemberAssignment {
  orgIndex: number;
  existingMembers: Array<{
    userId: string;
    sourceOrgId: string;
    action: "move" | "copy";
  }>;
  emailInvites: Array<{
    email: string;
    role: "admin" | "active_member" | "alumni";
  }>;
}

export type EnterpriseMember = EnterpriseMemberRecord;
export type BatchOrgSubmissionResult = WizardSubmissionResult;

interface QuotaInfo {
  currentCount: number;
  maxAllowed: number | null;
  remaining: number | null;
}

interface BatchOrgWizardProps {
  enterpriseId: string;
  enterpriseSlug: string;
  initialQuota: QuotaInfo;
}

const STEP_FIELDS: Record<number, string[]> = {
  1: ["organizations"],
  2: [], // No form validation for member assignment step
  3: [], // Review step — no validation
};

export function BatchOrgWizard({
  enterpriseId,
  enterpriseSlug,
  initialQuota,
}: BatchOrgWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quota, setQuota] = useState<QuotaInfo>(initialQuota);
  const [memberAssignments, setMemberAssignments] = useState<MemberAssignment[]>([]);
  const [members, setMembers] = useState<EnterpriseMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<BatchOrgSubmissionResult | null>(null);

  const methods = useForm<BatchFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(batchFormSchema) as any,
    defaultValues: {
      organizations: [
        { name: "", slug: "", description: "", purpose: "", primaryColor: "#6B21A8" },
      ],
    },
  });

  // Fetch live quota on mount
  useEffect(() => {
    fetch(`/api/enterprise/${enterpriseId}/organizations/quota`)
      .then((res) => res.json())
      .then((data) => {
        if (data.currentCount != null) {
          setQuota({
            currentCount: data.currentCount,
            maxAllowed: data.maxAllowed,
            remaining: data.remaining,
          });
        }
      })
      .catch(() => {});
  }, [enterpriseId]);

  // Fetch members when entering step 2
  const loadMembers = useCallback(async () => {
    if (membersLoaded) return;
    try {
      const allMembers = await fetchAllEnterpriseMembers(async (after) => {
        const params = new URLSearchParams({ limit: "100" });
        if (after) {
          params.set("after", after);
        }

        const res = await fetch(`/api/enterprise/${enterpriseId}/members?${params.toString()}`);
        if (!res.ok) {
          throw new Error("Failed to load enterprise members");
        }

        const data = await res.json();
        return {
          members: Array.isArray(data.members) ? data.members : [],
          nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
        };
      });

      setMembers(allMembers);
      setMembersLoaded(true);
    } catch {
      // Members load is best-effort
    }
  }, [enterpriseId, membersLoaded]);

  const getAssignmentIssue = useCallback(() => {
    const issues = findBatchAssignmentIssues(
      methods.getValues("organizations").length,
      memberAssignments
    );
    return issues[0] ?? null;
  }, [memberAssignments, methods]);

  const handleNext = async () => {
    setError(null);
    const fields = STEP_FIELDS[step];
    if (fields && fields.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isValid = await methods.trigger(fields as any);
      if (!isValid) return;
    }

    // Check quota before advancing from step 1
    if (step === 1) {
      const orgCount = methods.getValues("organizations").length;
      if (quota.maxAllowed != null && quota.currentCount + orgCount > quota.maxAllowed) {
        setError("Cannot proceed — would exceed organization limit. Remove organizations or upgrade your plan.");
        return;
      }
    }

    if (step === 1) {
      loadMembers();
      setStep(2);
    } else if (step === 2) {
      const assignmentIssue = getAssignmentIssue();
      if (assignmentIssue) {
        setError(assignmentIssue);
        return;
      }
      setStep(3);
    }
  };

  const handleBack = () => {
    setError(null);
    if (step === 3) {
      setSubmissionResult(null);
    }
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  const handleSkipToReview = () => {
    setError(null);
    const assignmentIssue = getAssignmentIssue();
    if (assignmentIssue) {
      setError(assignmentIssue);
      return;
    }
    setStep(3);
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmissionResult(null);
    const assignmentIssue = getAssignmentIssue();
    if (assignmentIssue) {
      setError(assignmentIssue);
      return;
    }
    setIsSubmitting(true);

    try {
      const orgs = methods.getValues("organizations");
      const payload = {
        organizations: orgs.map((org) => ({
          name: org.name,
          slug: org.slug,
          description: org.description || undefined,
          purpose: org.purpose || undefined,
          primary_color: org.primaryColor,
        })),
        memberAssignments: memberAssignments.length > 0
          ? memberAssignments.map((a) => ({
              orgIndex: a.orgIndex,
              existingMembers: a.existingMembers.length > 0 ? a.existingMembers : undefined,
              emailInvites: a.emailInvites.length > 0 ? a.emailInvites : undefined,
            }))
          : undefined,
      };

      const res = await fetch(`/api/enterprise/${enterpriseId}/organizations/batch-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create organizations");
        return;
      }

      const result: BatchOrgSubmissionResult = {
        organizations: Array.isArray(data.organizations) ? data.organizations : [],
        memberResults: Array.isArray(data.memberResults) ? data.memberResults : [],
        inviteResults: Array.isArray(data.inviteResults) ? data.inviteResults : [],
        summary: data.summary,
      };

      if (shouldRedirectAfterBatchCreate(result.summary)) {
        router.push(`/enterprise/${enterpriseSlug}/organizations?created=${result.summary?.orgsCreated ?? 0}`);
        return;
      }

      setSubmissionResult(result);
      setError("Organizations were created, but some assignments or invites failed. Review the results below.");
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const organizations = methods.watch("organizations");
  const assignmentIssue = getAssignmentIssue();

  return (
    <FormProvider {...methods}>
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-medium ${
                  s === step
                    ? "bg-blue-600 text-white"
                    : s < step
                    ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300"
                    : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                }`}
              >
                {s < step ? "✓" : s}
              </div>
              <span className={`text-sm hidden sm:inline ${s === step ? "font-medium text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
                {s === 1 ? "Define" : s === 2 ? "Assign Members" : "Review"}
              </span>
              {s < 3 && <div className="w-8 h-px bg-gray-300 dark:bg-gray-600" />}
            </div>
          ))}
        </div>

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Step content */}
        <div style={{ display: step === 1 ? "block" : "none" }}>
          <BatchOrgDefineStep
            quota={quota}
            enterpriseSlug={enterpriseSlug}
          />
        </div>
        <div style={{ display: step === 2 ? "block" : "none" }}>
          <BatchOrgAssignStep
            organizations={organizations}
            members={members}
            memberAssignments={memberAssignments}
            onAssignmentsChange={setMemberAssignments}
          />
        </div>
        <div style={{ display: step === 3 ? "block" : "none" }}>
          <BatchOrgReviewStep
            organizations={organizations}
            memberAssignments={memberAssignments}
            members={members}
            quota={quota}
            isSubmitting={isSubmitting}
            submitDisabledReason={assignmentIssue}
            submissionResult={submissionResult}
            onSubmit={handleSubmit}
          />
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
          <div>
            {step > 1 && (
              <Button variant="secondary" onClick={handleBack} disabled={isSubmitting}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step === 2 && (
              <Button variant="secondary" onClick={handleSkipToReview}>
                Skip to Review
              </Button>
            )}
            {step < 3 && (
              <Button onClick={handleNext}>
                Next
              </Button>
            )}
            {step === 3 && (
              <Button onClick={handleSubmit} disabled={isSubmitting || Boolean(assignmentIssue)}>
                {isSubmitting ? "Creating..." : "Create All Organizations"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </FormProvider>
  );
}
