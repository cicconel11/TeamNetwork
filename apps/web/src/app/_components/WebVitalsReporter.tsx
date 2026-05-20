"use client";

import { useReportWebVitals } from "next/web-vitals";

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") return;
    console.info(
      "[web-vitals]",
      metric.name,
      metric.value.toFixed(2),
      metric.id,
    );
  });
  return null;
}
