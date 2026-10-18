/**
 * Request validation for the API routes. Bodies come from the browser (and
 * localStorage), so they are untrusted.
 */
import { z } from "zod";

import { DOMAINS } from "./types";
import { MIN_BIRTH_YEAR, currentYear } from "./youth-window";

export const FavoriteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  entityId: z.string().trim().min(8).max(80).optional(),
  type: z.string().trim().max(60).optional(),
  imageUrl: z.string().url().max(500).optional(),
  genres: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
});

export const PersonSchema = z.object({
  name: z.string().trim().min(1).max(60),
  birthYear: z
    .number()
    .int()
    .min(MIN_BIRTH_YEAR)
    .max(currentYear() - 18),
  hometown: z.string().trim().min(1).max(80),
  favorites: z.array(FavoriteSchema).min(1).max(3),
  language: z.enum(["en", "ja", "es"]),
  presetId: z.string().trim().max(40).optional(),
  pronoun: z.enum(["she", "he", "they"]).optional(),
});

export const PlanRequestSchema = z.object({ person: PersonSchema });

const CardSignalsSchema = z.looseObject({
  qlooType: z.string(),
  path: z.literal("/v2/insights"),
  params: z.record(z.string(), z.string()),
  affinity: z.number().nullable(),
  source: z.enum(["live", "recorded", "synthetic"]),
  seedNames: z.array(z.string()),
  rank: z.number().int(),
  warnings: z.array(z.string()),
});

export const CardSchema = z.looseObject({
  id: z.string().min(1).max(60),
  entityId: z.string().min(1).max(80),
  domain: z.enum(DOMAINS),
  title: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)).max(10).optional(),
  prompt: z.string().max(400),
  why: z.string().max(400),
  tags: z.array(z.string().max(80)).max(10),
  signals: CardSignalsSchema,
  reaction: z.enum(["lit_up", "not_this"]).optional(),
  addedBy: z.enum(["plan", "adapt"]),
});

export const AdaptRequestSchema = z.object({
  person: PersonSchema,
  cards: z.array(CardSchema).min(1).max(24),
  feedback: z.object({ cardId: z.string().min(1).max(60), reaction: z.enum(["lit_up", "not_this"]) }),
  /** -1 on the overview: no card has been shown yet, and the feedback card is swapped for another. */
  currentIndex: z.number().int().min(-1).max(23),
  /** Entities a swap must not bring in, such as a card dropped on the overview and waiting for Undo. */
  exclude: z.array(z.string().min(1).max(80)).max(24).optional(),
});

export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export type AdaptRequest = z.infer<typeof AdaptRequestSchema>;
