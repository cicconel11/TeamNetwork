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
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(50, "Slug must be less than 50 characters")
    .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
});

type CreateSubOrgForm = z.infer<typeof createSubOrgSchema>;

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
  } = useForm<CreateSubOrgForm>({
    resolver: zodResolver(createSubOrgSchema),
    defaultValues: {
      name: "",
      slug: "",
      primaryColor: "#6B21A8", // Purple-700
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

  const onSubmit = async (data: CreateSubOrgForm) => {
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
