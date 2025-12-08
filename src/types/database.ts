// Database types for TeamNetwork
// These match the Supabase schema we created

export type UserRole = "admin" | "member" | "viewer";
export type MemberStatus = "active" | "inactive";
export type EventType = "general" | "philanthropy" | "game" | "meeting" | "social" | "fundraiser";

export interface Organization {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  primary_color: string | null;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface UserOrganizationRole {
  id: string;
  user_id: string;
  organization_id: string;
  role: UserRole;
  created_at: string;
}

export interface Member {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role: string | null;
  status: MemberStatus;
  graduation_year: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Alumni {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  graduation_year: number | null;
  major: string | null;
  job_title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Event {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  location: string | null;
  event_type: EventType;
  is_philanthropy: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Announcement {
  id: string;
  organization_id: string;
  title: string;
  body: string | null;
  published_at: string;
  created_by_user_id: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Donation {
  id: string;
  organization_id: string;
  donor_name: string;
  donor_email: string | null;
  amount: number;
  date: string;
  campaign: string | null;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Record {
  id: string;
  organization_id: string;
  title: string;
  category: string | null;
  value: string;
  holder_name: string;
  year: number | null;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Competition {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  season: string | null;
  created_at: string;
}

export interface CompetitionPoint {
  id: string;
  competition_id: string;
  team_name: string | null;
  member_id: string | null;
  points: number;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface PhilanthropyEvent {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  date: string;
  location: string | null;
  slots_available: number | null;
  signup_link: string | null;
  created_at: string;
  deleted_at: string | null;
}

export type NotificationChannel = "email" | "sms" | "both";
export type NotificationAudience = "members" | "alumni" | "both";
export type SubscriptionInterval = "month" | "year";
export type AlumniBucket = "none" | "0-200" | "201-600" | "601-1500" | "1500+";

export interface NotificationPreference {
  id: string;
  user_id: string;
  organization_id: string;
  email_enabled: boolean;
  sms_enabled: boolean;
  email_address: string | null;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  organization_id: string;
  created_by_user_id: string | null;
  title: string;
  body: string | null;
  channel: NotificationChannel;
  audience: NotificationAudience;
  created_at: string;
  sent_at: string | null;
  deleted_at: string | null;
}

export type InviteRole = "admin" | "member";

export interface OrganizationInvite {
  id: string;
  organization_id: string;
  code: string;
  created_by_user_id: string | null;
  role: InviteRole;
  uses_remaining: number | null;
  expires_at: string | null;
  created_at: string;
}

export interface OrganizationSubscription {
  id: string;
  organization_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  base_plan_interval: SubscriptionInterval;
  alumni_bucket: AlumniBucket;
  alumni_plan_interval: SubscriptionInterval | null;
  status: string;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

// Supabase Database type for typed client
export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: Organization;
        Insert: Omit<Organization, "id" | "created_at">;
        Update: Partial<Omit<Organization, "id">>;
      };
      users: {
        Row: User;
        Insert: Omit<User, "created_at">;
        Update: Partial<Omit<User, "id">>;
      };
      user_organization_roles: {
        Row: UserOrganizationRole;
        Insert: Omit<UserOrganizationRole, "id" | "created_at">;
        Update: Partial<Omit<UserOrganizationRole, "id">>;
      };
      members: {
        Row: Member;
        Insert: Omit<Member, "id" | "created_at" | "updated_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<Member, "id" | "created_at">>;
      };
      alumni: {
        Row: Alumni;
        Insert: Omit<Alumni, "id" | "created_at" | "updated_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<Alumni, "id" | "created_at">>;
      };
      events: {
        Row: Event;
        Insert: Omit<Event, "id" | "created_at" | "updated_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<Event, "id" | "created_at">>;
      };
      announcements: {
        Row: Announcement;
        Insert: Omit<Announcement, "id" | "created_at" | "updated_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<Announcement, "id" | "created_at">>;
      };
      donations: {
        Row: Donation;
        Insert: Omit<Donation, "id" | "created_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<Donation, "id" | "created_at">>;
      };
      records: {
        Row: Record;
        Insert: Omit<Record, "id" | "created_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<Record, "id" | "created_at">>;
      };
      competitions: {
        Row: Competition;
        Insert: Omit<Competition, "id" | "created_at">;
        Update: Partial<Omit<Competition, "id" | "created_at">>;
      };
      competition_points: {
        Row: CompetitionPoint;
        Insert: Omit<CompetitionPoint, "id" | "created_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<CompetitionPoint, "id" | "created_at">>;
      };
      philanthropy_events: {
        Row: PhilanthropyEvent;
        Insert: Omit<PhilanthropyEvent, "id" | "created_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<PhilanthropyEvent, "id" | "created_at">>;
      };
      notification_preferences: {
        Row: NotificationPreference;
        Insert: Omit<NotificationPreference, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<NotificationPreference, "id" | "created_at">>;
      };
      notifications: {
        Row: Notification;
        Insert: Omit<Notification, "id" | "created_at" | "deleted_at"> & {
          deleted_at?: string | null;
        };
        Update: Partial<Omit<Notification, "id" | "created_at">>;
      };
      organization_invites: {
        Row: OrganizationInvite;
        Insert: Omit<OrganizationInvite, "id" | "created_at">;
        Update: Partial<Omit<OrganizationInvite, "id" | "created_at">>;
      };
      organization_subscriptions: {
        Row: OrganizationSubscription;
        Insert: Omit<OrganizationSubscription, "id" | "created_at" | "updated_at" | "stripe_customer_id" | "stripe_subscription_id" | "current_period_end" | "status"> & {
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          current_period_end?: string | null;
          status?: string;
        };
        Update: Partial<Omit<OrganizationSubscription, "id">>;
      };
    };
    Enums: {
      user_role: UserRole;
      member_status: MemberStatus;
      event_type: EventType;
      notification_channel: NotificationChannel;
      invite_role: InviteRole;
    };
  };
}

