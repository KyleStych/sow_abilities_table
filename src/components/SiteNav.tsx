"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Traits" },
  { href: "/manager", label: "Markers & Pickers" },
  { href: "/appearance", label: "Appearance" },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="border-b border-line/80 bg-ink/40 backdrop-blur-sm"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1 px-4 py-3">
        {links.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                active
                  ? "rounded-md bg-raised px-3 py-1.5 text-sm font-medium text-foreground"
                  : "rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:bg-raised/60 hover:text-foreground"
              }
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
