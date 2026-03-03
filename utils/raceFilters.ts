import { DistanceFilter, DifficultyFilter, ElevationFilter, RaceFilters } from '../app/components/FilterModal';
import { Trail } from '../app/(tabs)/index';

/**
 * Parse distance string to determine category
 * Handles formats like "100M", "50K", "10M", "5K", etc.
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
  return trails.filter(trail => {
    return (
      matchesDistanceFilter(trail, filters.distance) &&
      matchesDifficultyFilter(trail, filters.difficulty) &&
      matchesElevationFilter(trail, filters.elevation) &&
      matchesDateFilter(trail, filters.dateFrom, filters.dateTo)
    );
  });
}









