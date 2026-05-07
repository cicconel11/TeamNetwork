"use client";

import { useState, useEffect } from "react";

interface EnterpriseData {
  id: string;
  name: string;
  slug: string;
  billing_contact_email: string | null;
  created_at: string;
  subscription: {
    status: string;
    alumni_bucket_quantity: number;
    sub_org_quantity: number | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  } | null;
  counts: {
    total_alumni_count: number;
    sub_org_count: number;
    enterprise_managed_org_count: number;
  };
  admins: Array<{ user_id: string; role: string; email: string }>;
  sub_orgs: Array<{
    id: string;
    name: string;
    slug: string;
    relationship_type: string | null;
    subscription_status: string | null;
  }>;
}

interface DevEnterpriseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case "active":
    case "trialing":
      return "bg-green-100 text-green-800";
    case "canceled":
    case "canceling":
      return "bg-yellow-100 text-yellow-800";
    case "past_due":
    case "unpaid":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function getRoleBadgeClasses(role: string): string {
  switch (role) {
    case "owner":
      return "bg-purple-100 text-purple-800";
    case "billing_admin":
      return "bg-blue-100 text-blue-800";
    case "org_admin":
      return "bg-teal-100 text-teal-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function stripeDashboardUrl(type: "customers" | "subscriptions", id: string): string {
  return `https://dashboard.stripe.com/${type}/${id}`;
}

export default function DevEnterpriseModal({ isOpen, onClose }: DevEnterpriseModalProps) {
  const [enterprises, setEnterprises] = useState<EnterpriseData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/dev-admin/enterprises")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch enterprises: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setEnterprises(data.enterprises ?? data ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleExpanded = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 max-w-6xl w-full max-h-[80vh] overflow-auto text-gray-900 m-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">
            All Enterprises ({enterprises.length})
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
          </div>
        )}

        {error && (
          <div className="text-red-600 text-sm py-4">Error: {error}</div>
        )}

        {!loading && !error && enterprises.length === 0 && (
          <div className="text-gray-500 text-sm py-4">No enterprises found.</div>
        )}

        {!loading && !error && enterprises.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="text-left py-2 px-3 font-semibold">Name</th>
                  <th className="text-left py-2 px-3 font-semibold">Slug</th>
                  <th className="text-left py-2 px-3 font-semibold">Pricing</th>
                  <th className="text-left py-2 px-3 font-semibold">Sub-Orgs</th>
                  <th className="text-left py-2 px-3 font-semibold">Alumni</th>
                  <th className="text-left py-2 px-3 font-semibold">Status</th>
                  <th className="text-left py-2 px-3 font-semibold">Stripe</th>
                </tr>
              </thead>
              <tbody>
                {enterprises.map((ent) => {
                  const isExpanded = expandedId === ent.id;
                  return (
                    <EnterpriseRow
                      key={ent.id}
                      enterprise={ent}
                      isExpanded={isExpanded}
                      onToggle={() => toggleExpanded(ent.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function EnterpriseRow({
  enterprise,
  isExpanded,
  onToggle,
}: {
  enterprise: EnterpriseData;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const sub = enterprise.subscription;
  const counts = enterprise.counts;

  return (
    <>
      <tr
        className="border-b hover:bg-gray-50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="py-3 px-3 font-medium">
          <span className="mr-1 text-gray-400 text-xs">
            {isExpanded ? "▼" : "▶"}
          </span>
          {enterprise.name}
        </td>
        <td className="py-3 px-3">
          <a
            href={`/enterprise/${enterprise.slug}`}
            className="text-blue-600 hover:text-blue-800 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {enterprise.slug}
          </a>
        </td>
        <td className="py-3 px-3">
          {sub ? (
            <span className="text-xs">
              {sub.alumni_bucket_quantity} bucket{sub.alumni_bucket_quantity !== 1 ? "s" : ""} / {sub.sub_org_quantity ?? 0} seats
            </span>
          ) : (
            <span className="text-gray-400 text-xs">None</span>
          )}
        </td>
        <td className="py-3 px-3">
          {counts.sub_org_count} / {counts.enterprise_managed_org_count} managed
        </td>
        <td className="py-3 px-3">
          {counts.total_alumni_count.toLocaleString()}
        </td>
        <td className="py-3 px-3">
          <span
            className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClasses(sub?.status ?? "")}`}
          >
            {sub?.status ?? "None"}
          </span>
        </td>
        <td className="py-3 px-3 text-xs">
          {sub?.stripe_customer_id && (
            <a
              href={stripeDashboardUrl("customers", sub.stripe_customer_id)}
              className="text-blue-600 hover:text-blue-800 hover:underline block"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {sub.stripe_customer_id.slice(0, 18)}...
            </a>
          )}
          {sub?.stripe_subscription_id && (
            <a
              href={stripeDashboardUrl("subscriptions", sub.stripe_subscription_id)}
              className="text-blue-600 hover:text-blue-800 hover:underline block"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {sub.stripe_subscription_id.slice(0, 18)}...
            </a>
          )}
          {!sub?.stripe_customer_id && !sub?.stripe_subscription_id && (
            <span className="text-gray-400">--</span>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={7} className="bg-gray-50 px-6 py-4">
            <ExpandedDetails enterprise={enterprise} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetails({ enterprise }: { enterprise: EnterpriseData }) {
  return (
    <div className="space-y-4">
      {/* Sub-Organizations */}
      <div>
        <h4 className="text-sm font-semibold mb-2">
          Sub-Organizations ({enterprise.sub_orgs.length})
        </h4>
        {enterprise.sub_orgs.length === 0 ? (
          <p className="text-gray-400 text-xs">No sub-organizations.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-1 px-2 font-semibold">Name</th>
                <th className="text-left py-1 px-2 font-semibold">Slug</th>
                <th className="text-left py-1 px-2 font-semibold">Type</th>
                <th className="text-left py-1 px-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {enterprise.sub_orgs.map((org) => (
                <tr key={org.id} className="border-b border-gray-200">
                  <td className="py-1 px-2">{org.name}</td>
                  <td className="py-1 px-2">
                    <a
                      href={`/${org.slug}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {org.slug}
                    </a>
                  </td>
                  <td className="py-1 px-2">
                    {org.relationship_type ?? "--"}
                  </td>
                  <td className="py-1 px-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getStatusBadgeClasses(org.subscription_status ?? "")}`}
                    >
                      {org.subscription_status ?? "None"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Admins */}
      <div>
        <h4 className="text-sm font-semibold mb-2">
          Admins ({enterprise.admins.length})
        </h4>
        {enterprise.admins.length === 0 ? (
          <p className="text-gray-400 text-xs">No admins.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {enterprise.admins.map((admin) => (
              <span
                key={admin.user_id}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeClasses(admin.role)}`}
              >
                <span>{admin.email}</span>
                <span className="opacity-60">({admin.role})</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
