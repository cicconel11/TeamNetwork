import { Card } from "@/components/ui";

interface CertificationEntry {
  name?: string | null;
  authority?: string | null;
  issued_on?: string | null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

function toCertifications(value: unknown): CertificationEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is CertificationEntry => Boolean(c) && typeof c === "object" && !Array.isArray(c))
    .filter((c) => typeof c.name === "string" && c.name.trim() !== "");
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full bg-[var(--muted)]/60 px-3 py-1 text-xs font-medium text-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * Renders the LinkedIn enrichment fields that have no other home on a person
 * detail page: Skills, Certifications, and Languages. Returns null when none of
 * them are present so callers can drop it in unconditionally. Shared by the
 * alumni, member, and parent detail pages.
 */
export function EnrichmentSections({
  skills,
  certifications,
  languages,
}: {
  skills?: unknown;
  certifications?: unknown;
  languages?: unknown;
}) {
  const skillList = toStringList(skills);
  const certList = toCertifications(certifications);
  const languageList = toStringList(languages);

  if (skillList.length === 0 && certList.length === 0 && languageList.length === 0) {
    return null;
  }

  return (
    <>
      {skillList.length > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
            Skills
          </h3>
          <Chips items={skillList} />
        </Card>
      )}

      {certList.length > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" />
            </svg>
            Certifications
          </h3>
          <div className="space-y-3">
            {certList.map((cert, i) => (
              <div key={i}>
                <p className="font-medium text-foreground text-sm">{cert.name}</p>
                {(cert.authority || cert.issued_on) && (
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {[cert.authority, cert.issued_on].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {languageList.length > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
            </svg>
            Languages
          </h3>
          <Chips items={languageList} />
        </Card>
      )}
    </>
  );
}
