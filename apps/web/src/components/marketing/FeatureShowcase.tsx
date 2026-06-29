"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  CHAPTER_META,
  SHOWCASE_STEPS,
  type ShowcaseChapter,
  type ShowcaseStep,
} from "./showcase-steps";
import { AssistantDemo } from "./AssistantDemo";
import { MatchingDemo } from "./MatchingDemo";

// How long each view holds before auto-advancing to the next. Demo steps run a
// longer animated timeline (the assistant plays two scenarios), so they hold
// longer than a static screenshot.
const AUTO_MS = 5500;
const AUTO_MS_DEMO = 15000;
const holdFor = (step: ShowcaseStep) => (step.kind === "demo" ? AUTO_MS_DEMO : AUTO_MS);

// Short segment labels (the full titles are used for the device/description copy).
const TAB_LABEL: Record<string, string> = {
  "Network Directory": "Directory",
  "Enriched Profiles": "Profiles",
  "Shared History": "History",
  "AI Assistant": "AI Assistant",
  "Smart Matching": "Matching",
  "Team Events": "Events",
  "Communication": "Messages",
  "Jobs": "Jobs",
};

// Contiguous chapter groups, preserving array order (chapters stay together).
const CHAPTER_GROUPS = SHOWCASE_STEPS.reduce<
  { chapter: ShowcaseStep["chapter"]; items: ShowcaseStep[] }[]
>((groups, step) => {
  const last = groups[groups.length - 1];
  if (last && last.chapter === step.chapter) last.items.push(step);
  else groups.push({ chapter: step.chapter, items: [step] });
  return groups;
}, []);

// Stable, collision-free id fragment per chapter (three tablists on one page).
const slug = (chapter: ShowcaseChapter) =>
  chapter.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// Split a headline so its last word can render with the italic accent.
function splitHeadline(headline: string): [string, string] {
  const i = headline.lastIndexOf(" ");
  if (i === -1) return ["", headline];
  return [headline.slice(0, i), headline.slice(i + 1)];
}

function DeviceChrome({ path }: { path: string }) {
  return (
    <div className="app-window-bar">
      <span className="app-window-dot" />
      <span className="app-window-dot" />
      <span className="app-window-dot" />
      <span className="ml-2 truncate rounded-md bg-white/[0.04] px-3 py-1 text-xs text-landing-cream/40">
        app.myteamnetwork.com
        <span className="text-landing-cream/25">{path}</span>
      </span>
    </div>
  );
}

function StepContent({ step, play }: { step: ShowcaseStep; play: boolean }) {
  if (step.kind === "image") {
    return (
      <Image
        src={step.src}
        alt={step.alt}
        fill
        quality={90}
        sizes="(min-width: 1024px) 1200px, 100vw"
        className="object-cover object-top"
      />
    );
  }
  return step.demo === "assistant" ? (
    <AssistantDemo play={play} />
  ) : (
    <MatchingDemo play={play} />
  );
}

/**
 * One feature panel (air.inc-style hero): a centered text header on top, one big
 * full-width app-window below it as the hero, and the chapter's segmented control
 * centered beneath. Each block owns its own auto-advance and pause state, so the
 * three blocks rotate independently.
 */
function FeatureBlock({
  chapter,
  items,
}: {
  chapter: ShowcaseChapter;
  items: ShowcaseStep[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Respect reduced-motion: no auto-advance.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Auto-advance, re-armed after every change so a manual pick gets a full hold.
  // Demo steps hold longer so their animated timeline can play through.
  useEffect(() => {
    if (paused || reduced || items.length < 2) return;
    const id = setTimeout(
      () => setActiveIndex((i) => (i + 1) % items.length),
      holdFor(items[activeIndex]),
    );
    return () => clearTimeout(id);
  }, [activeIndex, paused, reduced, items]);

  const select = (i: number, focus = false) => {
    const next = (i + items.length) % items.length;
    setActiveIndex(next);
    if (focus) tabRefs.current[next]?.focus();
  };

  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      select(activeIndex + 1, true);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      select(activeIndex - 1, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      select(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      select(items.length - 1, true);
    }
  };

  const id = slug(chapter);
  const active = items[activeIndex];
  const [headLead, headTail] = splitHeadline(CHAPTER_META[chapter].headline);

  return (
    <div
      className="feature-block"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Centered text header */}
      <div className="feature-block__text">
        <span className="showcase-chapter">{chapter}</span>
        <h3 className="feature-block__headline">
          {headLead ? `${headLead} ` : ""}
          <span className="accent-italic">{headTail}</span>
        </h3>
        {/* Active step description (no aria-live — avoids announcing on auto-rotate) */}
        <p className="showcase-desc">{active.desc}</p>
      </div>

      {/* The hero — one big full-width app-window */}
      <div
        className="feature-block__media showcase-device"
        role="tabpanel"
        id={`showcase-panel-${id}`}
        aria-labelledby={`showcase-tab-${id}-${activeIndex}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-24 -z-10 bg-[radial-gradient(55%_55%_at_50%_35%,rgba(34,197,94,0.16),transparent_70%)]"
        />
        <div className="app-window flex flex-col">
          <DeviceChrome path={active.path} />
          <div className="showcase-body relative overflow-hidden bg-[#0b0c0f]">
            {items.map((step, i) => {
              const isActive = i === activeIndex;
              return (
                <div
                  key={step.title}
                  aria-hidden={!isActive}
                  className={`absolute inset-0 transition-[opacity,transform] duration-500 ease-out ${
                    isActive
                      ? "z-10 scale-100 opacity-100"
                      : "pointer-events-none scale-[1.02] opacity-0"
                  }`}
                >
                  <StepContent step={step} play={isActive} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Segmented control centered below the hero */}
      <div
        role="tablist"
        aria-label={`${chapter} features`}
        className="showcase-segment"
        onKeyDown={onTabKeyDown}
      >
        {items.map((step, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={step.title}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`showcase-tab-${id}-${i}`}
              aria-selected={isActive}
              aria-controls={`showcase-panel-${id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => select(i)}
              className={`showcase-tab ${isActive ? "showcase-tab--on" : ""}`}
            >
              {TAB_LABEL[step.title] ?? step.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * air.inc-style product showcase: three stacked feature panels, one per chapter,
 * each a big centered hero window driven by its own segmented control. Each panel
 * rotates independently. No scroll-pinning.
 */
export function FeatureShowcase() {
  return (
    <div className="showcase-stack">
      {CHAPTER_GROUPS.map((group) => (
        <FeatureBlock
          key={group.chapter}
          chapter={group.chapter}
          items={group.items}
        />
      ))}
    </div>
  );
}
