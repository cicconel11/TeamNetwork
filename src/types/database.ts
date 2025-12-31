export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      alumni: {
        Row: {
          created_at: string | null
          current_city: string | null
          current_company: string | null
          deleted_at: string | null
          email: string | null
          first_name: string
          graduation_year: number | null
          id: string
          industry: string | null
          job_title: string | null
          last_name: string
          linkedin_url: string | null
          major: string | null
          notes: string | null
          organization_id: string
          phone_number: string | null
          photo_url: string | null
          position_title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_city?: string | null
          current_company?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name: string
          graduation_year?: number | null
          id?: string
          industry?: string | null
          job_title?: string | null
          last_name: string
          linkedin_url?: string | null
          major?: string | null
          notes?: string | null
          organization_id: string
          phone_number?: string | null
          photo_url?: string | null
          position_title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_city?: string | null
          current_company?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          graduation_year?: number | null
          id?: string
          industry?: string | null
          job_title?: string | null
          last_name: string
          linkedin_url?: string | null
          major?: string | null
          notes?: string | null
          organization_id?: string
          phone_number?: string | null
          photo_url?: string | null
          position_title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alumni_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          audience: string | null
          audience_user_ids: string[] | null
          body: string | null
          created_at: string | null
          created_by_user_id: string | null
          deleted_at: string | null
          id: string
          is_pinned: boolean | null
          organization_id: string
          published_at: string | null
          target_user_ids: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          audience?: string | null
          audience_user_ids?: string[] | null
          body?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          is_pinned?: boolean | null
          organization_id: string
          published_at?: string | null
          target_user_ids?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          audience?: string | null
          audience_user_ids?: string[] | null
          body?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          is_pinned?: boolean | null
          organization_id?: string
          published_at?: string | null
          target_user_ids?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      class_action_docs: {
        Row: {
          chunk_index: number
          class_action_id: string | null
          content: string
          created_at: string | null
          embedding: string | null
          id: string
        }
        Insert: {
          chunk_index: number
          class_action_id?: string | null
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
        }
        Update: {
          chunk_index?: number
          class_action_id?: string | null
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_action_docs_class_action_id_fkey"
            columns: ["class_action_id"]
            isOneToOne: false
            referencedRelation: "class_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      class_action_personas: {
        Row: {
          class_action_id: string
          created_at: string | null
          id: string
          persona_json: Json
          summary: string
          updated_at: string | null
        }
        Insert: {
          class_action_id: string
          created_at?: string | null
          id?: string
          persona_json: Json
          summary: string
          updated_at?: string | null
        }
        Update: {
          class_action_id?: string
          created_at?: string | null
          id?: string
          persona_json?: Json
          summary?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_action_personas_class_action_id_fkey"
            columns: ["class_action_id"]
            isOneToOne: true
            referencedRelation: "class_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      class_actions: {
        Row: {
          created_at: string | null
          id: string
          name: string
          short_summary: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          short_summary: string
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          short_summary?: string
          slug?: string
        }
        Relationships: []
      }
      competition_points: {
        Row: {
          competition_id: string
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          member_id: string | null
          notes: string | null
          organization_id: string | null
          points: number
          reason: string | null
          team_id: string | null
          team_name: string | null
        }
        Insert: {
          competition_id: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          member_id?: string | null
          notes?: string | null
          organization_id?: string | null
          points?: number
          reason?: string | null
          team_id?: string | null
          team_name?: string | null
        }
        Update: {
          competition_id?: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          member_id?: string | null
          notes?: string | null
          organization_id?: string | null
          points?: number
          reason?: string | null
          team_id?: string | null
          team_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_points_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_points_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_points_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_points_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "competition_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_teams: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_teams_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          season: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          season?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          season?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      donations: {
        Row: {
          amount: number
          campaign: string | null
          created_at: string | null
          date: string
          deleted_at: string | null
          donor_email: string | null
          donor_name: string
          id: string
          notes: string | null
          organization_id: string
        }
        Insert: {
          amount: number
          campaign?: string | null
          created_at?: string | null
          date: string
          deleted_at?: string | null
          donor_email?: string | null
          donor_name: string
          id?: string
          notes?: string | null
          organization_id: string
        }
        Update: {
          amount?: number
          campaign?: string | null
          created_at?: string | null
          date?: string
          deleted_at?: string | null
          donor_email?: string | null
          donor_name?: string
          id?: string
          notes?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "donations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          audience: string | null
          created_at: string | null
          created_by_user_id: string | null
          deleted_at: string | null
          description: string | null
          end_date: string | null
          event_type: Database["public"]["Enums"]["event_type"] | null
          id: string
          is_philanthropy: boolean | null
          location: string | null
          organization_id: string
          start_date: string
          target_user_ids: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          audience?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"] | null
          id?: string
          is_philanthropy?: boolean | null
          location?: string | null
          organization_id: string
          start_date: string
          target_user_ids?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          audience?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"] | null
          id?: string
          is_philanthropy?: boolean | null
          location?: string | null
          organization_id?: string
          start_date?: string
          target_user_ids?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          apollo_company_id: string | null
          apollo_person_id: string | null
          class_action_id: string | null
          company_domain: string | null
          company_name: string
          contact_email: string | null
          contact_linkedin: string | null
          contact_name: string
          contact_phone: string | null
          contact_title: string | null
          created_at: string | null
          id: string
          justification: string
          opt_out_risk: number | null
          raw_apollo_payload: Json | null
        }
        Insert: {
          apollo_company_id?: string | null
          apollo_person_id?: string | null
          class_action_id?: string | null
          company_domain?: string | null
          company_name: string
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_name: string
          contact_phone?: string | null
          contact_title?: string | null
          created_at?: string | null
          id?: string
          justification: string
          opt_out_risk?: number | null
          raw_apollo_payload?: Json | null
        }
        Update: {
          apollo_company_id?: string | null
          apollo_person_id?: string | null
          class_action_id?: string | null
          company_domain?: string | null
          company_name?: string
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_name: string
          contact_phone?: string | null
          contact_title?: string | null
          created_at?: string | null
          id?: string
          justification?: string
          opt_out_risk?: number | null
          raw_apollo_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_class_action_id_fkey"
            columns: ["class_action_id"]
            isOneToOne: false
            referencedRelation: "class_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          email: string | null
          first_name: string
          graduation_year: number | null
          id: string
          last_name: string
          linkedin_url: string | null
          organization_id: string
          photo_url: string | null
          role: string | null
          status: Database["public"]["Enums"]["member_status"] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name: string
          graduation_year?: number | null
          id?: string
          last_name: string
          linkedin_url?: string | null
          organization_id: string
          photo_url?: string | null
          role?: string | null
          status?: Database["public"]["Enums"]["member_status"] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          graduation_year?: number | null
          id?: string
          last_name: string
          linkedin_url?: string | null
          organization_id?: string
          photo_url?: string | null
          role?: string | null
          status?: Database["public"]["Enums"]["member_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mentorship_logs: {
        Row: {
          created_at: string
          created_by: string
          entry_date: string
          id: string
          notes: string | null
          organization_id: string
          pair_id: string
          progress_metric: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          entry_date?: string
          id?: string
          notes?: string | null
          organization_id: string
          pair_id: string
          progress_metric?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          entry_date?: string
          id?: string
          notes?: string | null
          organization_id?: string
          pair_id?: string
          progress_metric?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentorship_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentorship_logs_pair_id_fkey"
            columns: ["pair_id"]
            isOneToOne: false
            referencedRelation: "mentorship_pairs"
            referencedColumns: ["id"]
          },
        ]
      }
      mentorship_pairs: {
        Row: {
          created_at: string
          id: string
          mentee_user_id: string
          mentor_user_id: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentee_user_id: string
          mentor_user_id: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          mentee_user_id?: string
          mentor_user_id?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentorship_pairs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string | null
          email_address: string | null
          email_enabled: boolean | null
          id: string
          organization_id: string
          phone_number: string | null
          sms_enabled: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email_address?: string | null
          email_enabled?: boolean | null
          id?: string
          organization_id: string
          phone_number?: string | null
          sms_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email_address?: string | null
          email_enabled?: boolean | null
          id?: string
          organization_id?: string
          phone_number?: string | null
          sms_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          audience: string
          body: string | null
          channel: string
          created_at: string | null
          created_by_user_id: string | null
          deleted_at: string | null
          id: string
          organization_id: string
          sent_at: string | null
          target_user_ids: string[] | null
          title: string
        }
        Insert: {
          audience?: string
          body?: string | null
          channel: string
          created_at?: string | null
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          organization_id: string
          sent_at?: string | null
          target_user_ids?: string[] | null
          title: string
        }
        Update: {
          audience?: string
          body?: string | null
          channel?: string
          created_at?: string | null
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          organization_id?: string
          sent_at?: string | null
          target_user_ids?: string[] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_philanthropy_embeds: {
        Row: {
          created_at: string
          display_order: number
          embed_type: string
          id: string
          organization_id: string
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          embed_type: string
          id?: string
          organization_id: string
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          display_order?: number
          embed_type?: string
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_philanthropy_embeds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_donations: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          donor_email: string | null
          donor_name: string | null
          event_id: string | null
          id: string
          metadata: Json | null
          organization_id: string
          purpose: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          donor_email?: string | null
          donor_name?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          purpose?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          donor_email?: string | null
          donor_name?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          purpose?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_donations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_donations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_donation_stats: {
        Row: {
          donation_count: number
          last_donation_at: string | null
          organization_id: string
          total_amount_cents: number
          updated_at: string
        }
        Insert: {
          donation_count?: number
          last_donation_at?: string | null
          organization_id: string
          total_amount_cents?: number
          updated_at?: string
        }
        Update: {
          donation_count?: number
          last_donation_at?: string | null
          organization_id?: string
          total_amount_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_donation_stats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          code: string
          created_at: string | null
          created_by_user_id: string | null
          expires_at: string | null
          id: string
          organization_id: string
          revoked_at: string | null
          role: string | null
          token: string | null
          uses_remaining: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by_user_id?: string | null
          expires_at?: string | null
          id?: string
          organization_id: string
          revoked_at?: string | null
          role?: string | null
          token?: string | null
          uses_remaining?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by_user_id?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string
          revoked_at?: string | null
          role?: string | null
          token?: string | null
          uses_remaining?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_subscriptions: {
        Row: {
          alumni_bucket: string
          alumni_plan_interval: string | null
          base_plan_interval: string
          created_at: string
          current_period_end: string | null
          id: string
          organization_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          alumni_bucket?: string
          alumni_plan_interval?: string | null
          base_plan_interval: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          organization_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          alumni_bucket?: string
          alumni_plan_interval?: string | null
          base_plan_interval?: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          organization_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          description: string | null
          donation_embed_url: string | null
          id: string
          logo_url: string | null
          name: string
          nav_config: Json | null
          primary_color: string | null
          slug: string
          stripe_connect_account_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          donation_embed_url?: string | null
          id?: string
          logo_url?: string | null
          name: string
          nav_config?: Json | null
          primary_color?: string | null
          slug: string
          stripe_connect_account_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          donation_embed_url?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          nav_config?: Json | null
          primary_color?: string | null
          slug?: string
          stripe_connect_account_id?: string | null
        }
        Relationships: []
      }
      philanthropy_events: {
        Row: {
          created_at: string | null
          date: string
          deleted_at: string | null
          description: string | null
          id: string
          location: string | null
          organization_id: string
          signup_link: string | null
          slots_available: number | null
          title: string
        }
        Insert: {
          created_at?: string | null
          date: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          location?: string | null
          organization_id: string
          signup_link?: string | null
          slots_available?: number | null
          title: string
        }
        Update: {
          created_at?: string | null
          date?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          location?: string | null
          organization_id?: string
          signup_link?: string | null
          slots_available?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "philanthropy_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      records: {
        Row: {
          category: string | null
          created_at: string | null
          deleted_at: string | null
          holder_name: string
          id: string
          notes: string | null
          organization_id: string
          title: string
          value: string
          year: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          deleted_at?: string | null
          holder_name: string
          id?: string
          notes?: string | null
          organization_id: string
          title: string
          value: string
          year?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          deleted_at?: string | null
          holder_name?: string
          id?: string
          notes?: string | null
          organization_id?: string
          title?: string
          value: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organization_roles: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["membership_status"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          name: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id: string
          name?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      workout_logs: {
        Row: {
          created_at: string
          id: string
          metrics: Json | null
          notes: string | null
          organization_id: string
          status: string
          updated_at: string
          user_id: string
          workout_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metrics?: Json | null
          notes?: string | null
          organization_id: string
          status?: string
          updated_at?: string
          user_id: string
          workout_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metrics?: Json | null
          notes?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_logs_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          external_url: string | null
          id: string
          organization_id: string
          title: string
          updated_at: string
          workout_date: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          id?: string
          organization_id: string
          title: string
          updated_at?: string
          workout_date?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          workout_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workouts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_org_invite: {
        Args: {
          p_expires_at?: string
          p_organization_id: string
          p_role?: string
          p_uses?: number
        }
        Returns: {
          code: string
          created_at: string | null
          created_by_user_id: string | null
          expires_at: string | null
          id: string
          organization_id: string
          revoked_at: string | null
          role: string | null
          token: string | null
          uses_remaining: number | null
        }
        SetofOptions: {
          from: "*"
          to: "organization_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_dropdown_options: { Args: { p_org_id: string }; Returns: Json }
      has_active_role: {
        Args: { allowed_roles: string[]; org: string }
        Returns: boolean
      }
      is_org_admin: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      match_class_action_docs: {
        Args: {
          match_count: number
          query_embedding: string
          target_class_action_id: string
        }
        Returns: {
          chunk_index: number
          content: string
          id: string
          similarity: number
        }[]
      }
      redeem_org_invite: { Args: { p_code: string }; Returns: Json }
      redeem_org_invite_by_token: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      event_type:
        | "general"
        | "philanthropy"
        | "game"
        | "meeting"
        | "social"
        | "fundraiser"
      member_status: "active" | "inactive"
      membership_status: "active" | "revoked"
      user_role: "admin" | "member" | "viewer" | "active_member" | "alumni"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof DatabaseWithoutInternals, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
      DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] &
      DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

// Table type exports
export type Alumni = Tables<'alumni'>;
export type Announcement = Tables<'announcements'>;
export type ClassAction = Tables<'class_actions'>;
export type ClassActionDoc = Tables<'class_action_docs'>;
export type ClassActionPersona = Tables<'class_action_personas'>;
export type Competition = Tables<'competitions'>;
export type CompetitionPoint = Tables<'competition_points'>;
export type CompetitionTeam = Tables<'competition_teams'>;
export type Donation = Tables<'donations'>;
export type Event = Tables<'events'>;
export type Lead = Tables<'leads'>;
export type Member = Tables<'members'>;
export type MentorshipLog = Tables<'mentorship_logs'>;
export type MentorshipPair = Tables<'mentorship_pairs'>;
export type Notification = Tables<'notifications'>;
export type NotificationPreference = Tables<'notification_preferences'>;
export type Organization = Tables<'organizations'>;
export type OrganizationDonation = Tables<'organization_donations'>;
export type OrganizationDonationStat = Tables<'organization_donation_stats'>;
export type OrganizationInvite = Tables<'organization_invites'>;
export type OrganizationSubscription = Tables<'organization_subscriptions'>;
export type PhilanthropyEvent = Tables<'philanthropy_events'>;
export type Record = Tables<'records'>;
export type User = Tables<'users'>;
export type UserOrganizationRole = Tables<'user_organization_roles'>;
export type Workout = Tables<'workouts'>;
export type WorkoutLog = Tables<'workout_logs'>;

// Enum type exports
export type EventType = Enums<'event_type'>;
export type MemberStatus = Enums<'member_status'>;
export type MembershipStatus = Enums<'membership_status'>;
export type UserRole = Enums<'user_role'>;

// Additional type aliases for backward compatibility and convenience
export type AnnouncementAudience = "all" | "members" | "active_members" | "alumni" | "individuals";
export type NotificationAudience = "members" | "alumni" | "both";
export type NotificationChannel = "email" | "sms" | "both";
export type WorkoutStatus = "not_started" | "in_progress" | "completed";
export type AlumniBucket = "none" | "0-200" | "201-600" | "601-1500" | "1500+";
export type SubscriptionInterval = "month" | "year";
export type EmbedType = "link" | "iframe";

// Embed types (based on component usage)
export interface PhilanthropyEmbed {
  id: string;
  organization_id: string;
  title: string;
  url: string;
  embed_type: "link" | "iframe";
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface DonationEmbed {
  id: string;
  organization_id: string;
  title: string;
  url: string;
  embed_type: "link" | "iframe";
  display_order: number;
  created_at: string;
  updated_at: string;
}

export const Constants = {
  public: {
    Enums: {
      event_type: [
        "general",
        "philanthropy",
        "game",
        "meeting",
        "social",
        "fundraiser",
      ],
      member_status: ["active", "inactive"],
      membership_status: ["active", "revoked"],
      user_role: ["admin", "member", "viewer", "active_member", "alumni"],
    },
  },
} as const
