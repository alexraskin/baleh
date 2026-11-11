import { brand } from "@/config/brand";
import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="128" height="128" rx="28" className="fill-accent" />
      <path
        d="M39 25H73C89 25 98 33 98 46C98 58 90 63 79 64C93 65 102 73 102 85C102 98 91 104 75 104H39Z"
        fill="none"
        className="stroke-on-accent"
        strokeWidth="10"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight text-text">{brand.name}</span>
    </span>
  );
}
