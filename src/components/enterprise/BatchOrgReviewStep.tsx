"use client";

import { Button } from "@/components/ui";
import { shouldRedirectAfterBatchCreate } from "@/lib/enterprise/batch-org-wizard";
import type {
  OrgFormData,
  MemberAssignment,
  EnterpriseMember,
  BatchOrgSubmissionResult,
} from "./BatchOrgWizard";

interface BatchOrgReviewStepProps {
  organizations: OrgFormData[];
  memberAssignments: MemberAssignment[];
  members: EnterpriseMember[];
  quota: {
    currentCount: number;
    maxAllowed: number | null;
  };
  isSubmitting: boolean;
  submitDisabledReason?: string | null;
  submissionResult?: BatchOrgSubmissionResult | null;
  onSubmit: () => void;
}

export function BatchOrgReviewStep({
  organizations,
  memberAssignments,
  members,
  quota,
  isSubmitting,
  submitDisabledReason,
  submissionResult,
  onSubmit,
}: BatchOrgReviewStepProps) {
  const memberLookup = new Map(members.map((m) => [m.userId, m]));

  const getAssignment = (orgIndex: number) =>
    memberAssignments.find((a) => a.orgIndex === orgIndex);

  const totalMembers = memberAssignments.reduce(
    (sum, a) => sum + (a.existingMembers?.length ?? 0),
    0
  );
  const totalInvites = memberAssignments.reduce(
    (sum, a) => sum + (a.emailInvites?.length ?? 0),
    0
  );
  const totalMoves = memberAssignments.reduce(
    (sum, a) => sum + (a.existingMembers?.filter((m) => m.action === "move").length ?? 0),
    0
  );

  const afterCount = quota.currentCount + organizations.length;
  const shouldShowSubmissionResult = Boolean(
    submissionResult && !shouldRedirectAfterBatchCreate(submissionResult.summary)
  );
  const failedOrganizations = submissionResult?.organizations.filter(
    (organization) => organization.out_status !== "created"
  ) ?? [];
  const failedMembers = submissionResult?.memberResults.filter((result) => !result.ok) ?? [];
  const failedInvites = submissionResult?.inviteResults.filter(
    (result) => result.status === "failed"
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-1">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Organizations</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{organizations.length}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Members assigned</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{totalMembers}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Email invites</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{totalInvites}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">After creation</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              {afterCount}{quota.maxAllowed != null ? ` / ${quota.maxAllowed}` : ""} orgs
            </p>
          </div>
        </div>
        {totalMoves > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
            {totalMoves} member(s) will be moved (removed from their current organization)
          </p>
        )}
      </div>

      {shouldShowSubmissionResult && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-amber-900 dark:text-amber-100">
              Batch Results
            </h3>
            <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
              {submissionResult?.summary?.orgsCreated ?? 0} organization(s) created,
              {" "}{submissionResult?.summary?.orgsFailed ?? 0} failed,
              {" "}{submissionResult?.summary?.membersFailed ?? 0} member assignment(s) failed,
              {" "}{submissionResult?.summary?.invitesFailed ?? 0} invite(s) failed.
            </p>
          </div>

          {failedOrganizations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                Failed organizations
              </p>
              <div className="space-y-1">
                {failedOrganizations.slice(0, 10).map((organization) => (
                  <p
                    key={`${organization.out_slug}:${organization.out_status}`}
                    className="text-xs text-amber-800 dark:text-amber-200"
                  >
                    /{organization.out_slug}: {organization.out_status}
                  </p>
                ))}
              </div>
            </div>
          )}

          {failedMembers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                Failed member assignments
              </p>
              <div className="space-y-1">
                {failedMembers.slice(0, 10).map((result) => (
                  <p
                    key={`${result.orgSlug}:${result.userId}:${result.action}`}
                    className="text-xs text-amber-800 dark:text-amber-200"
                  >
                    /{result.orgSlug}: {result.userId} ({result.action}){result.error ? ` — ${result.error}` : ""}
                  </p>
                ))}
              </div>
            </div>
          )}

          {failedInvites.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                Failed invites
              </p>
              <div className="space-y-1">
                {failedInvites.slice(0, 10).map((result) => (
                  <p
                    key={`${result.orgSlug}:${result.email}:${result.role}`}
                    className="text-xs text-amber-800 dark:text-amber-200"
                  >
                    /{result.orgSlug}: {result.email} ({result.role}){result.error ? ` — ${result.error}` : ""}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {organizations.map((org, index) => {
          const assignment = getAssignment(index);
          const assignedCount = assignment?.existingMembers?.length ?? 0;
          const inviteCount = assignment?.emailInvites?.length ?? 0;

          return (
            <div
              key={index}
              className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2"
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-4 w-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: org.primaryColor }}
                />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                    {org.name}
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    /{org.slug}
                    {org.purpose && ` · ${org.purpose}`}
                  </p>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 text-right">
                  {assignedCount > 0 && <span>{assignedCount} members</span>}
                  {assignedCount > 0 && inviteCount > 0 && <span> + </span>}
                  {inviteCount > 0 && <span>{inviteCount} invites</span>}
                  {assignedCount === 0 && inviteCount === 0 && <span>No members</span>}
                </div>
              </div>

              {/* Show assigned member names */}
              {assignment?.existingMembers && assignment.existingMembers.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {assignment.existingMembers.slice(0, 5).map((m) => {
                    const member = memberLookup.get(m.userId);
                    return (
                      <span
                        key={m.userId}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                          m.action === "move"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        }`}
                      >
                        {member?.fullName || member?.email || m.userId.slice(0, 8)}
                        <span className="ml-1 opacity-60">{m.action}</span>
                      </span>
                    );
                  })}
                  {assignment.existingMembers.length > 5 && (
                    <span className="text-xs text-gray-400">
                      +{assignment.existingMembers.length - 5} more
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-center pt-2">
        <Button
          onClick={onSubmit}
          disabled={isSubmitting || Boolean(submitDisabledReason)}
          className="px-8"
        >
          {isSubmitting ? "Creating Organizations..." : `Create ${organizations.length} Organization${organizations.length > 1 ? "s" : ""}`}
        </Button>
      </div>
      {submitDisabledReason && (
        <p className="text-center text-xs text-red-600 dark:text-red-400">
          {submitDisabledReason}
        </p>
      )}
    </div>
  );
}
