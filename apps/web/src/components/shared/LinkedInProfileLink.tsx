import { LinkedInIcon } from "./LinkedInIcon";

interface LinkedInProfileLinkProps {
  linkedinUrl: string | null;
}

export function LinkedInProfileLink({ linkedinUrl }: LinkedInProfileLinkProps) {
  if (!linkedinUrl) return "—";

  return (
    <a
      href={linkedinUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 text-[#0A66C2] hover:text-[#004182] transition-colors font-medium"
    >
      <LinkedInIcon className="w-4 h-4" />
      View Profile
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  );
}
