"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { AddAlumniMenu } from "./AddAlumniMenu";
import { SingleLinkedInAttacher } from "./SingleLinkedInAttacher";

const BulkLinkedInImporter = dynamic(
  () => import("./BulkLinkedInImporter").then((mod) => mod.BulkLinkedInImporter),
  { loading: () => <div className="animate-pulse bg-[var(--muted)] rounded-2xl h-48" /> }
);
const BulkCsvImporter = dynamic(
  () => import("./BulkCsvImporter").then((mod) => mod.BulkCsvImporter),
  { loading: () => <div className="animate-pulse bg-[var(--muted)] rounded-2xl h-48" /> }
);

// ─── Context to decouple menu (in header) from panel (in body) ───────────────

type ImportMode = "single_linkedin" | "linkedin" | "csv" | null;

interface ImporterContextValue {
  importMode: ImportMode;
  openSingleLinkedInAttacher: () => void;
  openLinkedInImporter: () => void;
  openCsvImporter: () => void;
  closeImporter: () => void;
  selectMode: boolean;
  toggleSelectMode: () => void;
}

const ImporterContext = createContext<ImporterContextValue>({
  importMode: null,
  openSingleLinkedInAttacher: () => {},
  openLinkedInImporter: () => {},
  openCsvImporter: () => {},
  closeImporter: () => {},
  selectMode: false,
  toggleSelectMode: () => {},
});

// Provider wraps the entire alumni page section
export function AlumniActionsProvider({ children }: { children: ReactNode }) {
  const [importMode, setImportMode] = useState<ImportMode>(null);
  const [selectMode, setSelectMode] = useState(false);
  const openSingleLinkedInAttacher = useCallback(() => setImportMode("single_linkedin"), []);
  const openLinkedInImporter = useCallback(() => setImportMode("linkedin"), []);
  const openCsvImporter = useCallback(() => setImportMode("csv"), []);
  const closeImporter = useCallback(() => setImportMode(null), []);
  const toggleSelectMode = useCallback(() => setSelectMode((prev) => !prev), []);

  return (
    <ImporterContext.Provider value={{ importMode, openSingleLinkedInAttacher, openLinkedInImporter, openCsvImporter, closeImporter, selectMode, toggleSelectMode }}>
      {children}
    </ImporterContext.Provider>
  );
}

// The split-button menu, rendered inside PageHeader actions
interface AlumniActionsMenuProps {
  orgSlug: string;
  actionLabel: string;
}

export function AlumniActionsMenu({ orgSlug, actionLabel }: AlumniActionsMenuProps) {
  const { openSingleLinkedInAttacher, openLinkedInImporter, openCsvImporter, selectMode, toggleSelectMode } = useContext(ImporterContext);

  return (
    <AddAlumniMenu
      orgSlug={orgSlug}
      actionLabel={actionLabel}
      onSingleLinkedInClick={openSingleLinkedInAttacher}
      onImportClick={openLinkedInImporter}
      onCsvImportClick={openCsvImporter}
      selectMode={selectMode}
      onToggleSelectMode={toggleSelectMode}
    />
  );
}

/** Hook for child components to read selectMode from context. */
export function useAlumniSelectMode() {
  const { selectMode, toggleSelectMode } = useContext(ImporterContext);
  return { selectMode, toggleSelectMode };
}

// The import panel, rendered in the page body between filters and grid
interface AlumniImportPanelProps {
  organizationId: string;
  orgSlug: string;
}

export function AlumniImportPanel({ organizationId, orgSlug }: AlumniImportPanelProps) {
  const { importMode, closeImporter } = useContext(ImporterContext);

  if (importMode === "single_linkedin") {
    return (
      <SingleLinkedInAttacher
        organizationId={organizationId}
        orgSlug={orgSlug}
        onClose={closeImporter}
      />
    );
  }

  if (importMode === "linkedin") {
    return (
      <BulkLinkedInImporter
        organizationId={organizationId}
        onClose={closeImporter}
      />
    );
  }

  if (importMode === "csv") {
    return (
      <BulkCsvImporter
        organizationId={organizationId}
        onClose={closeImporter}
      />
    );
  }

  return null;
}
