import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense fallback={<div>Loading map...</div>}>
      <ClientBoundary />
    </Suspense>
  );
}

async function ClientBoundary() {
  const MapWorkspace = (await import("@/components/MapWorkspace")).default;
  return <MapWorkspace />;
}
