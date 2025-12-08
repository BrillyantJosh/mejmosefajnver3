// Common IANA timezone list for event scheduling
export const COMMON_TIMEZONES = [
  { value: 'Europe/Ljubljana', label: 'Europe/Ljubljana (CET/CEST)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST)' },
  { value: 'Europe/Vienna', label: 'Europe/Vienna (CET/CEST)' },
  { value: 'Europe/Zurich', label: 'Europe/Zurich (CET/CEST)' },
  { value: 'Europe/Zagreb', label: 'Europe/Zagreb (CET/CEST)' },
  { value: 'Europe/Belgrade', label: 'Europe/Belgrade (CET/CEST)' },
  { value: 'Europe/Rome', label: 'Europe/Rome (CET/CEST)' },
  { value: 'Europe/Madrid', label: 'Europe/Madrid (CET/CEST)' },
  { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam (CET/CEST)' },
  { value: 'Europe/Brussels', label: 'Europe/Brussels (CET/CEST)' },
  { value: 'Europe/Prague', label: 'Europe/Prague (CET/CEST)' },
  { value: 'Europe/Warsaw', label: 'Europe/Warsaw (CET/CEST)' },
  { value: 'Europe/Budapest', label: 'Europe/Budapest (CET/CEST)' },
  { value: 'Europe/Athens', label: 'Europe/Athens (EET/EEST)' },
  { value: 'Europe/Helsinki', label: 'Europe/Helsinki (EET/EEST)' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow (MSK)' },
  { value: 'America/New_York', label: 'America/New York (EST/EDT)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'America/Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST/PDT)' },
  { value: 'America/Toronto', label: 'America/Toronto (EST/EDT)' },
  { value: 'America/Sao_Paulo', label: 'America/São Paulo (BRT)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

export const DEFAULT_TIMEZONE = 'Europe/Ljubljana';

// Get user's local timezone
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// Format time in a specific timezone
export function formatTimeInTimezone(date: Date, timezone: string, formatStr: string = 'HH:mm'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date);
  } catch {
    // Fallback to local time
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
}

// Format date in a specific timezone
export function formatDateInTimezone(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return date.toLocaleDateString('en-GB');
  }
}

// Get timezone abbreviation (e.g., "CET", "CEST")
export function getTimezoneAbbreviation(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value || timezone;
  } catch {
    return timezone;
  }
}

// Convert user's local time to a specific timezone for display
export function convertToUserLocalTime(date: Date, eventTimezone: string, userTimezone: string): Date {
  // The date is already in event timezone, we need to show it in user's timezone
  return date; // The Date object itself is timezone-agnostic, display formatting handles conversion
}

// Parse an ISO datetime string with timezone offset
export function parseEventDateTime(dateTimeStr: string, timezone: string): Date {
  // If the string already has an offset, parse it directly
  if (dateTimeStr.includes('+') || dateTimeStr.includes('Z')) {
    return new Date(dateTimeStr);
  }
  
  // Otherwise, create a date in the specified timezone
  // This is a simplified approach - for complex cases, a library like date-fns-tz would be better
  return new Date(dateTimeStr);
}

// Get timezone offset string (e.g., "+01:00" or "+02:00")
export function getTimezoneOffset(timezone: string, date: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    const offsetStr = tzPart?.value || '';
    
    // Convert "GMT+1" to "+01:00"
    const match = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (match) {
      const sign = match[1];
      const hours = match[2].padStart(2, '0');
      const minutes = (match[3] || '00').padStart(2, '0');
      return `${sign}${hours}:${minutes}`;
    }
    
    if (offsetStr === 'GMT' || timezone === 'UTC') {
      return '+00:00';
    }
    
    return '+01:00'; // Default fallback for CET
  } catch {
    return '+01:00';
  }
}
