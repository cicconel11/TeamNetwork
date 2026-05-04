"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { quote } from "@/lib/pricing-v2";
import type { SubscriptionInterval } from "@/types/database";

interface EnterprisePricingModalProps {
  open: boolean;
  onClose: () => void;
  interval: SubscriptionInterval;
}

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatIntervalUnit(interval: SubscriptionInterval): string {
  return interval === "month" ? "mo" : "yr";
}

function formatCents(cents: number): string {
  return currencyFmt.format(cents / 100);
}

function formatTotal(cents: number, interval: SubscriptionInterval): string {
  return `${formatCents(cents)}/${formatIntervalUnit(interval)}`;
}

export function EnterprisePricingModal({
  open,
  onClose,
  interval,
}: EnterprisePricingModalProps) {
  const [orgCount, setOrgCount] = useState(15);
  const [activeCount, setActiveCount] = useState(1_000);
  const [alumniCount, setAlumniCount] = useState(20_000);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const pricing = useMemo(
    () => quote({ tier: "enterprise", actives: activeCount, alumni: alumniCount, subOrgs: orgCount }),
    [activeCount, alumniCount, orgCount],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

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

  const displayCents = interval === "year" ? pricing.yearlyCents : pricing.monthlyCents;

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/80 z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enterprise-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none overscroll-contain"
      >
        <div className="modal-panel rounded-2xl p-8 w-full max-w-lg pointer-events-auto modal-enter relative">
          <div className="pick-badge enterprise-badge">Enterprise</div>

          <div className="flex items-start justify-between mb-8 mt-4">
            <div>
              <h2
                id="enterprise-modal-title"
                className="font-display text-2xl font-bold text-landing-cream"
              >
                Enterprise Pricing
              </h2>
              <p className="text-landing-cream/50 text-sm mt-1">
                {interval === "month" ? "Monthly" : "Yearly"} billing · 17% yearly discount
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

          <CounterCard
            title="Managed Organizations"
            helper="First 10 at $20/mo each · additional orgs at $15/mo each"
            value={orgCount}
            min={1}
            onChange={setOrgCount}
            sideLabel={formatCents(pricing.breakdown.subOrgMonthlyCents) + "/mo"}
          />

          <CounterCard
            title="Active Members"
            helper="Volume rate shown below follows the public team pricing table"
            value={activeCount}
            min={0}
            step={50}
            onChange={setActiveCount}
            sideLabel={`${formatCents(pricing.breakdown.activeRateCents)}/mo each`}
          />

          <CounterCard
            title="Alumni"
            helper="Volume rate shown below follows the public team pricing table"
            value={alumniCount}
            min={0}
            step={500}
            onChange={setAlumniCount}
            sideLabel={`${formatCents(pricing.breakdown.alumniRateCents)}/mo each`}
          />

          <div className="rounded-xl bg-landing-navy/60 p-5 mb-6 border border-landing-cream/10">
            <h3 className="text-landing-cream font-semibold text-sm mb-3">
              Breakdown
            </h3>
            <ul className="space-y-2 text-sm">
              <BreakdownRow label="Base fee" value={`${formatCents(pricing.breakdown.platformBaseCents)}/mo`} />
              <BreakdownRow label="Org fees" value={`${formatCents(pricing.breakdown.subOrgMonthlyCents)}/mo`} />
              <BreakdownRow label="Active cost" value={`${formatCents(pricing.breakdown.activeMonthlyCents)}/mo`} />
              <BreakdownRow label="Alumni cost" value={`${formatCents(pricing.breakdown.alumniMonthlyCents)}/mo`} />
            </ul>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-landing-cream/40 text-xs uppercase tracking-wider mb-1">
                Total
              </p>
              {pricing.salesLed ? (
                <p className="text-xl font-bold text-landing-green">
                  Contact Sales
                </p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-landing-cream">
                    {formatTotal(displayCents, interval)}
                  </p>
                  {interval === "year" && (
                    <p className="text-xs text-landing-cream/50 mt-1">
                      17% off monthly · {formatCents(Math.round(pricing.yearlyCents / 12))}/mo effective
                    </p>
                  )}
                </>
              )}
            </div>
            {pricing.salesLed ? (
              <a
                href="/contact"
                className="bg-landing-green/20 hover:bg-landing-green/30 border border-landing-green/40 text-landing-green font-semibold py-3 px-6 rounded-xl transition-[background-color] text-sm"
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
    document.body,
  );
}

function CounterCard({
  title,
  helper,
  value,
  min,
  step = 1,
  sideLabel,
  onChange,
}: {
  title: string;
  helper: string;
  value: number;
  min: number;
  step?: number;
  sideLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="bg-landing-navy/60 rounded-xl p-5 mb-4 border border-landing-cream/10">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-landing-cream font-semibold text-sm">
            {title}
          </h3>
          <p className="text-landing-cream/40 text-xs mt-0.5">
            {helper}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onChange(Math.max(min, value - step))}
            className="w-8 h-8 rounded-lg bg-landing-navy-light border border-landing-cream/10 text-landing-cream hover:border-landing-cream/30 transition-[border-color,opacity] flex items-center justify-center text-lg leading-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-green/50"
            aria-label={`Decrease ${title.toLowerCase()}`}
            disabled={value <= min}
          >
            &minus;
          </button>
          <span className="text-landing-cream text-xl min-w-16 text-center tabular-nums">
            {value.toLocaleString()}
          </span>
          <button
            onClick={() => onChange(value + step)}
            className="w-8 h-8 rounded-lg bg-landing-navy-light border border-landing-cream/10 text-landing-cream hover:border-landing-cream/30 transition-[border-color] flex items-center justify-center text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-green/50"
            aria-label={`Increase ${title.toLowerCase()}`}
          >
            +
          </button>
          <span className="text-sm min-w-[96px] text-right text-landing-cream">
            {sideLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between items-baseline border-b border-landing-cream/5 pb-2 last:border-0">
      <span className="text-landing-cream/70">{label}</span>
      <span className="font-semibold text-landing-cream">{value}</span>
    </li>
  );
}
