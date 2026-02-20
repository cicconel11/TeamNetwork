"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Badge, Avatar, Button } from "@/components/ui";

interface Alumni {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  first_name: string;
  last_name: string;
  email: string | null;
  graduation_year: number | null;
  major: string | null;
  industry: string | null;
  current_company: string | null;
  current_city: string | null;
  position_title: string | null;
  job_title: string | null;
  photo_url: string | null;
  linkedin_url: string | null;
  phone_number: string | null;
  notes: string | null;
}

interface AlumniContactDrawerProps {
  alumni: Alumni | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AlumniContactDrawer({ alumni, isOpen, onClose }: AlumniContactDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.addEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen || !alumni) return null;

  const position = alumni.position_title || alumni.job_title;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div
        ref={drawerRef}
        className="absolute right-0 top-0 h-full w-full max-w-md bg-card border-l border-border shadow-xl animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Alumni Profile</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto h-[calc(100%-80px)]">
          {/* Profile Header */}
          <div className="flex items-center gap-4 mb-6">
            <Avatar
              src={alumni.photo_url}
              name={`${alumni.first_name} ${alumni.last_name}`}
              size="xl"
            />
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-semibold text-foreground">
                {alumni.first_name} {alumni.last_name}
              </h3>
              {position && (
                <p className="text-sm text-muted-foreground">
                  {position}
                  {alumni.current_company && ` at ${alumni.current_company}`}
                </p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="muted">{alumni.organization_name}</Badge>
                {alumni.graduation_year && (
                  <Badge variant="primary">Class of {alumni.graduation_year}</Badge>
                )}
              </div>
            </div>
          </div>

          {/* Contact Actions */}
          <div className="flex gap-2 mb-6">
            {alumni.email && (
              <a
                href={`mailto:${alumni.email}`}
                className="flex-1"
              >
                <Button variant="secondary" className="w-full">
                  <MailIcon className="h-4 w-4" />
                  Email
                </Button>
              </a>
            )}
            {alumni.linkedin_url && (
              <a
                href={alumni.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1"
              >
                <Button variant="secondary" className="w-full">
                  <LinkedInIcon className="h-4 w-4" />
                  LinkedIn
                </Button>
              </a>
            )}
            {alumni.phone_number && (
              <a href={`tel:${alumni.phone_number}`} className="flex-1">
                <Button variant="secondary" className="w-full">
                  <PhoneIcon className="h-4 w-4" />
                  Call
                </Button>
              </a>
            )}
          </div>

          {/* Details Sections */}
          <div className="space-y-6">
            {/* Contact Information */}
            <section>
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Contact Information
              </h4>
              <div className="space-y-3">
                {alumni.email && (
                  <DetailRow label="Email" value={alumni.email} />
                )}
                {alumni.phone_number && (
                  <DetailRow label="Phone" value={alumni.phone_number} />
                )}
                {alumni.linkedin_url && (
                  <DetailRow
                    label="LinkedIn"
                    value={
                      <a
                        href={alumni.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        View Profile
                      </a>
                    }
                  />
                )}
                {alumni.current_city && (
                  <DetailRow label="Location" value={alumni.current_city} />
                )}
              </div>
            </section>

            {/* Career Information */}
            {(alumni.current_company || position || alumni.industry) && (
              <section>
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Career
                </h4>
                <div className="space-y-3">
                  {position && <DetailRow label="Position" value={position} />}
                  {alumni.current_company && (
                    <DetailRow label="Company" value={alumni.current_company} />
                  )}
                  {alumni.industry && (
                    <DetailRow label="Industry" value={alumni.industry} />
                  )}
                </div>
              </section>
            )}

            {/* Education */}
            {(alumni.graduation_year || alumni.major) && (
              <section>
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Education
                </h4>
                <div className="space-y-3">
                  {alumni.graduation_year && (
                    <DetailRow label="Graduation Year" value={alumni.graduation_year.toString()} />
                  )}
                  {alumni.major && <DetailRow label="Major" value={alumni.major} />}
                </div>
              </section>
            )}

            {/* Notes */}
            {alumni.notes && (
              <section>
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Notes
                </h4>
                <p className="text-sm text-foreground whitespace-pre-wrap">{alumni.notes}</p>
              </section>
            )}
          </div>

          {/* View in Organization Link */}
          <div className="mt-8 pt-6 border-t border-border">
            <Link href={`/${alumni.organization_slug}/alumni/${alumni.id}`}>
              <Button variant="ghost" className="w-full">
                View Full Profile in {alumni.organization_name}
                <ArrowRightIcon className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-start">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground text-right max-w-[200px]">{value}</span>
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
      />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
      />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}
