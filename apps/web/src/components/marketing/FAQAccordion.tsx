"use client";

import { useState, useRef, useCallback } from "react";

interface FAQItem {
  question: string;
  answer: string;
}

export function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = useCallback((index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  }, []);

  return (
    <div className="border-t border-white/10">
      {items.map((item, index) => (
        <FAQAccordionItem
          key={item.question}
          item={item}
          isOpen={openIndex === index}
          onToggle={() => toggle(index)}
        />
      ))}
    </div>
  );
}

function FAQAccordionItem({
  item,
  isOpen,
  onToggle,
}: {
  item: FAQItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className="scroll-reveal border-b border-white/10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group flex w-full items-center gap-4 py-6 text-left text-lg font-medium text-landing-cream/90 transition-colors hover:text-landing-cream"
      >
        <span className="flex-1">{item.question}</span>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-landing-cream/40 transition-transform duration-300 group-hover:text-landing-green ${isOpen ? "rotate-45" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
      <div
        ref={contentRef}
        className="faq-content-wrapper"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="max-w-2xl pb-7 text-base leading-relaxed text-landing-cream/55">
            {item.answer}
          </div>
        </div>
      </div>
    </div>
  );
}
