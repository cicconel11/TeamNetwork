interface BuildInviteLinkInput {
  kind: "org" | "parent" | "enterprise";
  baseUrl: string;
  orgId?: string | null;
  code?: string | null;
  token?: string | null;
  isEnterpriseWide?: boolean;
}

export function buildInviteLink(input: BuildInviteLinkInput): string {
  const baseUrl = input.baseUrl ?? "";

  const hasToken = Boolean(input.token);
  const value = input.token ?? input.code;
  if (!value) return `${baseUrl}/app/join`;

  const params = new URLSearchParams({
    [hasToken ? "token" : "code"]: value,
  });

  if (input.kind === "enterprise" && input.isEnterpriseWide && hasToken) {
    params.set("invite", "enterprise");
  }

  return `${baseUrl}/app/join?${params.toString()}`;
}
