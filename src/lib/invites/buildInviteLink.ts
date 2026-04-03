interface BuildInviteLinkInput {
  kind: "org" | "parent";
  baseUrl: string;
  orgId?: string | null;
  code?: string | null;
  token?: string | null;
}

export function buildInviteLink(input: BuildInviteLinkInput): string {
  const baseUrl = input.baseUrl ?? "";

  const hasToken = Boolean(input.token);
  const value = input.token ?? input.code;
  if (!value) return `${baseUrl}/app/join`;

  const params = new URLSearchParams({
    [hasToken ? "token" : "code"]: value,
  });

  return `${baseUrl}/app/join?${params.toString()}`;
}
