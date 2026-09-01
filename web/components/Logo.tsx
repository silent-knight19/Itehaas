"use client";
import React from "react";
import Image from "next/image";

interface LogoProps {
  variant?: "mark" | "full";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  priority?: boolean;
}

const SIZES = {
  sm: { mark: 18, fullW: 64, fullH: 22 },
  md: { mark: 24, fullW: 88, fullH: 30 },
  lg: { mark: 36, fullW: 120, fullH: 42 },
  xl: { mark: 48, fullW: 160, fullH: 56 },
};

export function Logo({
  variant = "mark",
  size = "md",
  className = "",
  priority = false,
}: LogoProps) {
  const dimensions = SIZES[size];

  if (variant === "full") {
    return (
      <div className={`relative inline-flex items-center shrink-0 ${className}`}>
        <Image
          src="/itehaas-full.png"
          alt="Itehaas Logo"
          width={dimensions.fullW}
          height={dimensions.fullH}
          className="object-contain"
          priority={priority}
        />
      </div>
    );
  }

  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 ${className}`}>
      <Image
        src="/itehaas-mark.png"
        alt="Itehaas Mark"
        width={dimensions.mark}
        height={dimensions.mark}
        className="object-contain"
        priority={priority}
      />
    </div>
  );
}
