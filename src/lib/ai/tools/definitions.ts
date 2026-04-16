import type OpenAI from "openai";

export interface ListMembersArgs {
  limit?: number;
}

export interface ListEventsArgs {
  limit?: number;
  upcoming?: boolean;
}

export interface ListAnnouncementsArgs {
  limit?: number;
  pinned_only?: boolean;
}

export interface ListDiscussionsArgs {
  limit?: number;
}

export interface ListJobPostingsArgs {
  limit?: number;
}

export interface PrepareDiscussionThreadArgs {
  title?: string;
  body?: string;
  mediaIds?: string[];
}

export interface PrepareAnnouncementArgs {
  title?: string;
  body?: string;
  is_pinned?: boolean;
  audience?: "all" | "members" | "active_members" | "alumni" | "individuals";
  send_notification?: boolean;
  audience_user_ids?: string[];
}

export interface PrepareDiscussionReplyArgs {
  discussion_thread_id?: string;
  thread_title?: string;
  body?: string;
}

export interface PrepareChatMessageArgs {
  recipient_member_id?: string;
  person_query?: string;
  body?: string;
}

export interface ListChatGroupsArgs {
  limit?: number;
}

export interface PrepareGroupMessageArgs {
  chat_group_id?: string;
  group_name_query?: string;
  body?: string;
}

export interface PrepareEventArgs {
  title?: string;
  description?: string;
  start_date?: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  location?: string;
  event_type?: string;
  is_philanthropy?: boolean;
}

export interface PrepareEventsBatchArgs {
  events: PrepareEventArgs[];
}

export interface ScrapeScheduleWebsiteArgs {
  url: string;
}

export type ExtractSchedulePdfArgs = Record<string, never>;

export type GetOrgStatsArgs = Record<string, never>;
export type GetEnterpriseStatsArgs = Record<string, never>;
export type GetEnterpriseQuotaArgs = Record<string, never>;
export type ListManagedOrgsArgs = Record<string, never>;

export interface SuggestConnectionsArgs {
  person_type?: "member" | "alumni";
  person_id?: string;
  person_query?: string;
  limit?: number;
}

export interface ListAlumniArgs {
  limit?: number;
  graduation_year?: number;
  industry?: string;
  company?: string;
  city?: string;
}

export interface ListDonationsArgs {
  limit?: number;
  status?: "succeeded" | "failed" | "pending";
  purpose?: string;
}

export interface ListParentsArgs {
  limit?: number;
  relationship?: string;
}

export interface ListPhilanthropyEventsArgs {
  limit?: number;
  upcoming?: boolean;
}

export interface FindNavigationTargetsArgs {
  query: string;
  limit?: number;
}

export interface ListEnterpriseAlumniArgs {
  org?: string;
  graduation_year?: number;
  industry?: string;
  company?: string;
  city?: string;
  position?: string;
  has_email?: boolean;
  has_phone?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListEnterpriseAuditEventsArgs {
  organization_id?: string;
  limit?: number;
}

export interface PrepareEnterpriseInviteArgs {
  role?: "admin" | "active_member" | "alumni";
  organization_id?: string;
  organization_query?: string;
  uses_remaining?: number;
  expires_at?: string;
}

export interface RevokeEnterpriseInviteArgs {
  invite_id?: string;
  invite_code?: string;
}

const TOOL_BY_NAME = {
  list_members: {
    type: "function" as const,
    function: {
      name: "list_members" as const,
      description:
        "List active organization members. Returns the best available human name, email, role, and added date. Prefer real names over raw emails. If a record has no trustworthy human name, treat it as an email-only member or admin account instead of using placeholder labels. Only returns active members — alumni and parents are tracked separately.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 50,
            description: "Max results to return (default 20)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_events: {
    type: "function" as const,
    function: {
      name: "list_events" as const,
      description:
        "List organization events. Returns title, date, location, and description. Use for questions about upcoming or past events.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max results to return (default 10)",
          },
          upcoming: {
            type: "boolean" as const,
            description:
              "If true, only future events. If false, only past events. Default true.",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_announcements: {
    type: "function" as const,
    function: {
      name: "list_announcements" as const,
      description:
        "List recent organization announcements. Returns title, publish date, audience, pinned status, and a short body preview. Use for questions about recent news, updates, reminders, or announcements.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max announcements to return (default 10)",
          },
          pinned_only: {
            type: "boolean" as const,
            description: "If true, only return pinned announcements. Default false.",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_discussions: {
    type: "function" as const,
    function: {
      name: "list_discussions" as const,
      description:
        "List recent organization discussion threads. Returns title, author, post date, comment count, and a short body preview. Use for questions about community discussions, forum posts, or conversation threads.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max discussions to return (default 10)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_job_postings: {
    type: "function" as const,
    function: {
      name: "list_job_postings" as const,
      description:
        "List active organization job postings. Returns title, company, location, type, and a short description preview. Use for questions about job opportunities, career openings, or hiring within the network.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max job postings to return (default 10)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_announcement: {
    type: "function" as const,
    function: {
      name: "prepare_announcement" as const,
      description:
        "Prepare a new organization announcement draft for the assistant. Use this when the user wants to create, post, or publish an announcement. It validates the draft, identifies missing required fields, and creates a pending confirmation action when the draft is ready.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          body: { type: "string" as const },
          is_pinned: { type: "boolean" as const },
          audience: {
            type: "string" as const,
            enum: ["all", "members", "active_members", "alumni", "individuals"],
          },
          send_notification: {
            type: "boolean" as const,
            description:
              "If true, also email the announcement audience after it is published. Default false unless the user explicitly asks to notify people.",
          },
          audience_user_ids: {
            type: "array" as const,
            items: { type: "string" as const },
            description:
              "Required only when audience is individuals. Use explicit user ids for targeted announcements.",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_job_posting: {
    type: "function" as const,
    function: {
      name: "prepare_job_posting" as const,
      description:
        "Prepare a new job posting draft for the assistant. Use this when the user wants you to create or post a job. It validates the draft, identifies missing required fields, optionally enriches the draft from a provided application URL, and creates a pending confirmation action when the draft is ready.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          company: { type: "string" as const },
          location: { type: "string" as const },
          location_type: {
            type: "string" as const,
            enum: ["remote", "hybrid", "onsite"],
          },
          description: { type: "string" as const },
          application_url: {
            type: "string" as const,
            description: "HTTPS application URL for the job posting.",
          },
          contact_email: {
            type: "string" as const,
            description: "Contact email if no application URL is available.",
          },
          industry: { type: "string" as const },
          experience_level: {
            type: "string" as const,
            enum: ["entry", "mid", "senior", "lead", "executive"],
          },
          expires_at: {
            type: "string" as const,
            description: "Optional ISO timestamp for when the job should expire.",
          },
          mediaIds: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_discussion_thread: {
    type: "function" as const,
    function: {
      name: "prepare_discussion_thread" as const,
      description:
        "Prepare a new discussion thread draft for the assistant. Use this when the user wants you to create or post a discussion thread. It validates the draft, identifies missing required fields, and creates a pending confirmation action when the draft is ready.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          body: { type: "string" as const },
          mediaIds: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_discussion_reply: {
    type: "function" as const,
    function: {
      name: "prepare_discussion_reply" as const,
      description:
        "Prepare a reply to an existing discussion thread. Use this when the user wants to respond to a discussion thread that is already open. If the user names the thread but does not know its UUID, pass thread_title and let the server resolve it. It validates the draft, identifies missing required fields, and creates a pending confirmation action when the reply is ready.",
      parameters: {
        type: "object" as const,
        properties: {
          discussion_thread_id: {
            type: "string" as const,
            description: "UUID of the discussion thread that should receive the reply.",
          },
          thread_title: {
            type: "string" as const,
            description:
              "Optional thread title. Use this when the user names the thread but does not provide its UUID.",
          },
          body: { type: "string" as const },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_chat_message: {
    type: "function" as const,
    function: {
      name: "prepare_chat_message" as const,
      description:
        "Prepare an in-app chat message to a specific organization member. Use this when the user wants you to message, DM, or send a direct chat message to someone. It resolves the recipient, validates the draft body, and creates a pending confirmation action when the message is ready.",
      parameters: {
        type: "object" as const,
        properties: {
          recipient_member_id: {
            type: "string" as const,
            description:
              "UUID of the member who should receive the chat message. Use this when the current member page already identifies the person.",
          },
          person_query: {
            type: "string" as const,
            description:
              "Recipient name or email when the user says who to message in natural language.",
          },
          body: { type: "string" as const },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_chat_groups: {
    type: "function" as const,
    function: {
      name: "list_chat_groups" as const,
      description:
        "List chat groups the current user belongs to. Returns group name, description, user role, and last activity. Use for questions about available chat groups or when the user wants to see which groups they can message.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 50,
            description: "Max groups to return (default 25)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_group_message: {
    type: "function" as const,
    function: {
      name: "prepare_group_message" as const,
      description:
        "Prepare a message to a chat group. Use this when the user wants to send a message to a group chat channel rather than a direct message to an individual. It resolves the group, validates the draft body, and creates a pending confirmation action when the message is ready. Messages may require moderator approval depending on group settings.",
      parameters: {
        type: "object" as const,
        properties: {
          chat_group_id: {
            type: "string" as const,
            description:
              "UUID of the chat group to message. Use this when the group ID is already known.",
          },
          group_name_query: {
            type: "string" as const,
            description:
              "Group name when the user says which group to message in natural language.",
          },
          body: { type: "string" as const },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_event: {
    type: "function" as const,
    function: {
      name: "prepare_event" as const,
      description:
        "Prepare a new calendar event draft for the assistant. Use this when the user wants you to create, add, or schedule an event. It validates the draft, identifies missing required fields, and creates a pending confirmation action when the draft is ready. Only supports single (non-recurring) events.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          description: { type: "string" as const },
          start_date: {
            type: "string" as const,
            description: "Event date in YYYY-MM-DD format",
          },
          start_time: {
            type: "string" as const,
            description: "Event start time in HH:MM 24-hour format",
          },
          end_date: {
            type: "string" as const,
            description: "Event end date in YYYY-MM-DD format (optional)",
          },
          end_time: {
            type: "string" as const,
            description: "Event end time in HH:MM 24-hour format (optional)",
          },
          location: { type: "string" as const },
          event_type: {
            type: "string" as const,
            enum: ["general", "philanthropy", "game", "practice", "meeting", "social", "workout", "fundraiser", "class"],
          },
          is_philanthropy: { type: "boolean" as const },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_events_batch: {
    type: "function" as const,
    function: {
      name: "prepare_events_batch" as const,
      description:
        "Prepare multiple calendar event drafts at once. Use this when the user asks to create, add, or schedule 2 or more events in a single message. Each event is validated individually and creates its own confirmation action. Only supports single (non-recurring) events.",
      parameters: {
        type: "object" as const,
        properties: {
          events: {
            type: "array" as const,
            minItems: 1,
            maxItems: 10,
            description: "Array of event drafts to prepare",
            items: {
              type: "object" as const,
              properties: {
                title: { type: "string" as const },
                description: { type: "string" as const },
                start_date: {
                  type: "string" as const,
                  description: "Event date in YYYY-MM-DD format",
                },
                start_time: {
                  type: "string" as const,
                  description: "Event start time in HH:MM 24-hour format",
                },
                end_date: {
                  type: "string" as const,
                  description: "Event end date in YYYY-MM-DD format (optional)",
                },
                end_time: {
                  type: "string" as const,
                  description: "Event end time in HH:MM 24-hour format (optional)",
                },
                location: { type: "string" as const },
                event_type: {
                  type: "string" as const,
                  enum: ["general", "philanthropy", "game", "practice", "meeting", "social", "workout", "fundraiser", "class"],
                },
                is_philanthropy: { type: "boolean" as const },
              },
              additionalProperties: false as const,
            },
          },
        },
        required: ["events"] as const,
        additionalProperties: false as const,
      },
    },
  },
  scrape_schedule_website: {
    type: "function" as const,
    function: {
      name: "scrape_schedule_website" as const,
      description:
        "Fetch a team or organization website page over HTTPS and extract schedule or calendar events into pending event confirmations.",
      parameters: {
        type: "object" as const,
        properties: {
          url: {
            type: "string" as const,
            description: "HTTPS URL of the website page containing schedule or calendar information.",
          },
        },
        required: ["url"] as const,
        additionalProperties: false as const,
      },
    },
  },
  extract_schedule_pdf: {
    type: "function" as const,
    function: {
      name: "extract_schedule_pdf" as const,
      description:
        "Read the uploaded schedule file from the current chat request and extract calendar events into pending event confirmations.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  get_org_stats: {
    type: "function" as const,
    function: {
      name: "get_org_stats" as const,
      description:
        "Get organization statistics: active member count, alumni count, parent count, upcoming event count, and donation totals. Use for overview or dashboard style questions.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  get_enterprise_stats: {
    type: "function" as const,
    function: {
      name: "get_enterprise_stats" as const,
      description:
        "Get enterprise-wide alumni statistics across all managed organizations. Returns total alumni, per-organization counts, top industries, and filter options. Use for questions about totals across orgs or enterprise alumni analytics.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  get_enterprise_quota: {
    type: "function" as const,
    function: {
      name: "get_enterprise_quota" as const,
      description:
        "Get enterprise quota usage: alumni capacity used and remaining, managed organization counts, and free sub-org slots remaining. Use for quota, billing, capacity, or seat questions.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  get_enterprise_org_capacity: {
    type: "function" as const,
    function: {
      name: "get_enterprise_org_capacity" as const,
      description:
        "Get enterprise managed-organization capacity details available to all enterprise roles. Returns total managed orgs, enterprise-managed org seats in use, and free sub-org slots remaining.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  suggest_connections: {
    type: "function" as const,
    function: {
      name: "suggest_connections" as const,
      description:
        "Suggest same-organization members or alumni that a person should reach out to. Use this for introductions, alumni matching, networking, or outreach questions like who someone should meet next. Prefer calling this tool directly for person-name connection questions. It can either resolve a person by query string or accept an explicit person_type plus person_id. Returns a chat-ready payload with deterministic suggestions and normalized reasons such as shared company, shared industry, shared role family, shared city, and graduation proximity.",
      parameters: {
        type: "object" as const,
        properties: {
          person_type: {
            type: "string" as const,
            enum: ["member", "alumni"],
            description: "Whether the source person is a member or an alumni record.",
          },
          person_id: {
            type: "string" as const,
            description: "UUID of the source member or alumni record.",
          },
          person_query: {
            type: "string" as const,
            description:
              "Name or email of the source person when the user asked about connections in natural language.",
          },
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max ranked suggestions to return (default 10)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_alumni: {
    type: "function" as const,
    function: {
      name: "list_alumni" as const,
      description:
        "List alumni. Returns name, graduation year, company, industry, city, title. Use for alumni directory questions.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max results to return (default 10)",
          },
          graduation_year: {
            type: "integer" as const,
            minimum: 1900,
            maximum: 2100,
            description: "Filter by graduation year",
          },
          industry: {
            type: "string" as const,
            description: "Filter by industry (partial match)",
          },
          company: {
            type: "string" as const,
            description: "Filter by company name (partial match)",
          },
          city: {
            type: "string" as const,
            description: "Filter by city (partial match)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_enterprise_alumni: {
    type: "function" as const,
    function: {
      name: "list_enterprise_alumni" as const,
      description:
        "List alumni across all organizations in the current enterprise. Returns the alumni name plus organization, graduation year, company, industry, city, title, and contact fields when available. Use for enterprise alumni directory and cross-org filtering questions.",
      parameters: {
        type: "object" as const,
        properties: {
          org: {
            type: "string" as const,
            description: "Optional managed organization id, slug, or name filter.",
          },
          graduation_year: {
            type: "integer" as const,
            minimum: 1900,
            maximum: 2100,
            description: "Filter by graduation year",
          },
          industry: {
            type: "string" as const,
            description: "Filter by industry (partial match)",
          },
          company: {
            type: "string" as const,
            description: "Filter by company name (partial match)",
          },
          city: {
            type: "string" as const,
            description: "Filter by city (partial match)",
          },
          position: {
            type: "string" as const,
            description: "Filter by title or position (partial match)",
          },
          has_email: {
            type: "boolean" as const,
            description: "If true, only return alumni with email. If false, only alumni without email.",
          },
          has_phone: {
            type: "boolean" as const,
            description: "If true, only return alumni with phone. If false, only alumni without phone.",
          },
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 100,
            description: "Max results to return (default 25)",
          },
          offset: {
            type: "integer" as const,
            minimum: 0,
            maximum: 5000,
            description: "Pagination offset (default 0)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_donations: {
    type: "function" as const,
    function: {
      name: "list_donations" as const,
      description:
        "List donation records. Returns donor, amount, status, purpose, date. Anonymous donations show redacted info.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max results to return (default 10)",
          },
          status: {
            type: "string" as const,
            enum: ["succeeded", "failed", "pending"],
            description: "Filter by donation status",
          },
          purpose: {
            type: "string" as const,
            description: "Filter by donation purpose",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_parents: {
    type: "function" as const,
    function: {
      name: "list_parents" as const,
      description:
        "List parents in the parent directory. Returns name, relationship, student name, email, phone.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max results to return (default 10)",
          },
          relationship: {
            type: "string" as const,
            description: "Filter by relationship type (partial match)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_philanthropy_events: {
    type: "function" as const,
    function: {
      name: "list_philanthropy_events" as const,
      description:
        "List philanthropy/service/volunteer events. Returns title, date, location, description.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max results to return (default 10)",
          },
          upcoming: {
            type: "boolean" as const,
            description:
              "If true, only future events. If false, only past events. Default true.",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  list_managed_orgs: {
    type: "function" as const,
    function: {
      name: "list_managed_orgs" as const,
      description:
        "List the organizations managed by the current enterprise. Returns organization id, name, slug, relationship type, and adoption timestamp. Use for managed-org and sub-org questions.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  list_enterprise_audit_events: {
    type: "function" as const,
    function: {
      name: "list_enterprise_audit_events" as const,
      description:
        "List recent enterprise audit events and adoption requests. Returns who performed each action, what was targeted, when, and the current status. Use for questions like who added an org, when was an org adopted, or show the adoption history.",
      parameters: {
        type: "object" as const,
        properties: {
          organization_id: {
            type: "string" as const,
            description: "Optional managed organization id to restrict audit events.",
          },
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 100,
            description: "Max events to return (default 25)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  prepare_enterprise_invite: {
    type: "function" as const,
    function: {
      name: "prepare_enterprise_invite" as const,
      description:
        "Prepare a new enterprise invite draft for admins, active members, or alumni. Use this when the user wants to invite someone to their enterprise or a managed organization. Validates the draft and creates a pending confirmation action when ready.",
      parameters: {
        type: "object" as const,
        properties: {
          role: {
            type: "string" as const,
            enum: ["admin", "active_member", "alumni"],
            description:
              "The role the invited user will receive. Admins and alumni can be enterprise-wide; active_member invites require an organization_id.",
          },
          organization_id: {
            type: "string" as const,
            description: "Optional managed organization id to scope the invite to a single org.",
          },
          organization_query: {
            type: "string" as const,
            description:
              "Optional managed organization name or slug when the user names the org instead of providing an id.",
          },
          uses_remaining: {
            type: "integer" as const,
            minimum: 1,
            description: "Maximum number of times this invite can be used.",
          },
          expires_at: {
            type: "string" as const,
            description: "Optional ISO timestamp for when the invite expires.",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  revoke_enterprise_invite: {
    type: "function" as const,
    function: {
      name: "revoke_enterprise_invite" as const,
      description:
        "Revoke an existing enterprise invite. Provide either the invite id (UUID) or the invite code. Validates the invite and creates a pending confirmation action when ready.",
      parameters: {
        type: "object" as const,
        properties: {
          invite_id: {
            type: "string" as const,
            description: "UUID of the invite to revoke.",
          },
          invite_code: {
            type: "string" as const,
            description: "Invite code string when the UUID is not known.",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  find_navigation_targets: {
    type: "function" as const,
    function: {
      name: "find_navigation_targets" as const,
      description:
        "Find the best in-app pages for opening, managing, or creating organization resources. Use for requests like open announcements, take me to members, where do I edit navigation, or where can I create an event.",
      parameters: {
        type: "object" as const,
        properties: {
          query: {
            type: "string" as const,
            description:
              "The page, feature, or action the user wants, such as announcements, create event, member settings, or donations.",
          },
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 10,
            description: "Max navigation targets to return (default 5)",
          },
        },
        required: ["query"] as const,
        additionalProperties: false as const,
      },
    },
  },
} as const;

export const AI_TOOLS = [
  TOOL_BY_NAME.list_members,
  TOOL_BY_NAME.list_events,
  TOOL_BY_NAME.list_announcements,
  TOOL_BY_NAME.list_discussions,
  TOOL_BY_NAME.list_job_postings,
  TOOL_BY_NAME.list_chat_groups,
  TOOL_BY_NAME.list_alumni,
  TOOL_BY_NAME.list_enterprise_alumni,
  TOOL_BY_NAME.list_donations,
  TOOL_BY_NAME.list_parents,
  TOOL_BY_NAME.list_philanthropy_events,
  TOOL_BY_NAME.list_managed_orgs,
  TOOL_BY_NAME.list_enterprise_audit_events,
  TOOL_BY_NAME.prepare_enterprise_invite,
  TOOL_BY_NAME.revoke_enterprise_invite,
  TOOL_BY_NAME.prepare_announcement,
  TOOL_BY_NAME.prepare_job_posting,
  TOOL_BY_NAME.prepare_chat_message,
  TOOL_BY_NAME.prepare_group_message,
  TOOL_BY_NAME.prepare_discussion_reply,
  TOOL_BY_NAME.prepare_discussion_thread,
  TOOL_BY_NAME.prepare_event,
  TOOL_BY_NAME.prepare_events_batch,
  TOOL_BY_NAME.scrape_schedule_website,
  TOOL_BY_NAME.extract_schedule_pdf,
  TOOL_BY_NAME.get_org_stats,
  TOOL_BY_NAME.get_enterprise_stats,
  TOOL_BY_NAME.get_enterprise_quota,
  TOOL_BY_NAME.get_enterprise_org_capacity,
  TOOL_BY_NAME.suggest_connections,
  TOOL_BY_NAME.find_navigation_targets,
] as const satisfies readonly OpenAI.Chat.ChatCompletionTool[];

// Derived from AI_TOOLS — no manual union to maintain
export type ToolName = (typeof AI_TOOLS)[number]["function"]["name"];

export const TOOL_NAMES: ReadonlySet<string> = new Set<ToolName>(
  AI_TOOLS.map((t) => t.function.name)
);

export const AI_TOOL_MAP = TOOL_BY_NAME;
