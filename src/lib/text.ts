
export function repairMojibake(value: string): string {
  let repaired = value;

  if (/[ÃÂâ€]/.test(repaired)) {
    try {
      const candidate = Buffer.from(repaired, 'latin1').toString('utf8');
      
      if (!candidate.includes('\uFFFD') && candidate.length <= repaired.length) {
        repaired = candidate;
      }
    } catch {
      
    }
  }

  return repaired.normalize('NFC');
}

export function normalizeTextDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return repairMojibake(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeTextDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => [key, normalizeTextDeep(item)]
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}
