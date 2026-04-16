"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Select } from "@/components/ui";
import { LOCALE_NAMES } from "@/i18n/config";
import type { SupportedLocale } from "@/i18n/config";

const LANGUAGE_OPTIONS = (Object.entries(LOCALE_NAMES) as [SupportedLocale, string][]).map(
  ([value, label]) => ({ value, label })
);

export default function LanguageSettingsPage() {
  return (
    <Suspense fallback={<LanguageSettingsLoading />}>
      <LanguageSettingsContent />
    </Suspense>
  );
}

function LanguageSettingsLoading() {
  const t = useTranslations("settings.language");
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("description")}
        </p>
      </div>
      <Card className="p-5 text-muted-foreground text-sm">{tCommon("loading")}</Card>
    </div>
  );
}

function LanguageSettingsContent() {
  const supabase = useMemo(() => createClient(), []);
  const t = useTranslations("settings.language");
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("users")
        .select("language_override")
        .eq("id", user.id)
        .maybeSingle();

      setLanguage(data?.language_override ?? null);
      setLoading(false);
    };

    load();
  }, [supabase]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error: updateError } = await supabase
        .from("users")
        .update({ language_override: language || null })
        .eq("id", user.id);

      if (updateError) throw new Error(updateError.message);

      // Set the NEXT_LOCALE cookie immediately so the reload picks up the
      // correct locale. When language is null (org default), clear the cookie
      // so middleware resolves it from the org's default_language.
      const secure = window.location.protocol === "https:" ? ";secure" : "";
      if (language) {
        document.cookie = `NEXT_LOCALE=${language};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax${secure}`;
      } else {
        document.cookie = `NEXT_LOCALE=;path=/;max-age=0${secure}`;
      }
      // Force middleware to re-read DB on next request so the cookie
      // reflects the newly saved preference (or org default).
      document.cookie = `NEXT_LOCALE_SYNCED_AT=;path=/;max-age=0${secure}`;

      // Full reload — router.refresh() doesn't re-run middleware or
      // re-evaluate next-intl's getRequestConfig.
      window.location.reload();
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save language preference");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LanguageSettingsLoading />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <Select
          label={t("title")}
          options={[
            { value: "", label: t("orgDefault") },
            ...LANGUAGE_OPTIONS,
          ]}
          value={language || ""}
          onChange={(e) => { setLanguage(e.target.value || null); setSuccess(null); }}
        />

        <Button
          variant="secondary"
          size="sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? tCommon("saving") : tCommon("save")}
        </Button>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
        )}
      </Card>
    </div>
  );
}
