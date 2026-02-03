"use client";

import { useState } from "react";
import { Card, Badge, Avatar, EmptyState, Button } from "@/components/ui";

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

interface EnterpriseAlumniTableProps {
  alumni: Alumni[];
  onViewProfile: (alum: Alumni) => void;
  selectedIds?: Set<string>;
  onSelectChange?: (ids: Set<string>) => void;
}

type SortField = "name" | "year" | "company" | "organization";
type SortDirection = "asc" | "desc";

export function EnterpriseAlumniTable({
  alumni,
  onViewProfile,
  selectedIds = new Set(),
  onSelectChange,
}: EnterpriseAlumniTableProps) {
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortedAlumni = [...alumni].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case "name":
        comparison = `${a.first_name} ${a.last_name}`.localeCompare(
          `${b.first_name} ${b.last_name}`
        );
        break;
      case "year":
        comparison = (a.graduation_year || 0) - (b.graduation_year || 0);
        break;
      case "company":
        comparison = (a.current_company || "").localeCompare(b.current_company || "");
        break;
      case "organization":
        comparison = a.organization_name.localeCompare(b.organization_name);
        break;
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  const toggleSelectAll = () => {
    if (!onSelectChange) return;
    if (selectedIds.size === alumni.length) {
      onSelectChange(new Set());
    } else {
      onSelectChange(new Set(alumni.map((a) => a.id)));
    }
  };

  const toggleSelect = (id: string) => {
    if (!onSelectChange) return;
    const newIds = new Set(selectedIds);
    if (newIds.has(id)) {
      newIds.delete(id);
    } else {
      newIds.add(id);
    }
    onSelectChange(newIds);
  };

  if (alumni.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<GraduationCapIcon className="h-12 w-12" />}
          title="No alumni found"
          description="Try adjusting your filters or add alumni to your sub-organizations."
        />
      </Card>
    );
  }

  const SortHeader = ({
    field,
    children,
  }: {
    field: SortField;
    children: React.ReactNode;
  }) => (
    <th
      className="text-left py-3 px-4 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-purple-600 dark:text-purple-400">
            {sortDirection === "asc" ? "↑" : "↓"}
          </span>
        )}
      </div>
    </th>
  );

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {onSelectChange && (
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === alumni.length && alumni.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-border"
                  />
                </th>
              )}
              <SortHeader field="name">Name</SortHeader>
              <SortHeader field="organization">Organization</SortHeader>
              <SortHeader field="year">Year</SortHeader>
              <SortHeader field="company">Company</SortHeader>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Position
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Location
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Contact
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedAlumni.map((alum) => (
              <tr
                key={alum.id}
                className="border-b border-border last:border-0 hover:bg-muted/50 group cursor-pointer"
                onClick={() => onViewProfile(alum)}
              >
                {onSelectChange && (
                  <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(alum.id)}
                      onChange={() => toggleSelect(alum.id)}
                      className="rounded border-border"
                    />
                  </td>
                )}
                <td className="py-4 px-4">
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={alum.photo_url}
                      name={`${alum.first_name} ${alum.last_name}`}
                      size="sm"
                    />
                    <span className="font-medium text-foreground">
                      {alum.first_name} {alum.last_name}
                    </span>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <Badge variant="muted" className="text-xs">
                    {alum.organization_name}
                  </Badge>
                </td>
                <td className="py-4 px-4">
                  {alum.graduation_year && (
                    <span className="text-sm text-foreground">
                      {alum.graduation_year}
                    </span>
                  )}
                </td>
                <td className="py-4 px-4">
                  <span className="text-sm text-foreground truncate max-w-[150px] block">
                    {alum.current_company || "-"}
                  </span>
                </td>
                <td className="py-4 px-4">
                  <span className="text-sm text-foreground truncate max-w-[150px] block">
                    {alum.position_title || alum.job_title || "-"}
                  </span>
                </td>
                <td className="py-4 px-4">
                  <span className="text-sm text-muted-foreground truncate max-w-[120px] block">
                    {alum.current_city || "-"}
                  </span>
                </td>
                <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {alum.email && (
                      <a
                        href={`mailto:${alum.email}`}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                        title={alum.email}
                      >
                        <MailIcon className="h-4 w-4" />
                      </a>
                    )}
                    {alum.linkedin_url && (
                      <a
                        href={alum.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="LinkedIn"
                      >
                        <LinkedInIcon className="h-4 w-4" />
                      </a>
                    )}
                    {alum.phone_number && (
                      <a
                        href={`tel:${alum.phone_number}`}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                        title={alum.phone_number}
                      >
                        <PhoneIcon className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function GraduationCapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
      />
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
