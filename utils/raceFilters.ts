import { DistanceFilter, DifficultyFilter, ElevationFilter, RaceFilters } from '../app/components/FilterModal';
import { Trail } from '../app/(tabs)/index';

/** As specified: "50" present, but k / km / 50k not present; mile-style unit at end. */
export const FIFTY_MILE_REGEX = /^(?=.*50)(?!.*k|.*km|.*50k).*(mi|miles|m|50m)\b/i;

/** "50" must not be part of 5000, 150, etc. (the base regex alone can still match edge cases). */
const STANDALONE_50 = /(?<!\d)50(?!\d)/;

/** Split combined UI strings like "5K / 10K", "5k-10k", "5K, 10K" into separate tokens for strict matching. */
const DISTANCE_TOKEN_SPLIT = /\s*[/|&,;]+\s*|\s+–\s+|\s*-\s*|\s+and\s+/i;

function expandDistanceTokens(distancesOffered?: string[]): string[] {
  if (!distancesOffered?.length) return [];
  const tokens: string[] = [];
  for (const raw of distancesOffered) {
    String(raw)
      .split(DISTANCE_TOKEN_SPLIT)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((t) => tokens.push(t));
  }
  return tokens;
}

function tokenMatchesStrictFiftyMile(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  return FIFTY_MILE_REGEX.test(t) && STANDALONE_50.test(t);
}

function isStrictFiftyMileFromDistancesOffered(trail: Trail): boolean {
  const tokens = expandDistanceTokens(trail.distancesOffered);
  return tokens.some((d) => tokenMatchesStrictFiftyMile(d));
}

/**
 * Parse distance string to determine category
 * Handles formats like "100M", "50K", "10M", "5K", etc.
 * Note: "50mi" filter uses {@link isStrictFiftyMileFromDistancesOffered} only — not this parser.
 */
function parseDistanceCategory(distancesOffered?: string[]): string[] {
  if (!distancesOffered || distancesOffered.length === 0) {
    return [];
  }

  const categories: string[] = [];
  
  distancesOffered.forEach(dist => {
    const upper = dist.toUpperCase().trim();

    // Check for 100M+ (100M, 100 miles, etc.)
    if (upper.includes('100M') || upper.includes('100 MILES') || upper.includes('100MI')) {
      categories.push('100M+');
    }
    // Check for 100K
    else if (upper.includes('100K') || upper.includes('100 KM') || upper.includes('100KM')) {
      categories.push('100K');
    }
    // Check for 50K
    else if (upper.includes('50K') || upper.includes('50 KM') || upper.includes('50KM')) {
      categories.push('50K');
    }
    // Check for 5K-25K range (5K, 10K, 15K, 20K, 25K, etc.)
    else if (upper.match(/\d+K/) || upper.match(/\d+ KM/)) {
      const kmMatch = upper.match(/(\d+)K/);
      if (kmMatch) {
        const km = parseInt(kmMatch[1]);
        if (km >= 5 && km <= 25) {
          categories.push('5K-25K');
        }
      }
    }
    // Check for miles in 5K-25K equivalent range (3-15 miles)
    else if (upper.match(/\d+MI/) || upper.match(/\d+ MILES/)) {
      const miMatch = upper.match(/(\d+)MI/);
      if (miMatch) {
        const miles = parseInt(miMatch[1]);
        if (miles >= 3 && miles <= 15) {
          categories.push('5K-25K');
        } else if (miles >= 31 && miles < 62) {
          categories.push('50K');
        } else if (miles >= 62 && miles < 100) {
          categories.push('100K');
        } else if (miles >= 100) {
          categories.push('100M+');
        }
      }
    }
  });

  return [...new Set(categories)]; // Remove duplicates
}

/**
 * Parse elevation string to determine category
 * Handles formats like "18,000ft", "5000ft", "2,000 ft", etc.
 */
function parseElevationCategory(elevation: string | number | undefined | null): string | null {
  if (elevation == null || elevation === '') return null;

  // Coerce to string (Firestore may store as a number)
  const elevStr = String(elevation);

  // Extract numbers from elevation string
  const numbers = elevStr.match(/[\d,]+/g);
  if (!numbers || numbers.length === 0) return null;

  // Get the first number (assuming it's the elevation gain)
  const elevationStr = numbers[0].replace(/,/g, '');
  const elevationNum = parseInt(elevationStr);

  if (isNaN(elevationNum)) return null;

  if (elevationNum < 2000) {
    return '< 2,000ft';
  } else if (elevationNum >= 2000 && elevationNum < 5000) {
    return '2,000-5,000ft';
  } else if (elevationNum >= 5000 && elevationNum < 10000) {
    return '5,000-10,000ft';
  } else {
    return '10,000ft+';
  }
}

/**
 * Infer difficulty from elevation
 * This is a heuristic - can be improved with actual difficulty field
 */
function inferDifficulty(elevation: string): string | null {
  const elevationCategory = parseElevationCategory(elevation);
  
  if (!elevationCategory) return null;

  // Heuristic: Higher elevation = more technical
  if (elevationCategory === '10,000ft+') {
    return 'Technical/Skyrunning';
  } else if (elevationCategory === '5,000-10,000ft') {
    return 'Moderate/Mountain';
  } else {
    return 'Easy/Fire Road';
  }
}

/**
 * Check if a race matches the distance filter
 */
function matchesDistanceFilter(trail: Trail, filter: DistanceFilter): boolean {
  if (filter === 'All') return true;
  // Strict 50-mile only: handled in applyRaceFilters (with debug logging). Never use loose categories here.
  if (filter === '50mi') {
    return isStrictFiftyMileFromDistancesOffered(trail);
  }

  const categories = parseDistanceCategory(trail.distancesOffered);
  return categories.includes(filter);
}

/**
 * Check if a race matches the difficulty filter
 */
function matchesDifficultyFilter(trail: Trail, filter: DifficultyFilter): boolean {
  if (filter === 'All') return true;

  // Try to get difficulty from trail data, or infer from elevation
  const difficulty = (trail as any).difficulty || inferDifficulty(trail.elevation);
  
  if (!difficulty) return true; // If we can't determine, include it

  // Map our filter values to possible trail values
  const filterMap: Record<string, string[]> = {
    'Technical/Skyrunning': ['Technical', 'Skyrunning', 'Technical/Skyrunning'],
    'Moderate/Mountain': ['Moderate', 'Mountain', 'Moderate/Mountain'],
    'Easy/Fire Road': ['Easy', 'Fire Road', 'Easy/Fire Road'],
  };

  const possibleValues = filterMap[filter] || [];
  return possibleValues.some(val => 
    difficulty.toLowerCase().includes(val.toLowerCase())
  );
}

/**
 * Check if a race matches the elevation filter
 */
function matchesElevationFilter(trail: Trail, filter: ElevationFilter): boolean {
  if (filter === 'All') return true;

  const category = parseElevationCategory(trail.elevation);
  if (!category) return true; // If we can't parse, include it

  return category === filter;
}

/**
 * Check if a race falls within the selected date range
 */
function matchesDateFilter(trail: Trail, dateFrom: Date | null | undefined, dateTo: Date | null | undefined): boolean {
  // No date filter active
  if (!dateFrom && !dateTo) return true;

  // Get the raw date from the trail
  const raceDate = (trail as any).dateRaw as Date | undefined;

  // If the race has no parseable date, include it so it's not hidden
  if (!raceDate) return true;

  if (dateFrom && raceDate < dateFrom) return false;
  if (dateTo && raceDate > dateTo) return false;

  return true;
}

/**
 * Apply filters to a list of trails
 */
export function applyRaceFilters(trails: Trail[], filters: RaceFilters): Trail[] {
  return trails.filter((trail) => {
    if (filters.distance === '50mi') {
      const isFiftyMile = isStrictFiftyMileFromDistancesOffered(trail);
      console.log(
        `[Filter Debug] Race: ${trail.name} | Distances: ${trail.distancesOffered?.join(', ') ?? ''} | Match: ${isFiftyMile}`
      );
      if (!isFiftyMile) return false;
    } else if (!matchesDistanceFilter(trail, filters.distance)) {
      return false;
    }

    return (
      matchesDifficultyFilter(trail, filters.difficulty) &&
      matchesElevationFilter(trail, filters.elevation) &&
      matchesDateFilter(trail, filters.dateFrom, filters.dateTo)
    );
  });
}









