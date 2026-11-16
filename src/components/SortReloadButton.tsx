"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sortAndReloadTraits } from "@/app/actions/sort-traits";

export function SortReloadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function handleClick() {
    setStatus(null);
    startTransition(async () => {
      const result = await sortAndReloadTraits();
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      setStatus(`Sorted ${result.count} traits`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg border border-line px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember enabled:hover:border-ember disabled:opacity-40"
      >
        {pending ? "Sorting…" : "Sort & reload"}
      </button>
      {status ? (
        <p aria-live="polite" className="text-xs text-muted">
          {status}
        </p>
      ) : null}
    </div>
  );
}
