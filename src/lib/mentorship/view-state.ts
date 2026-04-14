export type MentorshipTab = 'activity' | 'directory';

const VALID_TABS = ['activity', 'directory'] as const;

// Type guard — avoids unsafe `as` cast
function isMentorshipTab(raw: string): raw is MentorshipTab {
  return (VALID_TABS as readonly string[]).includes(raw);
}

export function parseMentorshipTab(raw: string | undefined): MentorshipTab {
  // Backwards compat: old "overview", "tasks", "meetings" all map to "activity"
  if (!raw || !isMentorshipTab(raw)) return 'activity';
  return raw;
}
