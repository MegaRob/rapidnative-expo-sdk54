/**
 * Calculate the distance between two coordinates using the Haversine formula
 * Returns distance in miles
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(nLat2 - nLat1);
  const dLon = toRadians(nLon2 - nLon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(nLat1)) *
      Math.cos(toRadians(nLat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 10) / 10; // Round to 1 decimal place
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Common city coordinates (fallback if geocoding API is not available)
 */
export const CITY_COORDINATES: Record<string, { lat: number; lon: number }> = {
  'Boulder, CO': { lat: 40.015, lon: -105.2705 },
  'Denver, CO': { lat: 39.7392, lon: -104.9903 },
  'Colorado Springs, CO': { lat: 38.8339, lon: -104.8214 },
  'Fort Collins, CO': { lat: 40.5853, lon: -105.0844 },
  'Aspen, CO': { lat: 39.1911, lon: -106.8175 },
  'Vail, CO': { lat: 39.6403, lon: -106.3742 },
  'Salt Lake City, UT': { lat: 40.7608, lon: -111.8910 },
  'Ogden, UT': { lat: 41.2230, lon: -111.9738 },
  'Logan, UT': { lat: 41.7370, lon: -111.8338 },
  'Moab, UT': { lat: 38.5733, lon: -109.5498 },
  'Park City, UT': { lat: 40.6461, lon: -111.4980 },
  'Seattle, WA': { lat: 47.6062, lon: -122.3321 },
  'Portland, OR': { lat: 45.5152, lon: -122.6784 },
  'San Francisco, CA': { lat: 37.7749, lon: -122.4194 },
  'Los Angeles, CA': { lat: 34.0522, lon: -118.2437 },
  'New York, NY': { lat: 40.7128, lon: -74.0060 },
  'Boston, MA': { lat: 42.3601, lon: -71.0589 },
  'Chicago, IL': { lat: 41.8781, lon: -87.6298 },
  'Austin, TX': { lat: 30.2672, lon: -97.7431 },
  'Phoenix, AZ': { lat: 33.4484, lon: -112.0740 },
  'Las Vegas, NV': { lat: 36.1699, lon: -115.1398 },
};

/**
 * Try to get coordinates for a city name (synchronous, hardcoded list only)
 * Use geocodeLocation() for full geocoding support
 */
export function getCoordinatesForCity(cityName: string): { lat: number; lon: number } | null {
  const normalized = cityName.trim();
  
  if (CITY_COORDINATES[normalized]) {
    return CITY_COORDINATES[normalized];
  }
  
  // Try case-insensitive match
  const cityKey = Object.keys(CITY_COORDINATES).find(
    key => key.toLowerCase() === normalized.toLowerCase()
  );
  
  if (cityKey) {
    return CITY_COORDINATES[cityKey];
  }
  
  // Try partial match (e.g., "Boulder" matches "Boulder, CO")
  const partialKey = Object.keys(CITY_COORDINATES).find(
    key => key.toLowerCase().startsWith(normalized.toLowerCase())
  );
  
  if (partialKey) {
    return CITY_COORDINATES[partialKey];
  }
  
  return null;
}

// In-memory cache for geocoded locations to avoid repeated lookups
const geocodeCache: Record<string, { lat: number; lon: number }> = {};

/**
 * Geocode a location string to coordinates
 * Uses hardcoded list first, then falls back to expo-location device geocoder
 */
export async function geocodeLocation(locationName: string): Promise<{ lat: number; lon: number } | null> {
  if (!locationName || !locationName.trim()) return null;
  
  const key = locationName.trim().toLowerCase();
  
  // Check in-memory cache
  if (geocodeCache[key]) {
    return geocodeCache[key];
  }
  
  // Check hardcoded list
  const cached = getCoordinatesForCity(locationName);
  if (cached) {
    geocodeCache[key] = cached;
    return cached;
  }
  
  // Use expo-location device geocoder
  try {
    const Location = require('expo-location');
    const results = await Location.geocodeAsync(locationName.trim());
    if (results && results.length > 0) {
      const coords = { lat: results[0].latitude, lon: results[0].longitude };
      geocodeCache[key] = coords;
      return coords;
    }
  } catch (error) {
    console.warn('Geocoding failed for:', locationName, error);
  }
  
  return null;
}









