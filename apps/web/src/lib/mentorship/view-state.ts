export type MentorshipTab = 'activity' | 'directory' | 'proposals' | 'matches';

const VALID_TABS = ['activity', 'directory', 'proposals', 'matches'] as const;

function isMentorshipTab(raw: string): raw is MentorshipTab {
  return (VALID_TABS as readonly string[]).includes(raw);
}

export function parseMentorshipTab(raw: string | undefined): MentorshipTab {
  if (!raw || !isMentorshipTab(raw)) return 'activity';
  return raw;
}
