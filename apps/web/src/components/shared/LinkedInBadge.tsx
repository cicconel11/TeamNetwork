import { LinkedInIcon } from "./LinkedInIcon";

interface LinkedInBadgeProps {
  linkedinUrl: string | null;
  className?: string;
}

export function LinkedInBadge({ linkedinUrl, className = "" }: LinkedInBadgeProps) {
  if (!linkedinUrl) return null;

  return (
    <a
      href={linkedinUrl}
      target="_blank"
      rel="noreferrer noopener"
      className={`inline-flex items-center justify-center w-5 h-5 rounded bg-[#0A66C2] text-white hover:bg-[#004182] transition-colors ${className}`}
      aria-label="LinkedIn profile"
    >
      <LinkedInIcon className="w-3 h-3" />
    </a>
  );
}
