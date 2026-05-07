import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { showToast } from "@/components/ui/Toast";
import { ParentForm } from "@/components/parents/ParentForm";
import { useAuth } from "@/hooks/useAuth";
import { fetchParentDetail, useParents } from "@/hooks/useParents";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import {
  INITIAL_PARENT_FORM_VALUES,
  toParentFormValues,
  validateParentForm,
  type ParentFormValues,
} from "@/lib/parents";
import { canEditParentRecord, getEditParentRedirectPath } from "@/lib/parents-edit";

export default function EditParentScreen() {
  const { parentId } = useLocalSearchParams<{ parentId: string }>();
  const resolvedParentId = Array.isArray(parentId) ? parentId[0] : parentId;
  const router = useRouter();
  const { orgId, orgSlug, hasParentsAccess, isLoading: orgLoading } = useOrg();
  const { role, isLoading: roleLoading } = useOrgRole();
  const { user } = useAuth();
  const { updateParent } = useParents(orgId, role === "admin" || role === "parent");
  const [values, setValues] = useState<ParentFormValues>(INITIAL_PARENT_FORM_VALUES);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadParent() {
      if (orgLoading || roleLoading) return;

      const redirectPath = getEditParentRedirectPath({
        orgSlug,
        orgId,
        parentId: resolvedParentId,
        hasParentsAccess,
      });

      if (redirectPath) {
        if (isMounted) {
          setLoading(false);
        }
        router.replace(redirectPath);
        return;
      }

      const safeOrgId = orgId!;
      const safeParentId = resolvedParentId!;

      try {
        setLoading(true);
        const parent = await fetchParentDetail(safeOrgId, safeParentId);
        const canEdit = canEditParentRecord({
          role,
          currentUserId: user?.id,
          parentUserId: parent.user_id,
        });

        if (!canEdit) {
          setError("You do not have permission to edit this parent");
          return;
        }

        if (isMounted) {
          setValues(toParentFormValues(parent));
          setError(null);
        }
      } catch (e) {
        if (isMounted) {
          setError((e as Error).message);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadParent();

    return () => {
      isMounted = false;
    };
  }, [hasParentsAccess, orgId, orgLoading, orgSlug, resolvedParentId, role, roleLoading, router, user?.id]);

  const handleChange = useCallback((field: keyof ParentFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!resolvedParentId) return;

    const validationError = validateParentForm(values);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await updateParent(resolvedParentId, values);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Unable to update parent");
      return;
    }

    showToast("Parent updated", "success");
    router.replace(`/(app)/${orgSlug}/parents/${resolvedParentId}`);
  }, [orgSlug, resolvedParentId, router, updateParent, values]);

  if (loading) {
    return (
      <ParentForm
        title="Edit Parent"
        submitLabel="Save Changes"
        values={values}
        error={error}
        submitting={true}
        onChange={handleChange}
        onSubmit={handleSubmit}
      />
    );
  }

  return (
    <ParentForm
      title="Edit Parent"
      submitLabel="Save Changes"
      values={values}
      error={error}
      submitting={submitting}
      onChange={handleChange}
      onSubmit={handleSubmit}
    />
  );
}
