// Daily order -> Google Sheets sync: real driving distance from the
// Gurgaon hub to a customer's address, via the Distance Matrix API.
// Returns null (rather than throwing) on any geocoding/API failure so the
// caller can skip that order this run and retry it next run instead of
// syncing a wrong delivery-cost figure -- same "never guess" spirit as the
// price/salutation guards elsewhere in this codebase.

export async function getDrivingDistanceKm(
  origin: string,
  destination: string,
  apiKey: string,
): Promise<number | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("units", "metric");
  url.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const data = (await response.json()) as {
    status: string;
    rows?: { elements?: { status: string; distance?: { value: number } }[] }[];
  };
  if (data.status !== "OK") return null;

  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK" || !element.distance) return null;

  return element.distance.value / 1000;
}
