interface BuildInviteLinkInput {
  kind: "org" | "parent";
  baseUrl: string;
  orgId?: string | null;
  code?: string | null;
  token?: string | null;
}

export function buildInviteLink(input: BuildInviteLinkInput): string {
  const baseUrl = input.baseUrl ?? "";

  if (input.kind === "parent") {
    if (!input.orgId || !input.code) return `${baseUrl}/app/parents-join`;
    const params = new URLSearchParams({
      org: input.orgId,
      code: input.code,
    });
    return `${baseUrl}/app/parents-join?${params.toString()}`;
  }

  const hasToken = Boolean(input.token);
  const value = input.token ?? input.code;
  if (!value) return `${baseUrl}/app/join`;

  const params = new URLSearchParams({
    [hasToken ? "token" : "code"]: value,
  });

  return `${baseUrl}/app/join?${params.toString()}`;
}
