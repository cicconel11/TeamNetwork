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
      academic_schedules: {
        Row: {
          created_at: string | null
          day_of_month: number | null
          day_of_week: number[] | null
          deleted_at: string | null
          end_date: string | null
          end_time: string
          id: string
          notes: string | null
          occurrence_type: string
          organization_id: string
          start_date: string
          start_time: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          day_of_month?: number | null
          day_of_week?: number[] | null
          deleted_at?: string | null
          end_date?: string | null
          end_time: string
          id?: string
          notes?: string | null
          occurrence_type: string
          organization_id: string
          start_date: string
          start_time: string
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          day_of_month?: number | null
          day_of_week?: number[] | null
          deleted_at?: string | null
          end_date?: string | null
          end_time?: string
          id?: string
          notes?: string | null
          occurrence_type?: string
          organization_id?: string
          start_date?: string
          start_time?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_schedules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
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
          user_id: string | null
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
          user_id?: string | null
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
          last_name?: string
          linkedin_url?: string | null
          major?: string | null
          notes?: string | null
          organization_id?: string
          phone_number?: string | null
          photo_url?: string | null
          position_title?: string | null
          updated_at?: string | null
          user_id?: string | null
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
      analytics_consent: {
        Row: {
          consent_state: Database["public"]["Enums"]["analytics_consent_state"]
          decided_at: string
          org_id: string
          user_id: string
        }
        Insert: {
          consent_state: Database["public"]["Enums"]["analytics_consent_state"]
          decided_at?: string
          org_id: string
          user_id?: string
        }
        Update: {
          consent_state?: Database["public"]["Enums"]["analytics_consent_state"]
          decided_at?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_consent_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          app_version: string
          client_day: string
          created_at: string
          device_class: string
          event_name: Database["public"]["Enums"]["analytics_event_name"]
          id: number
          org_id: string
          platform: string
          props: Json
          route: string
          session_id: string
        }
        Insert: {
          app_version: string
          client_day: string
          created_at?: string
          device_class: string
          event_name: Database["public"]["Enums"]["analytics_event_name"]
          id?: number
          org_id: string
          platform: string
          props?: Json
          route: string
          session_id: string
        }
        Update: {
          app_version?: string
          client_day?: string
          created_at?: string
          device_class?: string
          event_name?: Database["public"]["Enums"]["analytics_event_name"]
          id?: number
          org_id?: string
          platform?: string
          props?: Json
          route?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_ops_events: {
        Row: {
          app_version: string
          client_day: string
          consent_state: string
          created_at: string
          device_class: string
          event_name: string
          id: string
          organization_id: string | null
          payload: Json
          platform: string
          referrer_type: string
          route: string
          session_id: string
        }
        Insert: {
          app_version: string
          client_day: string
          consent_state: string
          created_at?: string
          device_class: string
          event_name: string
          id?: string
          organization_id?: string | null
          payload: Json
          platform: string
          referrer_type: string
          route: string
          session_id: string
        }
        Update: {
          app_version?: string
          client_day?: string
          consent_state?: string
          created_at?: string
          device_class?: string
          event_name?: string
          id?: string
          organization_id?: string | null
          payload?: Json
          platform?: string
          referrer_type?: string
          route?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_ops_events_organization_id_fkey"
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
      calendar_events: {
        Row: {
          all_day: boolean | null
          created_at: string | null
          description: string | null
          end_at: string | null
          external_uid: string
          feed_id: string
          id: string
          instance_key: string
          location: string | null
          organization_id: string | null
          raw: Json | null
          scope: string
          start_at: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          all_day?: boolean | null
          created_at?: string | null
          description?: string | null
          end_at?: string | null
          external_uid: string
          feed_id: string
          id?: string
          instance_key: string
          location?: string | null
          organization_id?: string | null
          raw?: Json | null
          scope?: string
          start_at: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          all_day?: boolean | null
          created_at?: string | null
          description?: string | null
          end_at?: string | null
          external_uid?: string
          feed_id?: string
          id?: string
          instance_key?: string
          location?: string | null
          organization_id?: string | null
          raw?: Json | null
          scope?: string
          start_at?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_feed_id_fkey"
            columns: ["feed_id"]
            isOneToOne: false
            referencedRelation: "calendar_feeds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feeds: {
        Row: {
          connected_user_id: string | null
          created_at: string | null
          feed_url: string
          google_calendar_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          organization_id: string | null
          provider: string
          scope: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          connected_user_id?: string | null
          created_at?: string | null
          feed_url: string
          google_calendar_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id?: string | null
          provider?: string
          scope?: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          connected_user_id?: string | null
          created_at?: string | null
          feed_url?: string
          google_calendar_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id?: string | null
          provider?: string
          scope?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feeds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sync_preferences: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          sync_fundraiser: boolean | null
          sync_game: boolean | null
          sync_general: boolean | null
          sync_meeting: boolean | null
          sync_philanthropy: boolean | null
          sync_social: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          sync_fundraiser?: boolean | null
          sync_game?: boolean | null
          sync_general?: boolean | null
          sync_meeting?: boolean | null
          sync_philanthropy?: boolean | null
          sync_social?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          sync_fundraiser?: boolean | null
          sync_game?: boolean | null
          sync_general?: boolean | null
          sync_meeting?: boolean | null
          sync_philanthropy?: boolean | null
          sync_social?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sync_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_sync_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_group_members: {
        Row: {
          added_by: string | null
          chat_group_id: string
          id: string
          joined_at: string
          last_read_at: string | null
          organization_id: string
          removed_at: string | null
          role: Database["public"]["Enums"]["chat_group_role"]
          user_id: string
        }
        Insert: {
          added_by?: string | null
          chat_group_id: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          organization_id: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["chat_group_role"]
          user_id: string
        }
        Update: {
          added_by?: string | null
          chat_group_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          organization_id?: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["chat_group_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_group_members_chat_group_id_fkey"
            columns: ["chat_group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_group_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_group_members_user_id_public_users_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_groups: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
          require_approval: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          require_approval?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          require_approval?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          author_id: string
          body: string
          chat_group_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          organization_id: string
          rejected_at: string | null
          rejected_by: string | null
          status: Database["public"]["Enums"]["chat_message_status"]
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          author_id: string
          body: string
          chat_group_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          organization_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          status?: Database["public"]["Enums"]["chat_message_status"]
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          author_id?: string
          body?: string
          chat_group_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          organization_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          status?: Database["public"]["Enums"]["chat_message_status"]
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_group_id_fkey"
            columns: ["chat_group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      compliance_audit_log: {
        Row: {
          age_bracket: string | null
          created_at: string
          event_type: string
          id: string
          ip_hash: string | null
        }
        Insert: {
          age_bracket?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip_hash?: string | null
        }
        Update: {
          age_bracket?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_hash?: string | null
        }
        Relationships: []
      }
      dev_admin_audit_logs: {
        Row: {
          action: string
          admin_email_redacted: string
          admin_user_id: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          request_method: string | null
          request_path: string | null
          target_id: string | null
          target_slug: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_email_redacted: string
          admin_user_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          request_method?: string | null
          request_path?: string | null
          target_id?: string | null
          target_slug?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_email_redacted?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          request_method?: string | null
          request_path?: string | null
          target_id?: string | null
          target_slug?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      discussion_replies: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discussion_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_replies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_replies_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "discussion_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_threads: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          is_locked: boolean
          is_pinned: boolean
          last_activity_at: string
          organization_id: string
          reply_count: number
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_locked?: boolean
          is_pinned?: boolean
          last_activity_at?: string
          organization_id: string
          reply_count?: number
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_locked?: boolean
          is_pinned?: boolean
          last_activity_at?: string
          organization_id?: string
          reply_count?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discussion_threads_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_threads_organization_id_fkey"
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
      enterprise_adoption_requests: {
        Row: {
          enterprise_id: string
          expires_at: string | null
          id: string
          organization_id: string
          requested_at: string
          requested_by: string
          responded_at: string | null
          responded_by: string | null
          status: string
        }
        Insert: {
          enterprise_id: string
          expires_at?: string | null
          id?: string
          organization_id: string
          requested_at?: string
          requested_by: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
        }
        Update: {
          enterprise_id?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          requested_at?: string
          requested_by?: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_adoption_requests_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprise_alumni_counts"
            referencedColumns: ["enterprise_id"]
          },
          {
            foreignKeyName: "enterprise_adoption_requests_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_adoption_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_invites: {
        Row: {
          code: string
          created_at: string
          created_by_user_id: string
          enterprise_id: string
          expires_at: string | null
          id: string
          organization_id: string | null
          revoked_at: string | null
          role: string
          token: string
          uses_remaining: number | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by_user_id: string
          enterprise_id: string
          expires_at?: string | null
          id?: string
          organization_id?: string | null
          revoked_at?: string | null
          role: string
          token: string
          uses_remaining?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by_user_id?: string
          enterprise_id?: string
          expires_at?: string | null
          id?: string
          organization_id?: string | null
          revoked_at?: string | null
          role?: string
          token?: string
          uses_remaining?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_invites_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprise_alumni_counts"
            referencedColumns: ["enterprise_id"]
          },
          {
            foreignKeyName: "enterprise_invites_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_subscriptions: {
        Row: {
          alumni_tier: string
          billing_interval: string
          created_at: string
          current_period_end: string | null
          custom_price_cents: number | null
          enterprise_id: string
          grace_period_ends_at: string | null
          id: string
          pooled_alumni_limit: number | null
          price_per_sub_org_cents: number | null
          pricing_model: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          sub_org_quantity: number | null
          updated_at: string
        }
        Insert: {
          alumni_tier?: string
          billing_interval: string
          created_at?: string
          current_period_end?: string | null
          custom_price_cents?: number | null
          enterprise_id: string
          grace_period_ends_at?: string | null
          id?: string
          pooled_alumni_limit?: number | null
          price_per_sub_org_cents?: number | null
          pricing_model?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          sub_org_quantity?: number | null
          updated_at?: string
        }
        Update: {
          alumni_tier?: string
          billing_interval?: string
          created_at?: string
          current_period_end?: string | null
          custom_price_cents?: number | null
          enterprise_id?: string
          grace_period_ends_at?: string | null
          id?: string
          pooled_alumni_limit?: number | null
          price_per_sub_org_cents?: number | null
          pricing_model?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          sub_org_quantity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_subscriptions_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprise_alumni_counts"
            referencedColumns: ["enterprise_id"]
          },
          {
            foreignKeyName: "enterprise_subscriptions_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprises"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprises: {
        Row: {
          billing_contact_email: string | null
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          nav_config: Json | null
          nav_locked_items: string[] | null
          primary_color: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          billing_contact_email?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          nav_config?: Json | null
          nav_locked_items?: string[] | null
          primary_color?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          billing_contact_email?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          nav_config?: Json | null
          nav_locked_items?: string[] | null
          primary_color?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      error_events: {
        Row: {
          api_path: string | null
          created_at: string
          env: string
          group_id: string
          id: string
          message: string
          meta: Json
          route: string | null
          session_id: string | null
          stack: string | null
          user_id: string | null
        }
        Insert: {
          api_path?: string | null
          created_at?: string
          env: string
          group_id: string
          id?: string
          message: string
          meta?: Json
          route?: string | null
          session_id?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Update: {
          api_path?: string | null
          created_at?: string
          env?: string
          group_id?: string
          id?: string
          message?: string
          meta?: Json
          route?: string | null
          session_id?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "error_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      error_groups: {
        Row: {
          baseline_rate_1h: number | null
          count_1h: number
          count_24h: number
          env: string
          fingerprint: string
          first_notified_at: string | null
          first_seen_at: string
          id: string
          last_notified_at: string | null
          last_seen_at: string
          sample_event: Json
          severity: string
          spike_threshold_1h: number | null
          status: string
          title: string
          total_count: number
        }
        Insert: {
          baseline_rate_1h?: number | null
          count_1h?: number
          count_24h?: number
          env: string
          fingerprint: string
          first_notified_at?: string | null
          first_seen_at?: string
          id?: string
          last_notified_at?: string | null
          last_seen_at?: string
          sample_event: Json
          severity?: string
          spike_threshold_1h?: number | null
          status?: string
          title: string
          total_count?: number
        }
        Update: {
          baseline_rate_1h?: number | null
          count_1h?: number
          count_24h?: number
          env?: string
          fingerprint?: string
          first_notified_at?: string | null
          first_seen_at?: string
          id?: string
          last_notified_at?: string | null
          last_seen_at?: string
          sample_event?: Json
          severity?: string
          spike_threshold_1h?: number | null
          status?: string
          title?: string
          total_count?: number
        }
        Relationships: []
      }
      event_calendar_entries: {
        Row: {
          created_at: string | null
          event_id: string
          google_calendar_id: string
          google_event_id: string
          id: string
          last_error: string | null
          organization_id: string
          sync_status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          google_calendar_id?: string
          google_event_id: string
          id?: string
          last_error?: string | null
          organization_id: string
          sync_status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          google_calendar_id?: string
          google_event_id?: string
          id?: string
          last_error?: string | null
          organization_id?: string
          sync_status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_calendar_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_calendar_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_calendar_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          checked_in_at: string | null
          checked_in_by: string | null
          created_at: string | null
          event_id: string
          id: string
          organization_id: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string | null
          event_id: string
          id?: string
          organization_id: string
          status: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string | null
          event_id?: string
          id?: string
          organization_id?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          recurrence_group_id: string | null
          recurrence_index: number | null
          recurrence_rule: Json | null
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
          recurrence_group_id?: string | null
          recurrence_index?: number | null
          recurrence_rule?: Json | null
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
          recurrence_group_id?: string | null
          recurrence_index?: number | null
          recurrence_rule?: Json | null
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
      expenses: {
        Row: {
          amount: number
          created_at: string
          deleted_at: string | null
          expense_type: string
          id: string
          name: string
          organization_id: string
          updated_at: string
          user_id: string
          venmo_link: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          deleted_at?: string | null
          expense_type: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          user_id: string
          venmo_link?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          deleted_at?: string | null
          expense_type?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
          venmo_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          post_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          post_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_likes: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_likes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_posts: {
        Row: {
          author_id: string
          body: string
          comment_count: number
          created_at: string
          deleted_at: string | null
          id: string
          like_count: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          comment_count?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          like_count?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          comment_count?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          like_count?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      form_document_submissions: {
        Row: {
          document_id: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          organization_id: string
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          document_id: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id: string
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          document_id?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id?: string
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_document_submissions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "form_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_document_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_document_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      form_documents: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          is_active: boolean | null
          mime_type: string | null
          organization_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          mime_type?: string | null
          organization_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          mime_type?: string | null
          organization_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          form_id: string
          id: string
          organization_id: string
          responses: Json
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          form_id: string
          id?: string
          organization_id: string
          responses?: Json
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          form_id?: string
          id?: string
          organization_id?: string
          responses?: Json
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          fields: Json
          id: string
          is_active: boolean | null
          organization_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          fields?: Json
          id?: string
          is_active?: boolean | null
          organization_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          fields?: Json
          id?: string
          is_active?: boolean | null
          organization_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_postings: {
        Row: {
          application_url: string | null
          company: string
          contact_email: string | null
          created_at: string
          deleted_at: string | null
          description: string
          experience_level: string | null
          expires_at: string | null
          id: string
          industry: string | null
          is_active: boolean
          location: string | null
          location_type: string | null
          organization_id: string
          posted_by: string
          title: string
          updated_at: string
        }
        Insert: {
          application_url?: string | null
          company: string
          contact_email?: string | null
          created_at?: string
          deleted_at?: string | null
          description: string
          experience_level?: string | null
          expires_at?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          location?: string | null
          location_type?: string | null
          organization_id: string
          posted_by: string
          title: string
          updated_at?: string
        }
        Update: {
          application_url?: string | null
          company?: string
          contact_email?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          experience_level?: string | null
          expires_at?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          location?: string | null
          location_type?: string | null
          organization_id?: string
          posted_by?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_postings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_postings_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      media_album_items: {
        Row: {
          added_at: string
          album_id: string
          id: string
          media_item_id: string
          sort_order: number
        }
        Insert: {
          added_at?: string
          album_id: string
          id?: string
          media_item_id: string
          sort_order?: number
        }
        Update: {
          added_at?: string
          album_id?: string
          id?: string
          media_item_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_album_items_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "media_albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_album_items_media_item_id_fkey"
            columns: ["media_item_id"]
            isOneToOne: false
            referencedRelation: "media_items"
            referencedColumns: ["id"]
          },
        ]
      }
      media_albums: {
        Row: {
          cover_media_id: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          description: string | null
          id: string
          item_count: number
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          cover_media_id?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          item_count?: number
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          cover_media_id?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          item_count?: number
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_albums_cover_media_id_fkey"
            columns: ["cover_media_id"]
            isOneToOne: false
            referencedRelation: "media_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_albums_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      media_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          duration_seconds: number | null
          external_url: string | null
          file_name: string | null
          file_size_bytes: number | null
          height: number | null
          id: string
          media_type: string
          mime_type: string | null
          moderated_at: string | null
          moderated_by: string | null
          organization_id: string
          rejection_reason: string | null
          status: Database["public"]["Enums"]["media_status"]
          storage_path: string | null
          tags: string[]
          taken_at: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          uploaded_by: string
          visibility: string
          width: number | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          external_url?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          media_type: string
          mime_type?: string | null
          moderated_at?: string | null
          moderated_by?: string | null
          organization_id: string
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["media_status"]
          storage_path?: string | null
          tags?: string[]
          taken_at?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          uploaded_by: string
          visibility?: string
          width?: number | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          external_url?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          media_type?: string
          mime_type?: string | null
          moderated_at?: string | null
          moderated_by?: string | null
          organization_id?: string
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["media_status"]
          storage_path?: string | null
          tags?: string[]
          taken_at?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string
          visibility?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_items_uploaded_by_users_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      media_uploads: {
        Row: {
          created_at: string
          deleted_at: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["media_entity_type"] | null
          file_name: string
          file_size: number | null
          finalized_at: string | null
          id: string
          mime_type: string
          organization_id: string
          status: Database["public"]["Enums"]["media_upload_status"]
          storage_path: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["media_entity_type"] | null
          file_name: string
          file_size?: number | null
          finalized_at?: string | null
          id?: string
          mime_type: string
          organization_id: string
          status?: Database["public"]["Enums"]["media_upload_status"]
          storage_path: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["media_entity_type"] | null
          file_name?: string
          file_size?: number | null
          finalized_at?: string | null
          id?: string
          mime_type?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["media_upload_status"]
          storage_path?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_uploads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_uploads_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          email: string | null
          expected_graduation_date: string | null
          first_name: string
          graduated_at: string | null
          graduation_warning_sent_at: string | null
          graduation_year: number | null
          id: string
          last_name: string
          linkedin_url: string | null
          organization_id: string
          photo_url: string | null
          role: string | null
          status: Database["public"]["Enums"]["member_status"] | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          expected_graduation_date?: string | null
          first_name: string
          graduated_at?: string | null
          graduation_warning_sent_at?: string | null
          graduation_year?: number | null
          id?: string
          last_name: string
          linkedin_url?: string | null
          organization_id: string
          photo_url?: string | null
          role?: string | null
          status?: Database["public"]["Enums"]["member_status"] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          expected_graduation_date?: string | null
          first_name?: string
          graduated_at?: string | null
          graduation_warning_sent_at?: string | null
          graduation_year?: number | null
          id?: string
          last_name?: string
          linkedin_url?: string | null
          organization_id?: string
          photo_url?: string | null
          role?: string | null
          status?: Database["public"]["Enums"]["member_status"] | null
          updated_at?: string | null
          user_id?: string | null
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
      mentor_profiles: {
        Row: {
          bio: string | null
          contact_email: string | null
          contact_linkedin: string | null
          contact_phone: string | null
          created_at: string
          expertise_areas: string[]
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_phone?: string | null
          created_at?: string
          expertise_areas?: string[]
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_phone?: string | null
          created_at?: string
          expertise_areas?: string[]
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentor_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentor_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          announcement_emails_enabled: boolean
          competition_emails_enabled: boolean
          created_at: string | null
          discussion_emails_enabled: boolean
          email_address: string | null
          email_enabled: boolean | null
          event_emails_enabled: boolean
          id: string
          organization_id: string
          phone_number: string | null
          sms_enabled: boolean | null
          updated_at: string | null
          user_id: string
          workout_emails_enabled: boolean
        }
        Insert: {
          announcement_emails_enabled?: boolean
          competition_emails_enabled?: boolean
          created_at?: string | null
          discussion_emails_enabled?: boolean
          email_address?: string | null
          email_enabled?: boolean | null
          event_emails_enabled?: boolean
          id?: string
          organization_id: string
          phone_number?: string | null
          sms_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
          workout_emails_enabled?: boolean
        }
        Update: {
          announcement_emails_enabled?: boolean
          competition_emails_enabled?: boolean
          created_at?: string | null
          discussion_emails_enabled?: boolean
          email_address?: string | null
          email_enabled?: boolean | null
          event_emails_enabled?: boolean
          id?: string
          organization_id?: string
          phone_number?: string | null
          sms_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
          workout_emails_enabled?: boolean
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
      ops_events: {
        Row: {
          app_version: string
          client_day: string
          created_at: string
          device_class: string
          endpoint_group: string | null
          error_code: string | null
          event_name: Database["public"]["Enums"]["ops_event_name"]
          http_status: number | null
          id: number
          org_id: string | null
          platform: string
          retryable: boolean | null
          route: string
          session_id: string | null
        }
        Insert: {
          app_version: string
          client_day: string
          created_at?: string
          device_class: string
          endpoint_group?: string | null
          error_code?: string | null
          event_name: Database["public"]["Enums"]["ops_event_name"]
          http_status?: number | null
          id?: number
          org_id?: string | null
          platform: string
          retryable?: boolean | null
          route: string
          session_id?: string | null
        }
        Update: {
          app_version?: string
          client_day?: string
          created_at?: string
          device_class?: string
          endpoint_group?: string | null
          error_code?: string | null
          event_name?: Database["public"]["Enums"]["ops_event_name"]
          http_status?: number | null
          id?: number
          org_id?: string | null
          platform?: string
          retryable?: boolean | null
          route?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_donation_embeds: {
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
            foreignKeyName: "org_donation_embeds_organization_id_fkey"
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
            foreignKeyName: "organization_donations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_donations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
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
          grace_period_ends_at: string | null
          id: string
          media_storage_quota_bytes: number | null
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
          grace_period_ends_at?: string | null
          id?: string
          media_storage_quota_bytes?: number | null
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
          grace_period_ends_at?: string | null
          id?: string
          media_storage_quota_bytes?: number | null
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
          discussion_post_roles: string[]
          donation_embed_url: string | null
          enterprise_adopted_at: string | null
          enterprise_id: string | null
          enterprise_nav_synced_at: string | null
          enterprise_relationship_type: string | null
          feed_post_roles: string[]
          id: string
          job_post_roles: string[]
          logo_url: string | null
          media_upload_roles: string[]
          name: string
          nav_config: Json | null
          org_type: string
          original_subscription_id: string | null
          original_subscription_status: string | null
          primary_color: string | null
          secondary_color: string | null
          slug: string
          stripe_connect_account_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          discussion_post_roles?: string[]
          donation_embed_url?: string | null
          enterprise_adopted_at?: string | null
          enterprise_id?: string | null
          enterprise_nav_synced_at?: string | null
          enterprise_relationship_type?: string | null
          feed_post_roles?: string[]
          id?: string
          job_post_roles?: string[]
          logo_url?: string | null
          media_upload_roles?: string[]
          name: string
          nav_config?: Json | null
          org_type?: string
          original_subscription_id?: string | null
          original_subscription_status?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          slug: string
          stripe_connect_account_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          discussion_post_roles?: string[]
          donation_embed_url?: string | null
          enterprise_adopted_at?: string | null
          enterprise_id?: string | null
          enterprise_nav_synced_at?: string | null
          enterprise_relationship_type?: string | null
          feed_post_roles?: string[]
          id?: string
          job_post_roles?: string[]
          logo_url?: string | null
          media_upload_roles?: string[]
          name?: string
          nav_config?: Json | null
          org_type?: string
          original_subscription_id?: string | null
          original_subscription_status?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          slug?: string
          stripe_connect_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprise_alumni_counts"
            referencedColumns: ["enterprise_id"]
          },
          {
            foreignKeyName: "organizations_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprises"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount_cents: number
          checkout_url: string | null
          created_at: string
          currency: string
          flow_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          metadata: Json | null
          organization_id: string | null
          request_fingerprint: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_connected_account_id: string | null
          stripe_payment_intent_id: string | null
          stripe_payout_id: string | null
          stripe_transfer_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_cents?: number
          checkout_url?: string | null
          created_at?: string
          currency?: string
          flow_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          metadata?: Json | null
          organization_id?: string | null
          request_fingerprint?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          checkout_url?: string | null
          created_at?: string
          currency?: string
          flow_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          metadata?: Json | null
          organization_id?: string | null
          request_fingerprint?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_notes: {
        Row: {
          created_at: string | null
          description: string
          id: string
          note_type: string
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          note_type: string
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          note_type?: string
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
      rate_limit_analytics: {
        Row: {
          created_at: string
          event_count: number
          id: number
          org_id: string
          user_id: string
          window_start: string
        }
        Insert: {
          created_at?: string
          event_count?: number
          id?: number
          org_id: string
          user_id: string
          window_start?: string
        }
        Update: {
          created_at?: string
          event_count?: number
          id?: number
          org_id?: string
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_analytics_org_id_fkey"
            columns: ["org_id"]
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
          value?: string
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
      schedule_allowed_domains: {
        Row: {
          created_at: string
          fingerprint: Json
          hostname: string
          id: string
          last_seen_at: string
          status: string
          vendor_id: string
          verification_method: string | null
          verified_at: string | null
          verified_by_org_id: string | null
          verified_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          fingerprint?: Json
          hostname: string
          id?: string
          last_seen_at?: string
          status?: string
          vendor_id: string
          verification_method?: string | null
          verified_at?: string | null
          verified_by_org_id?: string | null
          verified_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          fingerprint?: Json
          hostname?: string
          id?: string
          last_seen_at?: string
          status?: string
          vendor_id?: string
          verification_method?: string | null
          verified_at?: string | null
          verified_by_org_id?: string | null
          verified_by_user_id?: string | null
        }
        Relationships: []
      }
      schedule_domain_rules: {
        Row: {
          created_at: string
          id: string
          pattern: string
          status: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pattern: string
          status?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pattern?: string
          status?: string
          vendor_id?: string
        }
        Relationships: []
      }
      schedule_events: {
        Row: {
          created_at: string | null
          end_at: string
          external_uid: string
          id: string
          location: string | null
          org_id: string
          raw: Json
          source_id: string
          start_at: string
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_at: string
          external_uid: string
          id?: string
          location?: string | null
          org_id: string
          raw?: Json
          source_id: string
          start_at: string
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_at?: string
          external_uid?: string
          id?: string
          location?: string | null
          org_id?: string
          raw?: Json
          source_id?: string
          start_at?: string
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "schedule_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_files: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_files_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_sources: {
        Row: {
          connected_user_id: string | null
          created_at: string | null
          created_by: string | null
          google_calendar_id: string | null
          id: string
          last_cancelled: number | null
          last_error: string | null
          last_event_count: number | null
          last_imported: number | null
          last_synced_at: string | null
          last_updated: number | null
          org_id: string
          source_url: string
          status: string
          title: string | null
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          connected_user_id?: string | null
          created_at?: string | null
          created_by?: string | null
          google_calendar_id?: string | null
          id?: string
          last_cancelled?: number | null
          last_error?: string | null
          last_event_count?: number | null
          last_imported?: number | null
          last_synced_at?: string | null
          last_updated?: number | null
          org_id: string
          source_url: string
          status?: string
          title?: string | null
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          connected_user_id?: string | null
          created_at?: string | null
          created_by?: string | null
          google_calendar_id?: string | null
          id?: string
          last_cancelled?: number | null
          last_error?: string | null
          last_event_count?: number | null
          last_imported?: number | null
          last_synced_at?: string | null
          last_updated?: number | null
          org_id?: string
          source_url?: string
          status?: string
          title?: string | null
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          created_at: string
          event_id: string
          id: string
          payload_json: Json | null
          processed_at: string | null
          type: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          payload_json?: Json | null
          processed_at?: string | null
          type: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          payload_json?: Json | null
          processed_at?: string | null
          type?: string
        }
        Relationships: []
      }
      ui_profiles: {
        Row: {
          expires_at: string
          generated_at: string
          id: string
          llm_provider: string | null
          organization_id: string
          profile: Json
          summary_hash: string
          user_id: string
        }
        Insert: {
          expires_at?: string
          generated_at?: string
          id?: string
          llm_provider?: string | null
          organization_id: string
          profile?: Json
          summary_hash: string
          user_id: string
        }
        Update: {
          expires_at?: string
          generated_at?: string
          id?: string
          llm_provider?: string | null
          organization_id?: string
          profile?: Json
          summary_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ui_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          device_class: string | null
          duration_ms: number | null
          event_type: string
          feature: string
          hour_of_day: number | null
          id: string
          organization_id: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_class?: string | null
          duration_ms?: number | null
          event_type: string
          feature: string
          hour_of_day?: number | null
          id?: string
          organization_id?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_class?: string | null
          duration_ms?: number | null
          event_type?: string
          feature?: string
          hour_of_day?: number | null
          id?: string
          organization_id?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_summaries: {
        Row: {
          created_at: string
          device_preference: string | null
          feature: string
          id: string
          last_visited_at: string | null
          organization_id: string
          peak_hour: number | null
          period_end: string
          period_start: string
          total_duration_ms: number
          user_id: string
          visit_count: number
        }
        Insert: {
          created_at?: string
          device_preference?: string | null
          feature: string
          id?: string
          last_visited_at?: string | null
          organization_id: string
          peak_hour?: number | null
          period_end: string
          period_start: string
          total_duration_ms?: number
          user_id: string
          visit_count?: number
        }
        Update: {
          created_at?: string
          device_preference?: string | null
          feature?: string
          id?: string
          last_visited_at?: string | null
          organization_id?: string
          peak_hour?: number | null
          period_end?: string
          period_start?: string
          total_duration_ms?: number
          user_id?: string
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_calendar_connections: {
        Row: {
          access_token_encrypted: string
          created_at: string | null
          google_email: string
          id: string
          last_sync_at: string | null
          refresh_token_encrypted: string
          status: string
          target_calendar_id: string
          token_expires_at: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token_encrypted: string
          created_at?: string | null
          google_email: string
          id?: string
          last_sync_at?: string | null
          refresh_token_encrypted: string
          status?: string
          target_calendar_id?: string
          token_expires_at: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token_encrypted?: string
          created_at?: string | null
          google_email?: string
          id?: string
          last_sync_at?: string | null
          refresh_token_encrypted?: string
          status?: string
          target_calendar_id?: string
          token_expires_at?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_calendar_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_deletion_requests: {
        Row: {
          cancelled_at: string | null
          created_at: string
          id: string
          requested_at: string
          scheduled_deletion_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          id?: string
          requested_at?: string
          scheduled_deletion_at: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          id?: string
          requested_at?: string
          scheduled_deletion_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_enterprise_roles: {
        Row: {
          created_at: string
          enterprise_id: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enterprise_id: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          enterprise_id?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_enterprise_roles_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprise_alumni_counts"
            referencedColumns: ["enterprise_id"]
          },
          {
            foreignKeyName: "user_enterprise_roles_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprises"
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
      enterprise_alumni_counts: {
        Row: {
          enterprise_id: string | null
          enterprise_managed_org_count: number | null
          sub_org_count: number | null
          total_alumni_count: number | null
        }
        Relationships: []
      }
      enterprise_alumni_directory: {
        Row: {
          created_at: string | null
          current_city: string | null
          current_company: string | null
          email: string | null
          enterprise_id: string | null
          first_name: string | null
          graduation_year: number | null
          id: string | null
          industry: string | null
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          major: string | null
          notes: string | null
          organization_id: string | null
          organization_name: string | null
          organization_slug: string | null
          phone_number: string | null
          photo_url: string | null
          position_title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alumni_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprise_alumni_counts"
            referencedColumns: ["enterprise_id"]
          },
          {
            foreignKeyName: "organizations_enterprise_id_fkey"
            columns: ["enterprise_id"]
            isOneToOne: false
            referencedRelation: "enterprises"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      aggregate_usage_events: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: Json
      }
      alumni_bucket_limit: { Args: { p_bucket: string }; Returns: number }
      assert_alumni_quota: { Args: { p_org_id: string }; Returns: undefined }
      can_add_alumni: { Args: { p_org_id: string }; Returns: boolean }
      can_edit_page: {
        Args: { org_id: string; path: string }
        Returns: boolean
      }
      can_enterprise_add_alumni: {
        Args: { p_enterprise_id: string }
        Returns: boolean
      }
      can_view_announcement: {
        Args: {
          announcement_row: Database["public"]["Tables"]["announcements"]["Row"]
        }
        Returns: boolean
      }
      check_analytics_rate_limit: {
        Args: {
          p_max_events?: number
          p_org_id: string
          p_user_id: string
          p_window_interval?: unknown
        }
        Returns: boolean
      }
      check_in_event_attendee: {
        Args: { p_rsvp_id: string; p_undo?: boolean }
        Returns: Json
      }
      complete_enterprise_invite_redemption: {
        Args: { p_organization_id: string; p_token: string }
        Returns: Json
      }
      create_enterprise_invite: {
        Args: {
          p_enterprise_id: string
          p_expires_at?: string
          p_organization_id?: string
          p_role?: string
          p_uses?: number
        }
        Returns: {
          code: string
          created_at: string
          created_by_user_id: string
          enterprise_id: string
          expires_at: string | null
          id: string
          organization_id: string | null
          revoked_at: string | null
          role: string
          token: string
          uses_remaining: number | null
        }
        SetofOptions: {
          from: "*"
          to: "enterprise_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      debug_user_org_access: { Args: { target_org_id?: string }; Returns: Json }
      get_alumni_quota: { Args: { p_org_id: string }; Returns: Json }
      get_dropdown_options: { Args: { p_org_id: string }; Returns: Json }
      get_media_storage_stats: { Args: { p_org_id: string }; Returns: Json }
      get_org_context_by_slug: { Args: { p_slug: string }; Returns: Json }
      get_subscription_status: {
        Args: { p_org_id: string }
        Returns: {
          current_period_end: string
          grace_period_ends_at: string
          status: string
        }[]
      }
      has_active_role: {
        Args: { allowed_roles: string[]; org: string }
        Returns: boolean
      }
      increment_donation_stats: {
        Args: {
          p_amount_delta: number
          p_count_delta: number
          p_last: string
          p_org_id: string
        }
        Returns: undefined
      }
      is_chat_group_creator: { Args: { group_id: string }; Returns: boolean }
      is_chat_group_member: { Args: { group_id: string }; Returns: boolean }
      is_chat_group_moderator: { Args: { group_id: string }; Returns: boolean }
      is_enterprise_admin: { Args: { ent_id: string }; Returns: boolean }
      is_enterprise_member: { Args: { ent_id: string }; Returns: boolean }
      is_enterprise_owner: { Args: { ent_id: string }; Returns: boolean }
      is_org_admin: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      log_analytics_event: {
        Args: {
          p_app_version: string
          p_client_day: string
          p_device_class: string
          p_event_name: Database["public"]["Enums"]["analytics_event_name"]
          p_org_id: string
          p_platform: string
          p_props: Json
          p_route: string
          p_session_id: string
        }
        Returns: boolean
      }
      log_ops_event: {
        Args: {
          p_app_version: string
          p_client_day: string
          p_device_class: string
          p_endpoint_group: string
          p_error_code: string
          p_event_name: Database["public"]["Enums"]["ops_event_name"]
          p_http_status: number
          p_org_id: string
          p_platform: string
          p_retryable: boolean
          p_route: string
          p_session_id: string
        }
        Returns: boolean
      }
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
      purge_analytics_events: { Args: never; Returns: Json }
      purge_expired_usage_events: { Args: never; Returns: Json }
      purge_ops_events: { Args: never; Returns: Json }
      redeem_enterprise_invite: {
        Args: { p_code_or_token: string }
        Returns: Json
      }
      redeem_org_invite: { Args: { p_code: string }; Returns: Json }
      redeem_org_invite_by_token: { Args: { p_token: string }; Returns: Json }
      sync_enterprise_nav_to_org: {
        Args: { p_enterprise_id: string; p_organization_id: string }
        Returns: boolean
      }
      update_error_baselines: { Args: never; Returns: undefined }
      upsert_error_group: {
        Args: {
          p_env: string
          p_fingerprint: string
          p_sample_event: Json
          p_severity: string
          p_title: string
        }
        Returns: string
      }
    }
    Enums: {
      analytics_consent_state: "opted_in" | "opted_out"
      analytics_event_name:
        | "app_open"
        | "route_view"
        | "nav_click"
        | "cta_click"
        | "page_dwell_bucket"
        | "directory_view"
        | "directory_filter_apply"
        | "directory_sort_change"
        | "profile_card_open"
        | "events_view"
        | "event_open"
        | "rsvp_update"
        | "form_open"
        | "form_submit"
        | "file_upload_attempt"
        | "donation_flow_start"
        | "donation_checkout_start"
        | "donation_checkout_result"
        | "chat_thread_open"
        | "chat_message_send"
        | "chat_participants_change"
      chat_group_role: "admin" | "moderator" | "member"
      chat_message_status: "pending" | "approved" | "rejected"
      event_type:
        | "general"
        | "philanthropy"
        | "game"
        | "meeting"
        | "social"
        | "fundraiser"
      media_entity_type: "feed_post" | "discussion_thread" | "job_posting"
      media_status: "uploading" | "pending" | "approved" | "rejected"
      media_upload_status: "pending" | "ready" | "failed" | "orphaned"
      member_status: "active" | "inactive" | "pending"
      membership_status: "active" | "revoked" | "pending"
      ops_event_name:
        | "api_error"
        | "client_error"
        | "auth_fail"
        | "rate_limited"
      user_role: "admin" | "member" | "viewer" | "active_member" | "alumni"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

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

export const Constants = {
  public: {
    Enums: {
      analytics_consent_state: ["opted_in", "opted_out"],
      analytics_event_name: [
        "app_open",
        "route_view",
        "nav_click",
        "cta_click",
        "page_dwell_bucket",
        "directory_view",
        "directory_filter_apply",
        "directory_sort_change",
        "profile_card_open",
        "events_view",
        "event_open",
        "rsvp_update",
        "form_open",
        "form_submit",
        "file_upload_attempt",
        "donation_flow_start",
        "donation_checkout_start",
        "donation_checkout_result",
        "chat_thread_open",
        "chat_message_send",
        "chat_participants_change",
      ],
      chat_group_role: ["admin", "moderator", "member"],
      chat_message_status: ["pending", "approved", "rejected"],
      event_type: [
        "general",
        "philanthropy",
        "game",
        "meeting",
        "social",
        "fundraiser",
      ],
      media_entity_type: ["feed_post", "discussion_thread", "job_posting"],
      media_status: ["uploading", "pending", "approved", "rejected"],
      media_upload_status: ["pending", "ready", "failed", "orphaned"],
      member_status: ["active", "inactive", "pending"],
      membership_status: ["active", "revoked", "pending"],
      ops_event_name: [
        "api_error",
        "client_error",
        "auth_fail",
        "rate_limited",
      ],
      user_role: ["admin", "member", "viewer", "active_member", "alumni"],
    },
  },
} as const

export type AcademicSchedule = Tables<'academic_schedules'>;
export type Alumni = Tables<'alumni'>;
export type Announcement = Tables<'announcements'>;
export type ChatGroup = Tables<'chat_groups'>;
export type ChatGroupMember = Tables<'chat_group_members'>;
export type ChatMessage = Tables<'chat_messages'>;
export type Event = Tables<'events'>;
export type Form = Tables<'forms'>;
export type FormDocument = Tables<'form_documents'>;
export type FormDocumentSubmission = Tables<'form_document_submissions'>;
export type FormSubmission = Tables<'form_submissions'>;
export type Member = Tables<'members'>;
export type NotificationPreference = Tables<'notification_preferences'>;
export type Organization = Tables<'organizations'>;
export type OrganizationDonation = Tables<'organization_donations'>;
export type OrganizationDonationStat = Tables<'organization_donation_stats'>;
export type ScheduleFile = Tables<'schedule_files'>;
export type User = Tables<'users'>;
export type Workout = Tables<'workouts'>;
export type WorkoutLog = Tables<'workout_logs'>;

// Enum type exports
export type EventType = Enums<'event_type'>;
export type ChatMessageStatus = Enums<'chat_message_status'>;
export type MemberStatus = Enums<'member_status'>;
export type MembershipStatus = Enums<'membership_status'>;
export type UserRole = Enums<'user_role'>;

// Additional type aliases for backward compatibility and convenience
export type RsvpStatus = "attending" | "not_attending" | "maybe";
export type AnnouncementAudience = "all" | "members" | "active_members" | "alumni" | "individuals";
export type NotificationAudience = "members" | "alumni" | "both";
export type NotificationChannel = "email" | "sms" | "both";
export type WorkoutStatus = "not_started" | "in_progress" | "completed";
export type AlumniBucket = "none" | "0-250" | "251-500" | "501-1000" | "1001-2500" | "2500-5000" | "5000+";
export type SubscriptionInterval = "month" | "year";
export type EmbedType = "link" | "iframe";
export type OccurrenceType = "single" | "daily" | "weekly" | "monthly";

export type FormFieldType = "text" | "textarea" | "email" | "phone" | "date" | "select" | "checkbox" | "radio";

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: (string | FormFieldOption)[];
}

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
