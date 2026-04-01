"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Button, Input, Card, CardHeader, CardTitle, CardDescription } from "@/components/ui";
import { OrgLimitUpgradeModal } from "./OrgLimitUpgradeModal";
import { hexColorSchema } from "@/lib/schemas/common";

const createSubOrgSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name must be 120 characters or fewer"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,64}$/, "Use 3-64 lowercase letters, numbers, or hyphens"),
  primaryColor: hexColorSchema,
  billingType: z.literal("enterprise_managed"),
});

type CreateSubOrgFormData = z.infer<typeof createSubOrgSchema>;

interface UpgradeInfo {
  currentCount: number;
  maxAllowed: number;
}

interface CreateSubOrgFormProps {
  enterpriseSlug: string;
  bucketQuantity?: number;
  onSuccess?: (slug: string) => void;
  onCancel?: () => void;
}

export function CreateSubOrgForm({
  enterpriseSlug,
  bucketQuantity = 1,
  onSuccess,
  onCancel,
}: CreateSubOrgFormProps) {
  const router = useRouter();
  const tEnterprise = useTranslations("enterprise");
  const tCommon = useTranslations("common");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<CreateSubOrgFormData | null>(null);
  const [upgradeInfo, setUpgradeInfo] = useState<UpgradeInfo | null>(null);
  const [isUpgrading, setIsUpgrading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateSubOrgFormData>({
    resolver: zodResolver(createSubOrgSchema),
    defaultValues: {
      name: "",
      slug: "",
      primaryColor: "#6B21A8", // Purple-700
      billingType: "enterprise_managed",
    },
  });

  const primaryColor = watch("primaryColor");
  const slug = watch("slug");

  const handleNameChange = (value: string) => {
    setValue("name", value);
    const generatedSlug = value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
    setValue("slug", generatedSlug);
  };

  const onSubmit = async (data: CreateSubOrgFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/organizations/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          slug: data.slug,
          primary_color: data.primaryColor,
          billingType: data.billingType,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        if (responseData.needsUpgrade) {
          setPendingFormData(data);
          setUpgradeInfo({
            currentCount: responseData.currentCount,
            maxAllowed: responseData.maxAllowed,
          });
          setShowUpgradeModal(true);
          setIsLoading(false);
          return;
        }
        throw new Error(responseData.error || "Failed to create organization");
      }

      setIsLoading(false);
      if (onSuccess) {
        onSuccess(data.slug);
      } else {
        router.push(`/${data.slug}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

  const handleUpgradeConfirm = async () => {
    if (!pendingFormData) {
      return;
    }

    setIsUpgrading(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/organizations/create-with-upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pendingFormData.name,
          slug: pendingFormData.slug,
          primary_color: pendingFormData.primaryColor,
          billingType: pendingFormData.billingType,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || "Failed to create organization with upgrade");
      }

      setShowUpgradeModal(false);
      setPendingFormData(null);
      setUpgradeInfo(null);

      if (onSuccess) {
        onSuccess(pendingFormData.slug);
      } else {
        router.push(`/${pendingFormData.slug}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong during upgrade");
      setShowUpgradeModal(false);
      setPendingFormData(null);
      setUpgradeInfo(null);
    } finally {
      setIsUpgrading(false);
    }
  };

  const handleUpgradeModalClose = () => {
    setShowUpgradeModal(false);
    setPendingFormData(null);
    setUpgradeInfo(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{tEnterprise("createSubOrg.title")}</CardTitle>
          <CardDescription>
            {tEnterprise("createSubOrg.description")}
          </CardDescription>
        </CardHeader>

        {error && (
          <div className="mx-6 mb-4 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-6">
          <div className="space-y-4">
            <Input
              label={tEnterprise("createSubOrg.orgName")}
              type="text"
              placeholder={tEnterprise("createSubOrg.orgNamePlaceholder")}
              error={errors.name?.message}
              {...register("name", {
                onChange: (e) => handleNameChange(e.target.value),
              })}
            />

            <Input
              label={tEnterprise("createSubOrg.urlSlug")}
              type="text"
              placeholder={tEnterprise("createSubOrg.slugPlaceholder")}
              helperText={tEnterprise("createSubOrg.slugHint", { slug: slug || "your-slug" })}
              error={errors.slug?.message}
              {...register("slug", {
                onChange: (e) => {
                  e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                },
              })}
            />

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {tEnterprise("createSubOrg.brandColor")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setValue("primaryColor", e.target.value)}
                  className="h-12 w-20 rounded-xl border border-border cursor-pointer"
                />
                <Input
                  type="text"
                  placeholder="#6B21A8"
                  className="flex-1"
                  error={errors.primaryColor?.message}
                  {...register("primaryColor")}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {tEnterprise("createSubOrg.brandColorHint")}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {tEnterprise("createSubOrg.billingType")}
              </label>
              <div className="space-y-3">
                <BillingTypeOption
                  selected={true}
                  onSelect={() => {}}
                  title={tEnterprise("createSubOrg.enterpriseBilling")}
                  description={tEnterprise("createSubOrg.enterpriseBillingDesc")}
                />
                <BillingTypeOption
                  selected={false}
                  onSelect={() => {}}
                  title={tEnterprise("createSubOrg.independentBilling")}
                  description={tEnterprise("createSubOrg.independentBillingDesc")}
                  disabled
                />
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              {onCancel && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onCancel}
                  disabled={isLoading}
                  className="flex-1"
                >
                  {tCommon("cancel")}
                </Button>
              )}
              <Button type="submit" className="flex-1" isLoading={isLoading}>
                {tEnterprise("createSubOrg.createOrg")}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      {pendingFormData && upgradeInfo && (
        <OrgLimitUpgradeModal
          upgradeType="sub_org"
          isOpen={showUpgradeModal}
          onClose={handleUpgradeModalClose}
          onConfirm={handleUpgradeConfirm}
          pendingOrgData={{
            name: pendingFormData.name,
            slug: pendingFormData.slug,
            primaryColor: pendingFormData.primaryColor,
          }}
          currentCount={upgradeInfo.currentCount}
          maxAllowed={upgradeInfo.maxAllowed}
          bucketQuantity={bucketQuantity}
          isLoading={isUpgrading}
        />
      )}
    </>
  );
}

interface BillingTypeOptionProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  disabled?: boolean;
}

function BillingTypeOption({
  selected,
  onSelect,
  title,
  description,
  disabled = false,
}: BillingTypeOptionProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
        disabled
          ? "border-border bg-muted/50 cursor-not-allowed opacity-60"
          : selected
          ? "border-purple-600 bg-purple-50 dark:bg-purple-900/20"
          : "border-border hover:border-muted-foreground/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
            disabled
              ? "border-muted-foreground/50"
              : selected
              ? "border-purple-600 bg-purple-600"
              : "border-muted-foreground"
          }`}
        >
          {selected && !disabled && (
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          )}
        </div>
        <div>
          <p className={`font-medium ${disabled ? "text-muted-foreground" : "text-foreground"}`}>{title}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
    </button>
  );
}
