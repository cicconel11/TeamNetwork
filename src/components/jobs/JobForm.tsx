"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { createJobSchema, type CreateJobForm } from "@/lib/schemas/jobs";

interface JobFormProps {
  orgId: string;
  orgSlug: string;
  initialData?: CreateJobForm & { id?: string };
}

export function JobForm({ orgId, orgSlug, initialData }: JobFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState<CreateJobForm>({
    title: initialData?.title || "",
    company: initialData?.company || "",
    location: initialData?.location || "",
    location_type: initialData?.location_type || undefined,
    description: initialData?.description || "",
    application_url: initialData?.application_url || "",
    contact_email: initialData?.contact_email || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSubmitting(true);

    try {
      // Validate with Zod
      const validationResult = createJobSchema.safeParse(formData);
      if (!validationResult.success) {
        const fieldErrors: Record<string, string> = {};
        for (const err of validationResult.error.issues) {
          if (err.path.length > 0) {
            fieldErrors[String(err.path[0])] = err.message;
          }
        }
        setErrors(fieldErrors);
        setIsSubmitting(false);
        return;
      }

      // Submit to API
      const endpoint = initialData?.id
        ? `/api/jobs/${initialData.id}`
        : "/api/jobs";

      const method = initialData?.id ? "PATCH" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          initialData?.id
            ? validationResult.data
            : { orgId, ...validationResult.data }
        ),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save job");
      }

      const { job } = await response.json();
      router.push(`/${orgSlug}/jobs/${job.id}`);
    } catch (error) {
      setErrors({ submit: error instanceof Error ? error.message : "An error occurred" });
      setIsSubmitting(false);
    }
  };

  const handleChange = (field: keyof CreateJobForm, value: string) => {
    setFormData({
      ...formData,
      [field]: value,
    });
    if (errors[field]) {
      setErrors({
        ...errors,
        [field]: "",
      });
    }
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-2">
            Job Title *
          </label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => handleChange("title", e.target.value)}
            placeholder="e.g., Senior Software Engineer"
            error={errors.title}
          />
        </div>

        <div>
          <label htmlFor="company" className="block text-sm font-medium mb-2">
            Company *
          </label>
          <Input
            id="company"
            value={formData.company}
            onChange={(e) => handleChange("company", e.target.value)}
            placeholder="e.g., Acme Corp"
            error={errors.company}
          />
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium mb-2">
            Location
          </label>
          <Input
            id="location"
            value={formData.location || ""}
            onChange={(e) => handleChange("location", e.target.value)}
            placeholder="e.g., San Francisco, CA"
            error={errors.location}
          />
        </div>

        <div>
          <label htmlFor="location_type" className="block text-sm font-medium mb-2">
            Work Location Type
          </label>
          <Select
            id="location_type"
            value={formData.location_type || ""}
            onChange={(e) => handleChange("location_type", e.target.value)}
            options={[
              { label: "Select...", value: "" },
              { label: "Remote", value: "remote" },
              { label: "Hybrid", value: "hybrid" },
              { label: "Onsite", value: "onsite" },
            ]}
          />
          {errors.location_type && (
            <p className="text-sm text-red-600 mt-1">{errors.location_type}</p>
          )}
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-2">
            Description *
          </label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => handleChange("description", e.target.value)}
            placeholder="Describe the job role, responsibilities, requirements, etc."
            rows={8}
            error={errors.description}
          />
        </div>

        <div>
          <label htmlFor="application_url" className="block text-sm font-medium mb-2">
            Application URL
          </label>
          <Input
            id="application_url"
            type="url"
            value={formData.application_url || ""}
            onChange={(e) => handleChange("application_url", e.target.value)}
            placeholder="https://company.com/careers/apply"
            error={errors.application_url}
          />
          <p className="text-sm text-gray-500 mt-1">
            Link to the job application page
          </p>
        </div>

        <div>
          <label htmlFor="contact_email" className="block text-sm font-medium mb-2">
            Contact Email
          </label>
          <Input
            id="contact_email"
            type="email"
            value={formData.contact_email || ""}
            onChange={(e) => handleChange("contact_email", e.target.value)}
            placeholder="hiring@company.com"
            error={errors.contact_email}
          />
          <p className="text-sm text-gray-500 mt-1">
            Email for applicants to reach out
          </p>
        </div>

        {errors.submit && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
            {errors.submit}
          </div>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : initialData?.id ? "Update Job" : "Post Job"}
          </Button>
          <Button
            type="button"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
