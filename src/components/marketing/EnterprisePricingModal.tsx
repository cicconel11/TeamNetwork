"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatBucketRange,
  formatSeatPrice,
  getEnterpriseTotalPricing,
  isSalesLed,
} from "@/lib/enterprise/pricing";
import {
  ALUMNI_BUCKET_PRICING,
  ENTERPRISE_SEAT_PRICING,
} from "@/types/enterprise";
import type { SubscriptionInterval } from "@/types/database";

interface EnterprisePricingModalProps {
  open: boolean;
  onClose: () => void;
  interval: SubscriptionInterval;
}

const BUCKET_ROWS = ALUMNI_BUCKET_PRICING.maxSelfServeBuckets + 1; // Buckets 1–5

function formatIntervalUnit(interval: SubscriptionInterval): string {
  return interval === "month" ? "mo" : "yr";
}

function formatTotal(cents: number, interval: SubscriptionInterval): string {
  return `$${(cents / 100).toFixed(0)}/${formatIntervalUnit(interval)}`;
}

function getOrgCostLabel(
  orgCount: number,
  interval: SubscriptionInterval
): string {
  const billable = Math.max(0, orgCount - ENTERPRISE_SEAT_PRICING.freeSubOrgs);
  if (billable === 0) return "Free!";
  const unitCents =
    interval === "month"
      ? ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly
      : ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;
  return `${formatSeatPrice(billable * unitCents)}/${formatIntervalUnit(interval)}`;
}

function getBucketPriceLabel(
  bucket: number,
  interval: SubscriptionInterval
): string {
  if (isSalesLed(bucket)) return "Contact Sales";
  const unitCents =
    interval === "month"
      ? ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket
      : ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket;
  return `${formatSeatPrice(bucket * unitCents)}/${formatIntervalUnit(interval)}`;
}

export function EnterprisePricingModal({
  open,
  onClose,
  interval,
}: EnterprisePricingModalProps) {
  const [orgCount, setOrgCount] = useState(3);
  const [bucketCount, setBucketCount] = useState(1);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while modal is open so page content can't scroll behind it
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const pricing = getEnterpriseTotalPricing(bucketCount, orgCount, interval);
  const salesLed = isSalesLed(bucketCount);
  const billableOrgs = Math.max(0, orgCount - ENTERPRISE_SEAT_PRICING.freeSubOrgs);
  const freeOrgs = Math.min(orgCount, ENTERPRISE_SEAT_PRICING.freeSubOrgs);
  const orgCostLabel = getOrgCostLabel(orgCount, interval);

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enterprise-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none overscroll-contain"
      >
        <div className="modal-panel rounded-2xl p-8 w-full max-w-lg pointer-events-auto modal-enter relative">
          {/* Enterprise badge */}
          <div className="pick-badge enterprise-badge">Enterprise</div>

          {/* Header */}
          <div className="flex items-start justify-between mb-8 mt-4">
            <div>
              <h2
                id="enterprise-modal-title"
                className="font-display text-2xl font-bold text-landing-cream"
              >
                Enterprise Pricing
              </h2>
              <p className="text-landing-cream/50 text-sm mt-1">
                {interval === "month" ? "Monthly" : "Yearly"} billing
              </p>
            </div>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="text-landing-cream/40 hover:text-landing-cream/80 transition-colors p-1 -mr-1 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-green/50 rounded-lg"
              aria-label="Close enterprise pricing dialog"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Sub-org stepper */}
          <div className="bg-landing-navy/60 rounded-xl p-5 mb-4 border border-landing-cream/10">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-landing-cream font-semibold text-sm">
                  Managed Organizations
                </h3>
                <p className="text-landing-cream/40 text-xs mt-0.5">
                  First {ENTERPRISE_SEAT_PRICING.freeSubOrgs} FREE &middot;{" "}
                  {interval === "month" ? "$15/mo" : "$150/yr"} each additional
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setOrgCount((c) => Math.max(1, c - 1))}
                  className="w-8 h-8 rounded-lg bg-landing-navy-light border border-landing-cream/10 text-landing-cream hover:border-landing-cream/30 transition-[border-color,opacity] flex items-center justify-center text-lg leading-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-green/50"
                  aria-label="Decrease organization count"
                  disabled={orgCount <= 1}
                >
                  &minus;
                </button>
                <span className="text-landing-cream text-xl w-7 text-center">
                  {orgCount}
                </span>
                <button
                  onClick={() => setOrgCount((c) => c + 1)}
                  className="w-8 h-8 rounded-lg bg-landing-navy-light border border-landing-cream/10 text-landing-cream hover:border-landing-cream/30 transition-[border-color] flex items-center justify-center text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-green/50"
                  aria-label="Increase organization count"
                >
                  +
                </button>
                <span
                  className={`text-sm min-w-[72px] text-right ${
                    billableOrgs === 0
                      ? "text-landing-green"
                      : "text-landing-cream"
                  }`}
                >
                  {orgCostLabel}
                </span>
              </div>
            </div>
            {billableOrgs > 0 && (
              <p className="text-landing-cream/40 text-xs mt-2">
                {freeOrgs} free + {billableOrgs} additional
              </p>
            )}
          </div>

          {/* Alumni bucket selector */}
          <div className="bg-landing-navy/60 rounded-xl p-5 mb-6 border border-landing-cream/10">
            <h3 className="text-landing-cream font-semibold text-sm mb-0.5">
              Alumni Capacity
            </h3>
            <p className="text-landing-cream/40 text-xs mb-4">
              2,500 alumni per bucket
            </p>
            <div className="space-y-2" role="radiogroup" aria-label="Alumni bucket size">
              {Array.from({ length: BUCKET_ROWS }, (_, i) => i + 1).map(
                (bucket) => {
                  const selected = bucket === bucketCount;
                  const salesBucket = isSalesLed(bucket);
                  const priceLabel = getBucketPriceLabel(bucket, interval);

                  return (
                    <button
                      key={bucket}
                      role="radio"
                      onClick={() => setBucketCount(bucket)}
                      className={`w-full flex items-center justify-between rounded-lg px-4 py-3 border text-sm transition-[border-color,background-color] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-green/50 ${
                        selected
                          ? "bucket-row-selected"
                          : "border-landing-cream/10 hover:border-landing-cream/20"
                      }`}
                      aria-checked={selected}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-[border-color,background-color] ${
                            selected
                              ? "border-landing-green bg-landing-green"
                              : "border-landing-cream/30"
                          }`}
                        />
                        <span className="text-landing-cream/70">
                          Bucket {bucket} &middot; {formatBucketRange(bucket)} alumni
                        </span>
                      </div>
                      <span
                        className={`font-semibold ${
                          salesBucket ? "text-amber-400" : "text-landing-cream"
                        }`}
                      >
                        {priceLabel}
                      </span>
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* Total + CTA */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-landing-cream/40 text-xs uppercase tracking-wider mb-1">
                Total
              </p>
              {salesLed ? (
                <p className="text-xl font-bold text-amber-400">
                  Contact Sales
                </p>
              ) : (
                <p className="text-2xl font-bold text-landing-cream">
                  {formatTotal(pricing.totalCents, interval)}
                </p>
              )}
            </div>
            {salesLed ? (
              <a
                href="/contact"
                className="bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 font-semibold py-3 px-6 rounded-xl transition-[background-color] text-sm"
              >
                Contact Sales &rarr;
              </a>
            ) : (
              <a
                href="/auth/signup"
                className="bg-landing-green-dark hover:bg-landing-green-dark/90 text-white font-semibold py-3 px-6 rounded-xl transition-[background-color] text-sm"
              >
                Get Started &rarr;
              </a>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
