import { Card } from "@/components/ui";
import { sanitizeRichTextToPlainText } from "@/lib/security/rich-text";

interface WorkHistoryEntry {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  description_html?: string | null;
  company_logo_url?: string | null;
}

interface EducationEntry {
  title?: string | null; // school name
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: string | null;
  end_year?: string | null;
  description?: string | null;
  institute_logo_url?: string | null;
}

function isObjectEntry<T extends object>(value: unknown): value is T {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toEntries<T extends object>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is T => isObjectEntry<T>(entry));
}

/**
 * Renders the Experience + Education cards from `work_history` / `education_history`
 * JSONB arrays (the Apify-normalized shape). Returns null when both are empty.
 * Used by the parent detail page; alumni/member pages render their own variants
 * inline with flat-field fallbacks.
 */
export function EnrichmentHistory({
  workHistory,
  educationHistory,
}: {
  workHistory?: unknown;
  educationHistory?: unknown;
}) {
  const work = toEntries<WorkHistoryEntry>(workHistory);
  const education = toEntries<EducationEntry>(educationHistory);

  if (work.length === 0 && education.length === 0) return null;

  return (
    <>
      {work.length > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
            </svg>
            Experience
          </h3>
          <div className="space-y-0">
            {work.map((job, i) => {
              const descriptionText = sanitizeRichTextToPlainText(job.description_html);
              return (
                <div key={i} className={`flex gap-4 py-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
                  <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center text-muted-foreground">
                    {job.company_logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={job.company_logo_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
                    ) : (
                      <svg className="h-6 w-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground text-sm">{job.title || "Position"}</p>
                    <p className="text-muted-foreground text-sm">
                      {job.company}
                      {job.location && <span className="text-muted-foreground/60"> &middot; {job.location}</span>}
                    </p>
                    {(job.start_date || job.end_date) && (
                      <p className="text-muted-foreground/60 text-xs mt-0.5">
                        {job.start_date || "?"} &ndash; {job.end_date || "Present"}
                      </p>
                    )}
                    {descriptionText && (
                      <p className="text-foreground/70 text-sm mt-2 leading-relaxed whitespace-pre-wrap">
                        {descriptionText}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {education.length > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
            </svg>
            Education
          </h3>
          <div className="space-y-0">
            {education.map((edu, i) => (
              <div key={i} className={`flex gap-4 py-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
                <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--muted)]/60 flex items-center justify-center">
                  {edu.institute_logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={edu.institute_logo_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
                  ) : (
                    <svg className="h-6 w-6 text-muted-foreground opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground text-sm">{edu.title || "School"}</p>
                  {(edu.degree || edu.field_of_study) && (
                    <p className="text-muted-foreground text-sm">
                      {[edu.degree, edu.field_of_study].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {(edu.start_year || edu.end_year) && (
                    <p className="text-muted-foreground/60 text-xs mt-0.5">
                      {edu.start_year || "?"} &ndash; {edu.end_year || "Present"}
                    </p>
                  )}
                  {edu.description && (
                    <p className="text-foreground/70 text-sm mt-2 leading-relaxed whitespace-pre-wrap">
                      {edu.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
