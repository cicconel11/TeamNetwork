"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * Hand-built, looping demo of AI mentor matching — replaces the old screen-recording.
 * A `rank_mentors()` tool call runs, then candidate rows reveal with score bars that
 * fill to their value, confidence labels, and reason chips; the top match gets a
 * highlight. Plays only while `play`; pauses + resets otherwise. Under
 * prefers-reduced-motion it shows the settled board statically.
 */

type Candidate = {
  name: string;
  role: string;
  score: number;
  label: "High" | "Good" | "Moderate";
  reasons: string[];
};

const MENTEE = "Jordan Blake '25";

// Reason labels are the product's real strings (REASON_LABELS in
// src/lib/mentorship/presentation.ts); scores use the real confidence bands from
// confidenceLabel(): High ≥85, Good ≥65, Moderate ≥45.
const CANDIDATES: Candidate[] = [
  {
    name: "Priya Nair",
    role: "VP, Goldman Sachs",
    score: 92,
    label: "High",
    reasons: ["Walked your path", "Same school", "Shared industry"],
  },
  {
    name: "Marcus Bell",
    role: "Portfolio Manager, Citadel",
    score: 81,
    label: "Good",
    reasons: ["Shared industry", "Graduation gap fit", "Skills you want"],
  },
  {
    name: "Dana Cho",
    role: "Analyst, Evercore",
    score: 67,
    label: "Good",
    reasons: ["Same school", "Shared role family"],
  },
  {
    name: "Leo Park",
    role: "Founder, Northgate Capital",
    score: 54,
    label: "Moderate",
    reasons: ["Shared industry"],
  },
];

// phase 0: ranking; 1: rows + bars fill; 2: best-match highlight settled
export function MatchingDemo({ play = false }: { play?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!play || reduced) return;
    setPhase(0);
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const loop = () => {
      clear();
      setPhase(0);
      timers.current.push(setTimeout(() => setPhase(1), 850));
      timers.current.push(setTimeout(() => setPhase(2), 2100));
      timers.current.push(setTimeout(loop, 11000));
    };
    loop();
    return clear;
  }, [play, reduced]);

  const ranked = reduced || phase >= 1;
  const settled = reduced || phase >= 2;
  const chipDone = reduced || phase >= 1;

  return (
    <div className="aidemo aidemo--matching" aria-hidden="true">
      <div className="aidemo-head">
        <span className="aidemo-spark" />
        Smart Matching
        <span className="aidemo-head-org">Mentorship</span>
      </div>

      <div className="aidemo-match-body">
        <div className="aidemo-mentee">
          Ranking mentors for <strong>{MENTEE}</strong>
        </div>

        <div className={`aidemo-tool aidemo-tool--${chipDone ? "done" : "running"} aidemo-tool--wide`}>
          <span className="aidemo-tool-status" aria-hidden="true" />
          <code className="aidemo-tool-call">
            <span className="aidemo-fn">suggest_mentors</span>
            <span className="aidemo-args">{`{ mentee_query: "${MENTEE}" }`}</span>
          </code>
          {chipDone && <span className="aidemo-tool-result">4 mentors</span>}
        </div>

        <div className="aidemo-rows">
          {CANDIDATES.map((c, i) => {
            const isBest = i === 0;
            return (
              <div
                className={`aidemo-mrow${ranked ? " is-in" : ""}${settled && isBest ? " is-best" : ""}`}
                style={{ transitionDelay: `${i * 90}ms` }}
                key={c.name}
              >
                <span className="aidemo-avatar" aria-hidden="true">
                  {c.name
                    .split(" ")
                    .map((p) => p[0])
                    .join("")}
                </span>

                <div className="aidemo-mrow-main">
                  <div className="aidemo-mrow-top">
                    <span className="aidemo-mname">{c.name}</span>
                    {settled && isBest && <span className="aidemo-best">Best match</span>}
                    {settled && isBest && (
                      <span className="aidemo-pair">Confirm pairing</span>
                    )}
                  </div>
                  <div className="aidemo-mrole">{c.role}</div>
                  <div className="aidemo-reasons">
                    {c.reasons.map((r) => (
                      <span className={`aidemo-reason${ranked ? " is-in" : ""}`} key={r}>
                        {r}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="aidemo-score">
                  <div className="aidemo-score-num">
                    {ranked ? c.score : 0}
                    <span className="aidemo-score-label">{c.label}</span>
                  </div>
                  <div className="aidemo-bar">
                    <span
                      className="aidemo-bar-fill"
                      style={{ width: ranked ? `${c.score}%` : "0%" }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
