export type MentorshipTab = 'overview' | 'tasks' | 'meetings' | 'directory';

const VALID_TABS = ['overview', 'tasks', 'meetings', 'directory'] as const;

// Type guard — avoids unsafe `as` cast
function isMentorshipTab(raw: string): raw is MentorshipTab {
  return (VALID_TABS as readonly string[]).includes(raw);
}

export function parseMentorshipTab(raw: string | undefined): MentorshipTab {
  if (!raw || !isMentorshipTab(raw)) return 'overview';
  return raw;
}
