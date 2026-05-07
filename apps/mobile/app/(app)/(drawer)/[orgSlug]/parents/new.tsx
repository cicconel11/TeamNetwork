import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { showToast } from "@/components/ui/Toast";
import { ParentForm } from "@/components/parents/ParentForm";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useParents } from "@/hooks/useParents";
import {
  INITIAL_PARENT_FORM_VALUES,
  validateParentForm,
  type ParentFormValues,
} from "@/lib/parents";

export default function NewParentScreen() {
  const router = useRouter();
  const { orgId, orgSlug, hasParentsAccess, isLoading: orgLoading } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const { createParent } = useParents(orgId, isAdmin);
  const [values, setValues] = useState<ParentFormValues>(INITIAL_PARENT_FORM_VALUES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback((field: keyof ParentFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    const validationError = validateParentForm(values);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await createParent(values);
    setSubmitting(false);

    if (!result.success || !result.parent) {
      setError(result.error || "Unable to create parent");
      return;
    }

    showToast("Parent added", "success");
    router.replace(`/(app)/${orgSlug}/parents/${result.parent.id}`);
  }, [createParent, orgSlug, router, values]);

  useEffect(() => {
    if (!orgLoading && !roleLoading && (!hasParentsAccess || !isAdmin)) {
      router.replace(`/(app)/${orgSlug}/parents`);
    }
  }, [hasParentsAccess, isAdmin, orgLoading, orgSlug, roleLoading, router]);

  return (
    <ParentForm
      title="Add Parent"
      submitLabel="Save Parent"
      values={values}
      error={error}
      submitting={submitting}
      onChange={handleChange}
      onSubmit={handleSubmit}
    />
  );
}
