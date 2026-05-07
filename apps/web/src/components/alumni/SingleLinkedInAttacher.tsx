"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";
import { linkedInProfileUrlSchema, normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

interface AlumniSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  linkedin_url: string | null;
}

interface SingleLinkedInAttacherProps {
  organizationId: string;
  orgSlug: string;
  onClose?: () => void;
}

function formatName(alumni: AlumniSearchResult) {
  return `${alumni.first_name} ${alumni.last_name}`.trim();
}

export function SingleLinkedInAttacher({
  organizationId,
  orgSlug,
  onClose,
}: SingleLinkedInAttacherProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<AlumniSearchResult[]>([]);
  const [selectedAlumniId, setSelectedAlumniId] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const parsedLinkedInUrl = useMemo(
    () => linkedInProfileUrlSchema.safeParse(linkedinUrl),
    [linkedinUrl],
  );

  const linkedInUrlError = useMemo(() => {
    if (!linkedinUrl.trim()) return null;
    return parsedLinkedInUrl.success
      ? null
      : parsedLinkedInUrl.error.issues[0]?.message ?? "Enter a valid LinkedIn profile URL";
  }, [linkedinUrl, parsedLinkedInUrl]);

  const selectedAlumni = useMemo(
    () => results.find((result) => result.id === selectedAlumniId) ?? null,
    [results, selectedAlumniId],
  );

  const selectedExistingUrl = useMemo(
    () => selectedAlumni?.linkedin_url
      ? normalizeLinkedInProfileUrl(selectedAlumni.linkedin_url)
      : null,
    [selectedAlumni],
  );

  const selectedHasDifferentUrl = Boolean(
    selectedExistingUrl &&
    parsedLinkedInUrl.success &&
    selectedExistingUrl !== parsedLinkedInUrl.data,
  );
  const canCreateNew = parsedLinkedInUrl.success;

  const handleSearch = useCallback(async () => {
    setError(null);
    setSuccessMessage(null);
    setSearchAttempted(true);
    setSelectedAlumniId(null);
    setReplace(false);

    if (!parsedLinkedInUrl.success) {
      setError("Enter a valid LinkedIn profile URL before searching.");
      setResults([]);
      return;
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length < 2) {
      setError("Enter at least 2 characters to search by alumni name or email.");
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/alumni/search?query=${encodeURIComponent(trimmedQuery)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error || "Unable to search alumni.");
        setResults([]);
        return;
      }

      setResults(payload.results ?? []);
    } catch {
      setError("Unable to search alumni.");
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [organizationId, parsedLinkedInUrl, searchQuery]);

  const handleAttach = useCallback(async () => {
    if (!selectedAlumni) {
      setError("Select an alumni record before attaching a LinkedIn URL.");
      return;
    }

    if (!parsedLinkedInUrl.success) {
      setError("Enter a valid LinkedIn profile URL.");
      return;
    }

    if (selectedHasDifferentUrl && !replace) {
      setError("Confirm that you want to replace the existing LinkedIn URL.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/alumni/linkedin-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alumniId: selectedAlumni.id,
            linkedin_url: parsedLinkedInUrl.data,
            replace,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload.code === "LINKEDIN_URL_EXISTS") {
          setReplace(false);
        }
        setError(payload.error || "Unable to attach LinkedIn URL.");
        return;
      }

      setSuccessMessage(`LinkedIn URL saved for ${formatName(selectedAlumni)}.`);
      router.refresh();
    } catch {
      setError("Unable to attach LinkedIn URL.");
    } finally {
      setIsSubmitting(false);
    }
  }, [organizationId, parsedLinkedInUrl, replace, router, selectedAlumni, selectedHasDifferentUrl]);

  const handleCreateNew = useCallback(() => {
    const url = parsedLinkedInUrl.success ? parsedLinkedInUrl.data : linkedinUrl.trim();
    router.push(`/${orgSlug}/alumni/new?linkedin_url=${encodeURIComponent(url)}`);
  }, [linkedinUrl, orgSlug, parsedLinkedInUrl, router]);

  return (
    <Card ref={panelRef} padding="none" className="mb-6 overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-org-secondary/10">
            <svg className="h-4 w-4 text-org-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75v10.5m-10.5-10.5v10.5M12 3v18m8.25-8.25H3.75" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Attach LinkedIn URL</h3>
            <p className="text-xs text-muted-foreground">Paste one LinkedIn profile URL, then attach it to an alumnus or create a new alumni profile</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
            aria-label="Close LinkedIn attach panel"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="px-5 py-4 space-y-5">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm">
            {successMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
          <Input
            label="LinkedIn profile URL"
            type="url"
            value={linkedinUrl}
            onChange={(event) => setLinkedinUrl(event.target.value)}
            placeholder="https://www.linkedin.com/in/username"
            helperText="Use a public LinkedIn profile URL under linkedin.com/in/..."
            error={linkedInUrlError ?? undefined}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setLinkedinUrl("");
                setSearchQuery("");
                setResults([]);
                setSelectedAlumniId(null);
                setReplace(false);
                setSearchAttempted(false);
                setError(null);
                setSuccessMessage(null);
              }}
            >
              Reset
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
          <Input
            label="Find alumni"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by name or email"
            helperText="Search the existing alumni directory to choose exactly one existing record"
          />
          <Button type="button" onClick={handleSearch} isLoading={isSearching} disabled={!parsedLinkedInUrl.success}>
            Search Alumni
          </Button>
        </div>

        <div className="rounded-xl border border-dashed border-border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Need a new alumni record?</p>
            <p className="text-sm text-muted-foreground">Use this LinkedIn URL as the starting point and finish the rest in the standard Add Alumni form.</p>
          </div>
          <Button type="button" variant="secondary" onClick={handleCreateNew} disabled={!canCreateNew}>
            Create New Alumni
          </Button>
        </div>

        {results.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Select an alumni record</p>
            <div className="space-y-2">
              {results.map((result) => {
                const isSelected = result.id === selectedAlumniId;
                return (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => {
                      setSelectedAlumniId(result.id);
                      setError(null);
                      setSuccessMessage(null);
                      setReplace(false);
                    }}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors duration-150 ${
                      isSelected
                        ? "border-org-secondary bg-org-secondary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{formatName(result)}</p>
                        <p className="text-sm text-muted-foreground">{result.email || "No email on file"}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {result.linkedin_url ? "Has LinkedIn URL" : "No LinkedIn URL"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {searchAttempted && !isSearching && results.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground space-y-3">
            <p>No alumni matched that search. Use the action above to start a new record with this LinkedIn URL.</p>
          </div>
        )}

        {selectedAlumni && (
          <div className="rounded-xl border border-border p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Selected alumni</p>
              <p className="text-sm text-muted-foreground">
                {formatName(selectedAlumni)}
                {selectedAlumni.email ? ` · ${selectedAlumni.email}` : ""}
              </p>
            </div>

            {selectedExistingUrl ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Current LinkedIn URL:{" "}
                  <a
                    href={selectedExistingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-org-secondary hover:underline break-all"
                  >
                    {selectedExistingUrl}
                  </a>
                </p>
                {selectedHasDifferentUrl ? (
                  <label className="flex items-start gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={replace}
                      onChange={(event) => setReplace(event.target.checked)}
                    />
                    <span>Replace the existing LinkedIn URL with the new one</span>
                  </label>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This alumni already has the same LinkedIn URL.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This alumni does not have a LinkedIn URL yet.</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          {onClose && (
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
          <Button
            type="button"
            onClick={handleAttach}
            isLoading={isSubmitting}
            disabled={!selectedAlumni || !parsedLinkedInUrl.success || (selectedHasDifferentUrl && !replace)}
          >
            Save LinkedIn URL
          </Button>
        </div>
      </div>
    </Card>
  );
}
