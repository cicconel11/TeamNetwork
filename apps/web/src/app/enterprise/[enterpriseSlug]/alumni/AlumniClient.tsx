"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { AlumniStatsHeader } from "@/components/enterprise/AlumniStatsHeader";
import { EnterpriseAlumniFilters } from "@/components/enterprise/EnterpriseAlumniFilters";
import { EnterpriseAlumniTable } from "@/components/enterprise/EnterpriseAlumniTable";
import { AlumniContactDrawer } from "@/components/enterprise/AlumniContactDrawer";
import { BulkExportButton } from "@/components/enterprise/BulkExportButton";

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

interface Organization {
  id: string;
  name: string;
}

interface AlumniStats {
  totalCount: number;
  orgStats: { name: string; count: number }[];
  topIndustries: { name: string; count: number }[];
}

interface AlumniClientProps {
  enterpriseId: string;
}

export function AlumniClient({ enterpriseId }: AlumniClientProps) {
  const searchParams = useSearchParams();

  const [isLoading, setIsLoading] = useState(true);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [alumni, setAlumni] = useState<Alumni[]>([]);
  const [stats, setStats] = useState<AlumniStats>({
    totalCount: 0,
    orgStats: [],
    topIndustries: [],
  });
  const [filterOptions, setFilterOptions] = useState({
    years: [] as (number | null)[],
    industries: [] as string[],
    companies: [] as string[],
    cities: [] as string[],
    positions: [] as string[],
  });
  const [statsError, setStatsError] = useState(false);
  const [selectedAlumni, setSelectedAlumni] = useState<Alumni | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Get current filters from URL
  const currentFilters = {
    org: searchParams.get("org") || "",
    year: searchParams.get("year") || "",
    industry: searchParams.get("industry") || "",
    company: searchParams.get("company") || "",
    city: searchParams.get("city") || "",
    position: searchParams.get("position") || "",
    hasEmail: searchParams.get("hasEmail") || "",
    hasPhone: searchParams.get("hasPhone") || "",
  };

  // Fetch initial stats
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const statsRes = await fetch(`/api/enterprise/${enterpriseId}/alumni/stats`);
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
          setOrganizations(statsData.organizations || []);
          setFilterOptions(statsData.filterOptions || {
            years: [],
            industries: [],
            companies: [],
            cities: [],
            positions: [],
          });
        } else {
          setStatsError(true);
        }
      } catch {
        setStatsError(true);
      }
    };

    fetchInitialData();
  }, [enterpriseId]);

  // Fetch filtered alumni when filters change
  useEffect(() => {
    const fetchAlumni = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        const filterKeys = ["org", "year", "industry", "company", "city", "position", "hasEmail", "hasPhone"];
        filterKeys.forEach((key) => {
          const value = searchParams.get(key);
          if (value) params.set(key, value);
        });

        const res = await fetch(`/api/enterprise/${enterpriseId}/alumni?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setAlumni(data.alumni || []);
        }
      } catch {
        // Alumni fetch failed — loading state will clear
      } finally {
        setIsLoading(false);
      }
    };

    fetchAlumni();
  }, [enterpriseId, searchParams]);

  const handleViewProfile = (alum: Alumni) => {
    setSelectedAlumni(alum);
    setIsDrawerOpen(true);
  };

  const hasActiveFilters = Object.values(currentFilters).some((v) => v !== "");

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Alumni Directory"
        description={`${stats.totalCount.toLocaleString()} alumni across all organizations`}
        actions={
          enterpriseId && (
            <BulkExportButton
              enterpriseId={enterpriseId}
              selectedIds={selectedIds.size > 0 ? selectedIds : undefined}
              filters={currentFilters}
              totalCount={hasActiveFilters ? alumni.length : stats.totalCount}
            />
          )
        }
      />

      {/* Stats Error */}
      {statsError && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
          Unable to load stats. Filters and alumni data may still be available.
        </div>
      )}

      {/* Stats Header */}
      <AlumniStatsHeader
        totalCount={stats.totalCount}
        orgStats={stats.orgStats}
        topIndustries={stats.topIndustries}
      />

      {/* Filters */}
      <EnterpriseAlumniFilters
        organizations={organizations}
        years={filterOptions.years}
        industries={filterOptions.industries}
        companies={filterOptions.companies}
        cities={filterOptions.cities}
        positions={filterOptions.positions}
      />

      {/* Results Info */}
      {hasActiveFilters && (
        <div className="mb-4 text-sm text-muted-foreground">
          Showing {alumni.length.toLocaleString()} filtered results
          {selectedIds.size > 0 && ` (${selectedIds.size} selected)`}
        </div>
      )}

      {/* Alumni Table */}
      {isLoading ? (
        <Card className="p-8">
          <div className="flex items-center justify-center">
            <LoadingSpinner className="h-8 w-8 text-purple-600" />
          </div>
        </Card>
      ) : (
        <EnterpriseAlumniTable
          alumni={alumni}
          onViewProfile={handleViewProfile}
          selectedIds={selectedIds}
          onSelectChange={setSelectedIds}
        />
      )}

      {/* Contact Drawer */}
      <AlumniContactDrawer
        alumni={selectedAlumni}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedAlumni(null);
        }}
      />

      {/* Floating Action Bar for Selection */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-card border border-border rounded-xl shadow-xl p-4 flex items-center gap-4 animate-slide-up">
          <span className="text-sm text-foreground font-medium">
            {selectedIds.size} alumni selected
          </span>
          <div className="h-4 w-px bg-border" />
          {enterpriseId && (
            <BulkExportButton
              enterpriseId={enterpriseId}
              selectedIds={selectedIds}
              filters={currentFilters}
              totalCount={selectedIds.size}
            />
          )}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
