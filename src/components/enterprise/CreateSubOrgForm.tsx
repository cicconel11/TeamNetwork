"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Card, CardHeader, CardTitle, CardDescription } from "@/components/ui";

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
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6 character hex code"),
  billingType: z.enum(["enterprise_managed", "independent"]),
});

type CreateSubOrgFormData = z.infer<typeof createSubOrgSchema>;

interface CreateSubOrgFormProps {
  enterpriseSlug: string;
  onSuccess?: (slug: string) => void;
  onCancel?: () => void;
}

export function CreateSubOrgForm({
  enterpriseSlug,
  onSuccess,
  onCancel,
}: CreateSubOrgFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const billingType = watch("billingType");

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
        throw new Error(responseData.error || "Failed to create organization");
      }

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New Organization</CardTitle>
        <CardDescription>
          Create a new organization under this enterprise. It will use the pooled alumni quota.
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
            label="Organization Name"
            type="text"
            placeholder="e.g., Stanford Crew, The Whiffenpoofs"
            error={errors.name?.message}
            {...register("name", {
              onChange: (e) => handleNameChange(e.target.value),
            })}
          />

          <Input
            label="URL Slug"
            type="text"
            placeholder="my-organization"
            helperText={`Your organization will be at: teamnetwork.app/${slug || "your-slug"}`}
            error={errors.slug?.message}
            {...register("slug", {
              onChange: (e) => {
                e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
              },
            })}
          />

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Brand Color
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
              This color will be used for the organization&apos;s branding
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Billing Type
            </label>
            <div className="space-y-3">
              <BillingTypeOption
                selected={billingType === "enterprise_managed"}
                onSelect={() => setValue("billingType", "enterprise_managed")}
                title="Enterprise Billing (Recommended)"
                description="Uses the pooled alumni quota from the enterprise subscription"
              />
              <BillingTypeOption
                selected={billingType === "independent"}
                onSelect={() => setValue("billingType", "independent")}
                title="Independent Billing"
                description="Organization pays separately with its own subscription"
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
                Cancel
              </Button>
            )}
            <Button type="submit" className="flex-1" isLoading={isLoading}>
              Create Organization
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

interface BillingTypeOptionProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}

function BillingTypeOption({
  selected,
  onSelect,
  title,
  description,
}: BillingTypeOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
        selected
          ? "border-purple-600 bg-purple-50 dark:bg-purple-900/20"
          : "border-border hover:border-muted-foreground/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
            selected
              ? "border-purple-600 bg-purple-600"
              : "border-muted-foreground"
          }`}
        >
          {selected && (
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          )}
        </div>
        <div>
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
    </button>
  );
}
