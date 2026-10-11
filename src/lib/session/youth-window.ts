import { QLOO_AGE_BUCKETS, type QlooAgeBucket } from "@/lib/qloo/types";
import type { YouthWindow } from "./types";

export const YOUTH_AGE_FROM = 15;
export const YOUTH_AGE_TO = 30;

/** Earliest plausible birth year we accept in the intake form. */
export const MIN_BIRTH_YEAR = 1900;

/** `now` may be a Date or a calendar year (handy where the clock is read elsewhere). */
export function currentYear(now: Date | number = new Date()): number {
  return typeof now === "number" ? now : now.getUTCFullYear();
}

/**
 * The "reminiscence bump": memories from roughly ages 15 to 30 are recalled
 * most vividly. Map a birth year to that calendar window, never past today.
 */
export function computeYouthWindow(birthYear: number, now: Date | number = new Date()): YouthWindow {
  if (!Number.isInteger(birthYear)) throw new RangeError("birthYear must be an integer");
  const thisYear = currentYear(now);
  const start = birthYear + YOUTH_AGE_FROM;
  const end = Math.min(birthYear + YOUTH_AGE_TO, thisYear);
  return { start, end: Math.max(start, end), ageFrom: YOUTH_AGE_FROM, ageTo: YOUTH_AGE_TO };
}

/** Age today, in whole years. */
export function ageIn(birthYear: number, now: Date | number = new Date()): number {
  return Math.max(0, currentYear(now) - birthYear);
}

/**
 * `signal.demographics.age` bucket for a person's current age
 * (https://docs.qloo.com/reference/parameters, "signal.demographics.age").
 */
export function ageBucketFor(birthYear: number, now: Date | number = new Date()): QlooAgeBucket {
  const age = ageIn(birthYear, now);
  if (age <= 24) return "24_and_younger";
  if (age <= 29) return "25_to_29";
  if (age <= 34) return "30_to_34";
  if (age <= 44) return "35_to_44";
  if (age <= 54) return "45_to_54";
  return "55_and_older";
}

export function isAgeBucket(value: string): value is QlooAgeBucket {
  return (QLOO_AGE_BUCKETS as readonly string[]).includes(value);
}

export function describeDecade(year: number): string {
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}
