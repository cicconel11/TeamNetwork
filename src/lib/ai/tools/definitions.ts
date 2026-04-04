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
            enum: ["general", "philanthropy", "game", "meeting", "social", "fundraiser"],
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
                  enum: ["general", "philanthropy", "game", "meeting", "social", "fundraiser"],
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
  TOOL_BY_NAME.list_alumni,
  TOOL_BY_NAME.list_donations,
  TOOL_BY_NAME.list_parents,
  TOOL_BY_NAME.list_philanthropy_events,
  TOOL_BY_NAME.prepare_job_posting,
  TOOL_BY_NAME.prepare_discussion_thread,
  TOOL_BY_NAME.prepare_event,
  TOOL_BY_NAME.prepare_events_batch,
  TOOL_BY_NAME.scrape_schedule_website,
  TOOL_BY_NAME.extract_schedule_pdf,
  TOOL_BY_NAME.get_org_stats,
  TOOL_BY_NAME.suggest_connections,
  TOOL_BY_NAME.find_navigation_targets,
] as const satisfies readonly OpenAI.Chat.ChatCompletionTool[];

// Derived from AI_TOOLS — no manual union to maintain
export type ToolName = (typeof AI_TOOLS)[number]["function"]["name"];

export const TOOL_NAMES: ReadonlySet<string> = new Set<ToolName>(
  AI_TOOLS.map((t) => t.function.name)
);

export const AI_TOOL_MAP = TOOL_BY_NAME;
