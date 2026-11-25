export const MANILA_TIMEZONE = 'Asia/Manila';

const MANILA_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA_TIMEZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const MANILA_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: MANILA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatManilaDateTime(input: Date | string | null | undefined): string {
  if (!input) return '—';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return typeof input === 'string' ? input : '—';
  }
  return MANILA_DATETIME_FORMATTER.format(date);
}

export function getManilaTodayDateString(): string {
  return MANILA_DATE_PARTS_FORMATTER.format(new Date());
}

export function buildManilaScheduleWindow(
  dateStr: string,
  hour12Str: string,
  minuteStr: string,
  meridiem: 'AM' | 'PM',
  durationHours: number
): { startDate: Date; endDate: Date; startIso: string; endIso: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour12 = Number(hour12Str);
  const minute = Number(minuteStr);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour12) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(durationHours) ||
    durationHours <= 0
  ) {
    return null;
  }

  let hour24 = hour12 % 12;
  if (meridiem === 'PM') hour24 += 12;

  const hh = String(hour24).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  // Philippines (Asia/Manila) uses fixed UTC+08:00 with no DST
  const startDate = new Date(`${match[1]}-${match[2]}-${match[3]}T${hh}:${mm}:00+08:00`);
  if (Number.isNaN(startDate.getTime())) return null;

  const durationMs = Math.round(durationHours * 60) * 60 * 1000;
  const endDate = new Date(startDate.getTime() + durationMs);
  return {
    startDate,
    endDate,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
  };
}

const TZ_OFFSET_MAP: Record<string, string> = {
  UTC: '+00:00',
  GMT: '+00:00',
  Z: '+00:00',
  PHT: '+08:00',
  PHST: '+08:00',
  SGT: '+08:00',
  HKT: '+08:00',
  CST_CN: '+08:00',
  JST: '+09:00',
  KST: '+09:00',
  PST: '-08:00',
  PDT: '-07:00',
  MST: '-07:00',
  MDT: '-06:00',
  CST: '-06:00',
  CDT: '-05:00',
  EST: '-05:00',
  EDT: '-04:00',
};

function resolveTimezoneOffset(rawTz: string): string | null {
  const tz = rawTz.trim().toUpperCase();
  if (TZ_OFFSET_MAP[tz]) return TZ_OFFSET_MAP[tz];

  const offsetMatch = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tz);
  if (offsetMatch) {
    const sign = offsetMatch[1];
    const hours = offsetMatch[2].padStart(2, '0');
    const mins = (offsetMatch[3] || '00').padStart(2, '0');
    return `${sign}${hours}:${mins}`;
  }
  return null;
}

/**
 * Converts embedded timestamps inside Google Meet recording filenames
 * (e.g., "[TEST1] Lecture 1 - 2026/11/25 16:37 UTC - Recording")
 * into Manila timezone, 12-hour format without any timezone shortcode.
 */
export function formatRecordingTitle(title: string): string {
  if (!title) return title;

  const embeddedTsRegex =
    /\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?(?:\s*(GMT[+-]\d{1,2}(?::?\d{2})?|UTC[+-]\d{1,2}(?::?\d{2})?|UTC|GMT|PHT|PHST|SGT|HKT|JST|KST|PST|PDT|MST|MDT|CST|CDT|EST|EDT))?\b/gi;

  return title.replace(
    embeddedTsRegex,
    (
      fullMatch,
      y: string,
      mo: string,
      d: string,
      h: string,
      mi: string,
      s: string | undefined,
      meridiem: string | undefined,
      rawTz: string | undefined
    ) => {
      let hourNum = Number(h);
      if (meridiem) {
        const upperM = meridiem.toUpperCase();
        hourNum = hourNum % 12;
        if (upperM === 'PM') hourNum += 12;
      }
      if (hourNum < 0 || hourNum > 23) return fullMatch;

      const offset = rawTz ? resolveTimezoneOffset(rawTz) : '+08:00';
      if (!offset) return fullMatch;

      const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${String(hourNum).padStart(
        2,
        '0'
      )}:${mi.padStart(2, '0')}:${(s || '00').padStart(2, '0')}${offset}`;

      const parsed = new Date(iso);
      if (Number.isNaN(parsed.getTime())) return fullMatch;

      return formatManilaDateTime(parsed);
    }
  );
}
