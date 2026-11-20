import { Suspense } from "react";
import { TraitManager } from "@/components/TraitManager";
import { getTraits } from "@/lib/get-traits";

export default function ManagerPage() {
  return (
    <main>
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-16 text-muted">
            Loading markers and pickers…
          </div>
        }
      >
        <ManagerLoader />
      </Suspense>
    </main>
  );
}

async function ManagerLoader() {
  const traits = await getTraits();
  return <TraitManager traits={traits} />;
}
