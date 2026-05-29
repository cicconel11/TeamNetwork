"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Input } from "@/components/ui";

interface EnterpriseDangerZoneCardProps {
  enterpriseId: string;
  enterpriseName: string;
  attachedOrgCount: number;
  onInitiated: () => void;
}

export function EnterpriseDangerZoneCard({
  enterpriseId,
  enterpriseName,
  attachedOrgCount,
  onInitiated,
}: EnterpriseDangerZoneCardProps) {
  const t = useTranslations("settings.enterpriseDelete");
  const tCommon = useTranslations("common");

  const [showModal, setShowModal] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [confirmationRepeat, setConfirmationRepeat] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredPhrase = `DELETE ${enterpriseName}`;
  const hasAttachedOrgs = attachedOrgCount > 0;
  const phrasesValid = confirmation === requiredPhrase && confirmationRepeat === requiredPhrase;

  const closeModal = () => {
    setShowModal(false);
    setConfirmation("");
    setConfirmationRepeat("");
    setError(null);
  };

  const handleDelete = async () => {
    if (!phrasesValid) return;

    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/deletion`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation, confirmationRepeat }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t("unableToDelete"));
      }
      closeModal();
      onInitiated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unableToDelete"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Card className="p-6 mt-8 border border-amber-300 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-amber-800 dark:text-amber-200 font-semibold">{t("title")}</h3>
            <p className="text-sm text-amber-700/80 dark:text-amber-300/80">{t("description")}</p>
          </div>

          <div className="border-t border-amber-300 dark:border-amber-700/50 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h4 className="font-medium text-amber-800 dark:text-amber-200">{t("title")}</h4>
                {hasAttachedOrgs ? (
                  <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                    {t("blockedByOrgs", { count: attachedOrgCount })}
                  </p>
                ) : (
                  <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                    {t("gracePeriodNote")}
                  </p>
                )}
              </div>
              <Button
                variant="secondary"
                onClick={() => setShowModal(true)}
                disabled={hasAttachedOrgs}
                className="!bg-amber-600 !text-white hover:!bg-amber-700 !border-amber-600 disabled:!bg-amber-300 disabled:!border-amber-300"
              >
                {t("button")}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-amber-700 dark:text-amber-300">
                {t("confirmTitle")}
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                {t("confirmDesc", { name: enterpriseName })}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium block mb-2">
                  {t("typeToConfirm", { phrase: requiredPhrase })}
                </label>
                <Input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder={requiredPhrase}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-2">{t("typeAgain")}</label>
                <Input
                  value={confirmationRepeat}
                  onChange={(e) => setConfirmationRepeat(e.target.value)}
                  placeholder={requiredPhrase}
                  className="w-full"
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>}

            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={closeModal} disabled={isDeleting}>
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={handleDelete}
                disabled={isDeleting || !phrasesValid}
                isLoading={isDeleting}
                className="!bg-amber-600 !text-white hover:!bg-amber-700 !border-amber-600"
              >
                {t("deleteForever")}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
