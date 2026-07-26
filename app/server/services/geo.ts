/**
 * Great-circle distance helpers. Pure — no DB or HTTP types.
 *
 * Distances are reported in miles because both apps' copy is in miles
 * ("3.2 miles radius").
 */

const EARTH_RADIUS_MILES = 3958.7613

export interface Coordinates {
  latitude: number
  longitude: number
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Haversine distance in miles, rounded to one decimal. */
export function distanceMiles(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLng = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  const miles = 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
  return Math.round(miles * 10) / 10
}

/** Narrow a loose lat/lng pair to real coordinates, or null if unusable. */
export function toCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): Coordinates | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  // 0,0 is in the Gulf of Guinea and is almost always an unset default.
  if (latitude === 0 && longitude === 0) return null
  return { latitude, longitude }
}
