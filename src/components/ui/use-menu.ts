import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

/**
 * Behaviour for a button that opens a `role="menu"` popover: focuses the
 * first (or checked) item on open, closes on outside click, Escape (returning
 * focus to the trigger) and Tab, and moves between items with the arrow keys,
 * Home and End. Spread the returned props onto the container, trigger and menu.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    (
      menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>('[role^="menuitem"]')
    )?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const close = () => setOpen(false);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") return close();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const target =
      event.key === "ArrowDown"
        ? items[(index + 1) % items.length]
        : event.key === "ArrowUp"
          ? items.at(index - 1)
          : event.key === "Home"
            ? items[0]
            : event.key === "End"
              ? items.at(-1)
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  return {
    open,
    close,
    container: { ref: containerRef },
    trigger: {
      ref: triggerRef,
      type: "button" as const,
      "aria-haspopup": "menu" as const,
      "aria-expanded": open,
      "aria-controls": menuId,
      onClick: () => setOpen((value) => !value),
    },
    menu: { ref: menuRef, id: menuId, role: "menu", tabIndex: -1, onKeyDown },
  };
}
