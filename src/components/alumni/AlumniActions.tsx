"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { AddAlumniMenu } from "./AddAlumniMenu";
import { BulkLinkedInImporter } from "./BulkLinkedInImporter";
import { BulkCsvImporter } from "./BulkCsvImporter";

// ─── Context to decouple menu (in header) from panel (in body) ───────────────

type ImportMode = "linkedin" | "csv" | null;

interface ImporterContextValue {
  importMode: ImportMode;
  openLinkedInImporter: () => void;
  openCsvImporter: () => void;
  closeImporter: () => void;
}

const ImporterContext = createContext<ImporterContextValue>({
  importMode: null,
  openLinkedInImporter: () => {},
  openCsvImporter: () => {},
  closeImporter: () => {},
});

// Provider wraps the entire alumni page section
export function AlumniActionsProvider({ children }: { children: ReactNode }) {
  const [importMode, setImportMode] = useState<ImportMode>(null);
  const openLinkedInImporter = useCallback(() => setImportMode("linkedin"), []);
  const openCsvImporter = useCallback(() => setImportMode("csv"), []);
  const closeImporter = useCallback(() => setImportMode(null), []);

  return (
    <ImporterContext.Provider value={{ importMode, openLinkedInImporter, openCsvImporter, closeImporter }}>
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
  const { openLinkedInImporter, openCsvImporter } = useContext(ImporterContext);

  return (
    <AddAlumniMenu
      orgSlug={orgSlug}
      actionLabel={actionLabel}
      onImportClick={openLinkedInImporter}
      onCsvImportClick={openCsvImporter}
    />
  );
}

// The import panel, rendered in the page body between filters and grid
interface AlumniImportPanelProps {
  organizationId: string;
}

export function AlumniImportPanel({ organizationId }: AlumniImportPanelProps) {
  const { importMode, closeImporter } = useContext(ImporterContext);

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
