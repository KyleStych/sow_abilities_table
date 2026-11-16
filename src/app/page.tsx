import { Suspense } from "react";
import { TraitBrowser } from "@/components/TraitBrowser";
import { getTraits } from "@/lib/get-traits";
import {
  getClassOptions,
  getRoleOptions,
  getTribeOptions,
} from "@/lib/traits";

export default function Home() {
  return (
    <main>
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-16 text-muted">
            Loading traits…
          </div>
        }
      >
        <TraitsLoader />
      </Suspense>
    </main>
  );
}

async function TraitsLoader() {
  const traits = await getTraits();
  return (
    <TraitBrowser
      traits={traits}
      classOptions={getClassOptions(traits)}
      tribeOptions={getTribeOptions(traits)}
      roleOptions={getRoleOptions(traits)}
    />
  );
}
