/**
 * Enterprise TypeScript Type Definitions
 *
 * Hybrid pricing model: alumni buckets + team add-ons.
 * Alumni pricing is mandatory (min 1 bucket). Teams are an add-on (first 3 free).
 */

export type BillingInterval = "month" | "year";
export type EnterpriseRole = "owner" | "billing_admin" | "org_admin";
export type AdoptionRequestStatus = "pending" | "accepted" | "rejected" | "expired";
export type EnterpriseRelationshipType = "created" | "adopted";
export type SubOrgBillingType = "enterprise_managed" | "independent";

// Alumni bucket pricing constants (cents)
export const ALUMNI_BUCKET_PRICING = {
  capacityPerBucket: 2500, // Each bucket covers 2,500 alumni
  monthlyCentsPerBucket: 5000, // $50/month per bucket
  yearlyCentsPerBucket: 50000, // $500/year per bucket
  maxSelfServeBuckets: 4, // Buckets 1-4 are self-serve; 5+ is sales-led
} as const;

// Team add-on pricing constants (cents)
export const ENTERPRISE_SEAT_PRICING = {
  freeSubOrgs: 3, // First 3 organizations are included
  pricePerAdditionalCentsMonthly: 1500, // $15/month per additional org
  pricePerAdditionalCentsYearly: 15000, // $150/year per additional org
} as const;

// Core enterprise interface
export interface Enterprise {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  primary_color: string | null;
  billing_contact_email: string | null;
  created_at: string;
  updated_at: string;
}

// Enterprise subscription — hybrid model
export interface EnterpriseSubscription {
  id: string;
  enterprise_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: BillingInterval;
  alumni_bucket_quantity: number; // >= 1, each bucket = 2,500 alumni
  sub_org_quantity: number | null;
  status: string;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

// User enterprise role
export interface UserEnterpriseRole {
  id: string;
  user_id: string;
  enterprise_id: string;
  role: EnterpriseRole;
  created_at: string;
}

// Adoption request
export interface EnterpriseAdoptionRequest {
  id: string;
  enterprise_id: string;
  organization_id: string;
  requested_by: string;
  requested_at: string;
  status: AdoptionRequestStatus;
  responded_by: string | null;
  responded_at: string | null;
  expires_at: string | null;
}

// Enterprise with subscription (for dashboard)
export interface EnterpriseWithSubscription extends Enterprise {
  subscription: EnterpriseSubscription | null;
}

// Enterprise context (used in layouts)
export interface EnterpriseContext {
  enterprise: Enterprise;
  subscription: EnterpriseSubscription | null;
  role: EnterpriseRole;
  alumniCount: number;
  subOrgCount: number;
  enterpriseManagedOrgCount: number;
}

// Role permissions helper type
export interface EnterpriseRolePermissions {
  canViewDashboard: boolean;
  canCreateSubOrg: boolean;
  canAdoptOrg: boolean;
  canRemoveSubOrg: boolean;
  canManageBilling: boolean;
  canInviteAdmins: boolean;
}

// Helper function for getting permissions based on role
export function getEnterprisePermissions(role: EnterpriseRole): EnterpriseRolePermissions {
  switch (role) {
    case "owner":
      return {
        canViewDashboard: true,
        canCreateSubOrg: true,
        canAdoptOrg: true,
        canRemoveSubOrg: true,
        canManageBilling: true,
        canInviteAdmins: true,
      };
    case "billing_admin":
      return {
        canViewDashboard: true,
        canCreateSubOrg: false,
        canAdoptOrg: false,
        canRemoveSubOrg: false,
        canManageBilling: true,
        canInviteAdmins: false,
      };
    case "org_admin":
      return {
        canViewDashboard: true,
        canCreateSubOrg: true,
        canAdoptOrg: false,
        canRemoveSubOrg: false,
        canManageBilling: false,
        canInviteAdmins: false,
      };
  }
}

// Organization with enterprise info
export interface OrganizationWithEnterprise {
  id: string;
  name: string;
  slug: string;
  enterprise_id: string | null;
  enterprise_relationship_type: EnterpriseRelationshipType | null;
  enterprise_adopted_at: string | null;
}
