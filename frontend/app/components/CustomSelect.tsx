"use client";

import { Check, ChevronDown } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  colorDot?: string;
}

export interface CustomSelectProps {
  id?: string;
  value?: string;
  options?: SelectOption[];
  placeholder?: string;
  triggerLabel?: string;
  triggerBadge?: string;
  title?: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  triggerClassName?: string;
  dropUp?: boolean;
  panelClassName?: string;
  headerContent?: ReactNode;
  children?: ReactNode;
  onChange?: (value: string) => void;
}

export default function CustomSelect({
  id,
  value = "",
  options = [],
  placeholder = "Seleccionar…",
  triggerLabel,
  triggerBadge,
  title,
  icon,
  iconOnly = false,
  triggerClassName = "",
  dropUp = false,
  panelClassName = "",
  headerContent,
  children,
  onChange,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((opt) => opt.value === value);
  const displayLabel =
    triggerLabel ?? (selected ? selected.label : placeholder);
  const displayBadge = triggerBadge ?? selected?.badge;

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={`relative ${iconOnly ? "inline-flex" : "w-full"}`}
    >
      <button
        id={id}
        type="button"
        title={title ?? displayLabel}
        aria-label={title ?? displayLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={
          iconOnly
            ? `inline-flex cursor-pointer items-center justify-center rounded-full border border-black/[.1] transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.16] ${
                open
                  ? "bg-foreground text-background hover:bg-foreground dark:hover:bg-foreground"
                  : "bg-background text-foreground hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a]"
              } ${triggerClassName || "h-10 w-10"}`
            : `inline-flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-full border border-black/[.08] bg-background px-4 text-left text-sm font-medium text-foreground transition-colors hover:bg-[#f2f2f2] focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145] dark:hover:bg-[#1a1a1a] ${triggerClassName}`
        }
      >
        {iconOnly ? (
          <span className="relative flex items-center justify-center">
            {icon}
            {selected?.colorDot && (
              <span
                className="absolute -right-1 -top-1 h-2 w-2 rounded-full ring-1 ring-background"
                style={{ backgroundColor: selected.colorDot }}
              />
            )}
          </span>
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-2 truncate">
              {icon && (
                <span className="shrink-0 text-foreground/75">{icon}</span>
              )}
              {selected?.colorDot && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: selected.colorDot }}
                />
              )}
              <span className="truncate">{displayLabel}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {displayBadge && (
                <span className="hidden font-mono text-[11px] text-foreground/60 sm:inline">
                  {displayBadge}
                </span>
              )}
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-foreground/70 transition-transform duration-150 ${
                  open ? "rotate-180" : ""
                }`}
              />
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className={`custom-select-scroll absolute z-50 max-h-80 overflow-y-auto overflow-x-hidden rounded-2xl border border-black/[.08] bg-background p-1.5 shadow-xl dark:border-white/[.145] ${
            dropUp ? "bottom-full mb-2.5" : "mt-1.5"
          } ${panelClassName || "left-0 right-0 min-w-[240px]"}`}
        >
          {headerContent && (
            <div className="mb-1.5 border-b border-black/[.08] pb-1.5 dark:border-white/[.145]">
              {headerContent}
            </div>
          )}

          {children ? (
            <div className="p-2">{children}</div>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange?.(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "bg-foreground text-background"
                      : "hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a]"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-xs font-medium">
                    {opt.colorDot && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: opt.colorDot }}
                      />
                    )}
                    <span className="truncate">{opt.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {opt.badge && (
                      <span
                        className={`font-mono text-[11px] ${
                          isSelected ? "opacity-80" : "text-foreground/60"
                        }`}
                      >
                        {opt.badge}
                      </span>
                    )}
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
