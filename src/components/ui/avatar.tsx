import { cn } from "@/lib/cn";

type AvatarSize = "xs" | "sm" | "md" | "lg";

const sizeClasses: Record<AvatarSize, string> = {
  xs: "size-7 text-[0.625rem]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
};

/** Muted, palette-friendly tints so initials avatars stay calm. */
const tints = [
  "bg-[light-dark(#E2EEE7,#243A30)]",
  "bg-[light-dark(#EDE6DA,#3A3328)]",
  "bg-[light-dark(#E4E6EE,#2A2E3C)]",
  "bg-[light-dark(#EEE2E2,#3C2A2A)]",
  "bg-[light-dark(#E8EBDD,#30352A)]",
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function tintFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tints[hash % tints.length] ?? tints[0]!;
}

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  className?: string;
}

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const classes = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium text-text",
    sizeClasses[size],
    className,
  );

  if (src) {
    return <img src={src} alt="" className={cn(classes, "object-cover")} />;
  }

  return (
    <span aria-hidden="true" className={cn(classes, tintFor(name))}>
      {initialsOf(name)}
    </span>
  );
}
