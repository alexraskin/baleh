import { useSearchParams } from "react-router";

/** The post-login destination from `?next=`, restricted to same-site paths. */
export function useSafeNext(): string {
  const [params] = useSearchParams();
  const next = params.get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : defaultDestination;
}

const defaultDestination = "/rooms";

/** Appends `?next=` to an auth route, unless it's the default destination anyway. */
export function withNext(path: string, next: string): string {
  return next === defaultDestination ? path : `${path}?next=${encodeURIComponent(next)}`;
}
