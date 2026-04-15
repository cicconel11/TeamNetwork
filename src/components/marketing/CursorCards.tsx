"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";

type CursorCardsContainerProps = {
  children: React.ReactNode;
  className?: string;
  proximityRange?: number;
};

type CursorCardProps = {
  children?: React.ReactNode;
  className?: string;
  illuminationRadius?: number;
};

type InternalCursorCardProps = CursorCardProps & {
  globalMouseX?: number;
  globalMouseY?: number;
  isWithinRange?: boolean;
};

function useMousePosition(proximityRange: number) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [mouseState, setMouseState] = useState({
    mousePositionX: 0,
    mousePositionY: 0,
    isWithinRange: false,
  });

  const handlePointerMovement = useCallback(
    (event: PointerEvent) => {
      if (!wrapperRef.current) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      const { clientX, clientY } = event;

      const isInProximity =
        clientX >= bounds.left - proximityRange &&
        clientX <= bounds.right + proximityRange &&
        clientY >= bounds.top - proximityRange &&
        clientY <= bounds.bottom + proximityRange;

      setMouseState({
        mousePositionX: clientX,
        mousePositionY: clientY,
        isWithinRange: isInProximity,
      });
    },
    [proximityRange]
  );

  useEffect(() => {
    document.addEventListener("pointermove", handlePointerMovement);
    return () =>
      document.removeEventListener("pointermove", handlePointerMovement);
  }, [handlePointerMovement]);

  return { wrapperRef, mouseState };
}

function useCardActivation(
  elementRef: React.RefObject<HTMLDivElement | null>,
  globalMouseX: number,
  globalMouseY: number,
  isWithinRange: boolean,
  illuminationRadius: number
) {
  const localMouseX = useMotionValue(-illuminationRadius);
  const localMouseY = useMotionValue(-illuminationRadius);
  const [isCardActive, setIsCardActive] = useState(false);

  useEffect(() => {
    if (!elementRef.current || !isWithinRange) {
      setIsCardActive(false);
      localMouseX.set(-illuminationRadius);
      localMouseY.set(-illuminationRadius);
      return;
    }

    const rect = elementRef.current.getBoundingClientRect();
    const extendedProximity = 120;

    const isNearCard =
      globalMouseX >= rect.left - extendedProximity &&
      globalMouseX <= rect.right + extendedProximity &&
      globalMouseY >= rect.top - extendedProximity &&
      globalMouseY <= rect.bottom + extendedProximity;

    setIsCardActive(isNearCard);

    if (isNearCard) {
      localMouseX.set(globalMouseX - rect.left);
      localMouseY.set(globalMouseY - rect.top);
    } else {
      localMouseX.set(-illuminationRadius);
      localMouseY.set(-illuminationRadius);
    }
  }, [
    elementRef,
    globalMouseX,
    globalMouseY,
    isWithinRange,
    illuminationRadius,
    localMouseX,
    localMouseY,
  ]);

  return { localMouseX, localMouseY, isCardActive };
}

export function CursorCardsContainer({
  children,
  className = "",
  proximityRange = 500,
}: CursorCardsContainerProps) {
  const { wrapperRef, mouseState } = useMousePosition(proximityRange);

  const enhancedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type === CursorCard) {
      return React.cloneElement(
        child as React.ReactElement<InternalCursorCardProps>,
        {
          globalMouseX: mouseState.mousePositionX,
          globalMouseY: mouseState.mousePositionY,
          isWithinRange: mouseState.isWithinRange,
        }
      );
    }
    return child;
  });

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {enhancedChildren}
    </div>
  );
}

export function CursorCard({
  children,
  className = "",
  illuminationRadius = 260,
  globalMouseX = 0,
  globalMouseY = 0,
  isWithinRange = false,
}: InternalCursorCardProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const { localMouseX, localMouseY, isCardActive } = useCardActivation(
    elementRef,
    globalMouseX,
    globalMouseY,
    isWithinRange,
    illuminationRadius
  );

  const borderGradient = useMotionTemplate`
    radial-gradient(${illuminationRadius}px circle at ${localMouseX}px ${localMouseY}px,
    rgba(34, 197, 94, 0.55),
    rgba(255, 255, 255, 0.22) 35%,
    rgba(255, 255, 255, 0.06) 100%)
  `;

  const spotlightGradient = useMotionTemplate`
    radial-gradient(${illuminationRadius}px circle at ${localMouseX}px ${localMouseY}px,
    rgba(34, 197, 94, 0.10),
    transparent 70%)
  `;

  return (
    <div
      ref={elementRef}
      className={`group relative rounded-2xl ${className}`}
    >
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ background: borderGradient }}
      />
      <div className="absolute inset-px rounded-[inherit] bg-landing-navy-light/70 backdrop-blur-sm" />
      <motion.div
        className={`pointer-events-none absolute inset-px rounded-[inherit] transition-opacity duration-300 ${
          isCardActive ? "opacity-100" : "opacity-0"
        }`}
        style={{ background: spotlightGradient }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
