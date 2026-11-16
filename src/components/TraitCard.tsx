"use client";

import { useId, useState } from "react";
import { displayValue, traitRoles } from "@/lib/traits";
import type { Trait } from "@/types/trait";

type TraitCardProps = {
  trait: Trait;
};

export function TraitCard({ trait }: TraitCardProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const roles = traitRoles(trait);

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-raised shadow-[0_1px_0_rgba(255,220,180,0.04)]">
      <h2>
        <button
          type="button"
          className="flex w-full items-start gap-4 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[15px] font-semibold tracking-tight text-ember">
              {trait.Picker}
            </span>
            <span className="mt-1 block font-serif text-sm text-muted">
              {trait["Game visual title"]}
            </span>
          </span>
          <Chevron open={open} />
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="border-t border-line px-4 py-4">
        <dl className="space-y-4">
          <Detail term="Utility" text={trait.Utility} />
          <Detail term="Offensive bonus" text={trait["Offensive bonus"]} />
          <Detail term="Defensive bonus" text={trait["Defensive bonus"]} />
        </dl>
        <dl className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
          <Meta term="Class trait" text={displayValue(trait["Class trait"])} />
          <Meta term="Tribe trait" text={displayValue(trait["Tribe trait"])} />
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">
              Recommended for
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {roles.map((role) => (
                <span
                  key={role}
                  className="rounded-full border border-line px-2 py-0.5 text-xs text-foreground"
                >
                  {role}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

function Detail({ term, text }: { term: string; text: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-ember uppercase">
        {term}
      </dt>
      <dd className="mt-1 text-[15px] leading-relaxed text-foreground">{text}</dd>
    </div>
  );
}

function Meta({ term, text }: { term: string; text: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">
        {term}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{text}</dd>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`mt-1 size-5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
