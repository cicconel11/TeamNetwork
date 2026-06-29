"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * Hand-built, looping demo of the AI assistant — grounded in the REAL product.
 * A controlled timed state machine (no video) cycles through two authentic
 * scenarios so the tool calls are visible "in action":
 *   (1) a network lookup with the real `list_alumni` read tool that returns a
 *       result list, and
 *   (2) a write request that calls the real `prepare_announcement` tool, which is
 *       confirmation-gated: it returns a pending action the user must confirm
 *       (mirrors src/components/ai-assistant/PendingActionCard.tsx) before anything
 *       publishes — so the demo ends on Confirm → Published, not an auto-send.
 * Tool names/args match src/lib/ai/tools/definitions.ts. Plays only while `play`
 * (the active tab); pauses + resets otherwise. Under prefers-reduced-motion it
 * renders the resolved frame of scenario 1 statically, with no looping.
 */

type ToolCall = {
  fn: string;
  args: string;
  result: string;
};

type ResultRow = { name: string; sub: string };

type ConfirmCard = {
  summary: string;
  fields: { label: string; value: string }[];
  published: string;
};

type Scenario = {
  query: string;
  tools: ToolCall[];
  answer: string;
  results?: ResultRow[];
  confirm?: ConfirmCard;
};

const SCENARIOS: Scenario[] = [
  {
    query: "Which alumni work in finance in New York?",
    tools: [
      {
        fn: "list_alumni",
        args: '{ industry: "Finance", city: "New York" }',
        result: "12 alumni",
      },
    ],
    answer: "Found 12 alumni in finance around New York — here are a few to reach out to.",
    results: [
      { name: "Priya Nair", sub: "VP · Goldman Sachs" },
      { name: "Marcus Bell", sub: "Portfolio Manager · Citadel" },
      { name: "Dana Cho", sub: "Analyst · Evercore" },
    ],
  },
  {
    query: "Draft an announcement for Thursday's alumni mixer at 7 PM.",
    tools: [
      {
        fn: "prepare_announcement",
        args: '{ audience: "alumni", send_notification: true }',
        result: "draft ready",
      },
    ],
    answer: "Here's a draft ready to publish — review and confirm.",
    confirm: {
      summary: "Create announcement",
      fields: [
        { label: "Title", value: "Alumni Mixer — Thursday 7 PM" },
        { label: "Audience", value: "Alumni" },
        { label: "Notify members", value: "Yes" },
      ],
      published: "Published",
    },
  },
];

// Discrete frames within one scenario. Each entry holds for `hold` ms.
type Frame =
  | { type: "query" }
  | { type: "thinking" }
  | { type: "tool"; index: number; state: "running" | "done" }
  | { type: "answer"; words: number }
  | { type: "result" }
  | { type: "confirmed" }
  | { type: "hold" };

function buildTimeline(s: Scenario): { frame: Frame; hold: number }[] {
  const answerWords = s.answer.split(" ").length;
  const frames: { frame: Frame; hold: number }[] = [
    { frame: { type: "query" }, hold: 900 },
    { frame: { type: "thinking" }, hold: 700 },
  ];
  s.tools.forEach((_, i) => {
    frames.push({ frame: { type: "tool", index: i, state: "running" }, hold: 650 });
    frames.push({ frame: { type: "tool", index: i, state: "done" }, hold: 500 });
  });
  // Stream the answer a few words at a time.
  for (let w = 2; w <= answerWords; w += 2) {
    frames.push({ frame: { type: "answer", words: Math.min(w, answerWords) }, hold: 95 });
  }
  frames.push({ frame: { type: "answer", words: answerWords }, hold: 200 });
  // Read scenarios rest on the result; write scenarios then "confirm" → publish.
  frames.push({ frame: { type: "result" }, hold: s.confirm ? 1800 : 1500 });
  if (s.confirm) {
    frames.push({ frame: { type: "confirmed" }, hold: 1800 });
  }
  return frames;
}

export function AssistantDemo({ play = false }: { play?: boolean }) {
  const reduced = usePrefersReducedMotion();
  // Position in the global (scenario, frame) timeline.
  const [pos, setPos] = useState({ s: 0, f: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!play || reduced) return;
    // Restart whenever play turns on.
    setPos({ s: 0, f: 0 });
    let cur = { s: 0, f: 0 };
    const timelines = SCENARIOS.map(buildTimeline);

    const advance = () => {
      const tl = timelines[cur.s];
      const hold = tl[cur.f].hold;
      timer.current = setTimeout(() => {
        let nf = cur.f + 1;
        let ns = cur.s;
        if (nf >= tl.length) {
          nf = 0;
          ns = (cur.s + 1) % SCENARIOS.length;
        }
        cur = { s: ns, f: nf };
        setPos(cur);
        advance();
      }, hold);
    };
    advance();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [play, reduced]);

  const scenario = SCENARIOS[pos.s];
  const timeline = buildTimeline(scenario);
  const frame = reduced
    ? ({ type: "result" } as Frame)
    : timeline[pos.f]?.frame ?? ({ type: "query" } as Frame);

  // Derive what's visible from the current frame.
  const frameIndex = pos.f;
  const showThinking =
    frame.type === "thinking" ||
    (frame.type === "tool" && frame.state === "running" && frame.index === 0 && frameIndex <= 3);

  const toolStates = scenario.tools.map((_, i) => {
    if (reduced) return "done" as const;
    // Walk the timeline up to the current frame to know each tool's state.
    let st: "idle" | "running" | "done" = "idle";
    for (let k = 0; k <= pos.f; k++) {
      const fr = timeline[k]?.frame;
      if (fr && fr.type === "tool" && fr.index === i) st = fr.state;
    }
    // Tools before an answer/result frame are all done.
    if (frame.type === "answer" || frame.type === "result" || frame.type === "confirmed")
      st = "done";
    return st;
  });

  const resolved = frame.type === "result" || frame.type === "confirmed";
  const answerVisible = reduced || frame.type === "answer" || resolved;
  const answerWordCount =
    reduced || resolved
      ? scenario.answer.split(" ").length
      : frame.type === "answer"
        ? frame.words
        : 0;
  const streaming = !reduced && frame.type === "answer";
  const answerText = scenario.answer.split(" ").slice(0, answerWordCount).join(" ");
  const resultVisible = reduced || resolved;
  const confirmed = !reduced && frame.type === "confirmed";

  return (
    <div className="aidemo aidemo--assistant" aria-hidden="true">
      <div className="aidemo-head">
        <span className="aidemo-spark" />
        Assistant
        <span className="aidemo-head-org">South Rock Ridge</span>
      </div>

      <div className="aidemo-thread">
        {/* User query */}
        <div className="aidemo-row aidemo-row--user" key={`q-${pos.s}`}>
          <div className="aidemo-bubble aidemo-bubble--user">{scenario.query}</div>
        </div>

        {/* Assistant turn */}
        <div className="aidemo-row aidemo-row--bot">
          <div className="aidemo-bot">
            {showThinking && (
              <div className="aidemo-thinking">
                <span /> <span /> <span />
              </div>
            )}

            <div className="aidemo-tools">
              {scenario.tools.map((t, i) => {
                const st = toolStates[i];
                if (st === "idle") return null;
                return (
                  <div className={`aidemo-tool aidemo-tool--${st}`} key={`${pos.s}-${i}`}>
                    <span className="aidemo-tool-status" aria-hidden="true" />
                    <code className="aidemo-tool-call">
                      <span className="aidemo-fn">{t.fn}</span>
                      <span className="aidemo-args">{t.args}</span>
                    </code>
                    {st === "done" && <span className="aidemo-tool-result">{t.result}</span>}
                  </div>
                );
              })}
            </div>

            {answerVisible && (
              <div className="aidemo-answer">
                {answerText}
                {streaming && <span className="aidemo-caret" />}
              </div>
            )}

            {/* Read result: a compact list mirroring list_alumni rows. */}
            {resultVisible && scenario.results && (
              <div className="aidemo-result-list">
                {scenario.results.map((r) => (
                  <div className="aidemo-result-row" key={r.name}>
                    <span className="aidemo-result-avatar" aria-hidden="true">
                      {r.name
                        .split(" ")
                        .map((p) => p[0])
                        .join("")}
                    </span>
                    <span className="aidemo-result-name">{r.name}</span>
                    <span className="aidemo-result-sub">{r.sub}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Write result: a confirmation card (pending action) → Confirm → Published. */}
            {resultVisible && scenario.confirm && (
              <div className={`aidemo-confirm${confirmed ? " is-published" : ""}`}>
                <div className="aidemo-confirm-head">
                  <span className="aidemo-confirm-title">{scenario.confirm.summary}</span>
                  <span className="aidemo-confirm-tag">Needs confirmation</span>
                </div>
                <div className="aidemo-confirm-fields">
                  {scenario.confirm.fields.map((f) => (
                    <div className="aidemo-confirm-field" key={f.label}>
                      <span className="aidemo-confirm-label">{f.label}</span>
                      <span className="aidemo-confirm-value">{f.value}</span>
                    </div>
                  ))}
                </div>
                <div className="aidemo-confirm-actions">
                  <span className={`aidemo-btn aidemo-btn--confirm${confirmed ? " is-pressed" : ""}`}>
                    Confirm
                  </span>
                  <span className="aidemo-btn aidemo-btn--ghost">Cancel</span>
                </div>
                <div className="aidemo-confirm-published">
                  <span className="aidemo-card-check" aria-hidden="true" />
                  {scenario.confirm.published}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
