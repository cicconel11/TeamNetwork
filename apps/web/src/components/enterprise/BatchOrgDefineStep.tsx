"use client";

import { useFormContext, useFieldArray } from "react-hook-form";
import { Button, Input } from "@/components/ui";
import { BatchOrgQuotaBar } from "./BatchOrgQuotaBar";
import { BatchOrgUpgradeBlocker } from "./BatchOrgUpgradeBlocker";
import type { BatchFormData } from "./BatchOrgWizard";

interface BatchOrgDefineStepProps {
  quota: {
    currentCount: number;
    maxAllowed: number | null;
    remaining: number | null;
  };
  enterpriseSlug: string;
}

export function BatchOrgDefineStep({ quota, enterpriseSlug }: BatchOrgDefineStepProps) {
  const { register, setValue, watch, formState: { errors } } = useFormContext<BatchFormData>();
  const { fields, append, remove } = useFieldArray({ name: "organizations" });

  const organizations = watch("organizations");
  const isAtLimit = quota.maxAllowed != null && quota.currentCount + fields.length >= quota.maxAllowed;
  const isOverLimit = quota.maxAllowed != null && quota.currentCount + fields.length > quota.maxAllowed;

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  };

  const handleNameChange = (index: number, value: string) => {
    setValue(`organizations.${index}.name`, value);
    // Auto-generate slug if it hasn't been manually edited
    const currentSlug = organizations[index]?.slug ?? "";
    const prevName = organizations[index]?.name ?? "";
    if (!currentSlug || currentSlug === generateSlug(prevName)) {
      setValue(`organizations.${index}.slug`, generateSlug(value));
    }
  };

  if (isOverLimit && fields.length === 0) {
    return (
      <BatchOrgUpgradeBlocker
        enterpriseSlug={enterpriseSlug}
        currentCount={quota.currentCount}
        maxAllowed={quota.maxAllowed!}
      />
    );
  }

  return (
    <div className="space-y-6">
      <BatchOrgQuotaBar
        currentCount={quota.currentCount}
        maxAllowed={quota.maxAllowed}
        adding={fields.length}
      />

      <div className="space-y-4">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3"
          >
            <div className="flex justify-between items-center">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Organization {index + 1}
              </h4>
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                  aria-label="Remove organization"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name *
                </label>
                <Input
                  {...register(`organizations.${index}.name`)}
                  onChange={(e) => handleNameChange(index, e.target.value)}
                  placeholder="e.g., Class of 2025"
                />
                {errors.organizations?.[index]?.name && (
                  <p className="text-xs text-red-500 mt-1">{errors.organizations[index].name?.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Slug *
                </label>
                <Input
                  {...register(`organizations.${index}.slug`)}
                  placeholder="e.g., class-of-2025"
                />
                {errors.organizations?.[index]?.slug && (
                  <p className="text-xs text-red-500 mt-1">{errors.organizations[index].slug?.message}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Purpose
              </label>
              <textarea
                {...register(`organizations.${index}.purpose`)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                placeholder="Why does this organization exist? (visible to members)"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  {...register(`organizations.${index}.description`)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Optional description"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Brand Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    {...register(`organizations.${index}.primaryColor`)}
                    className="h-9 w-9 rounded cursor-pointer border border-gray-300 dark:border-gray-600"
                  />
                  <Input
                    {...register(`organizations.${index}.primaryColor`)}
                    placeholder="#6B21A8"
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {errors.organizations?.message && (
        <p className="text-sm text-red-500">{errors.organizations.message}</p>
      )}

      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          append({ name: "", slug: "", description: "", purpose: "", primaryColor: "#6B21A8" })
        }
        disabled={isAtLimit}
        className="w-full"
      >
        {isAtLimit
          ? "Organization limit reached"
          : `+ Add Organization (${fields.length}/20)`}
      </Button>
    </div>
  );
}
