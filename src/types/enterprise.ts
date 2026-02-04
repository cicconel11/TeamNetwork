/**
 * Enterprise TypeScript Type Definitions
 *
 * This file defines all TypeScript interfaces for the enterprise feature,
 * including pricing tiers, subscriptions, roles, and permissions.
 */

// Enterprise pricing tiers
export type EnterpriseTier = "tier_1" | "tier_2" | "tier_3" | "custom";
export type BillingInterval = "month" | "year";
export type EnterpriseRole = "owner" | "billing_admin" | "org_admin";
export type AdoptionRequestStatus = "pending" | "accepted" | "rejected" | "expired";
export type EnterpriseRelationshipType = "created" | "adopted";
export type SubOrgBillingType = "enterprise_managed" | "independent";

// Pricing model types
export type PricingModel = "alumni_tier" | "per_sub_org";

// Quantity pricing constants
export const ENTERPRISE_SEAT_PRICING = {
  freeSubOrgs: 5, // First 5 organizations are free
  pricePerAdditionalCentsYearly: 15000, // $150/year per additional org beyond free tier
  pricePerAdditionalCentsMonthly: 1250, // $12.50/month per additional org (yearly / 12)
} as const;

// Tier limits (null = unlimited)
export const ENTERPRISE_TIER_LIMITS: Record<EnterpriseTier, number | null> = {
  tier_1: 5000,
  tier_2: 10000,
  tier_3: null, // unlimited (custom pricing)
  custom: null,
};

// Tier pricing in cents (null = custom pricing required)
export const ENTERPRISE_TIER_PRICING: Record<
  EnterpriseTier,
  { monthly: number; yearly: number } | null
> = {
  tier_1: { monthly: 10000, yearly: 100000 }, // $100/mo or $1000/yr
  tier_2: { monthly: 15000, yearly: 150000 }, // $150/mo or $1500/yr
  tier_3: null, // custom pricing
  custom: null,
};

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

// Enterprise subscription
export interface EnterpriseSubscription {
  id: string;
  enterprise_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: BillingInterval;
  alumni_tier: EnterpriseTier;
  pooled_alumni_limit: number | null;
  custom_price_cents: number | null;
  pricing_model: PricingModel;
  sub_org_quantity: number | null;
  price_per_sub_org_cents: number | null;
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
