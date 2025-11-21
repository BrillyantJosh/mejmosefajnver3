/**
 * Deep comparison utility for arrays of objects
 * Returns true if arrays contain the same data
 */
export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  
  // Sort and stringify for consistent comparison
  const aStr = JSON.stringify(a.map(item => JSON.stringify(item)).sort());
  const bStr = JSON.stringify(b.map(item => JSON.stringify(item)).sort());
  
  return aStr === bStr;
}
