import { HTMLAttributes } from "react";
import Image from "next/image";

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function Avatar({ src, alt, name, size = "md", className = "", ...props }: AvatarProps) {
  const sizes = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
    xl: "h-16 w-16 text-lg",
  };

  if (src) {
    return (
      <div
        className={`${sizes[size]} rounded-full overflow-hidden bg-muted flex-shrink-0 ${className}`}
        {...props}
      >
        <Image
          src={src}
          alt={alt || name || "Avatar"}
          fill
          className="object-cover"
          sizes="64px"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizes[size]} rounded-full bg-org-primary text-white flex items-center justify-center font-medium flex-shrink-0 ${className}`}
      {...props}
    >
      {name ? getInitials(name) : "?"}
    </div>
  );
}

