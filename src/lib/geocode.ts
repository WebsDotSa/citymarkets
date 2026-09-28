/** Reverse geocode via OpenStreetMap Nominatim (no API key). */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");
    url.searchParams.set("accept-language", "ar,en");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "CityMarketsSA/1.0 (delivery-address)" },
    });
    if (!res.ok) throw new Error("geocode failed");
    const data = await res.json();
    return (
      data.display_name ||
      `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    );
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}
