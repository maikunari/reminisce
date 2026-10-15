/**
 * Deterministic, offline text used when no LLM key is configured (or the LLM
 * fails): conversation prompts per domain and language, planner narration,
 * and the one-line "why Qloo chose this" explanation.
 *
 * Prompts follow reminiscence-practice guidance: open, warm, one question at a
 * time, inviting a story rather than testing recall.
 */
import { dictionary } from "@/lib/i18n";
import type { QlooAgeBucket } from "@/lib/qloo/types";
import { type CardSignals, type Domain, type Language, type Person, pronounsFor } from "@/lib/session/types";
import { describeDecade } from "@/lib/session/youth-window";

type Vars = { title: string; year?: number; decade?: string; person: string; hometown: string };

const TEMPLATES: Record<Language, Record<Domain, string[]>> = {
  en: {
    music: [
      "Tell me about {title}. Where did you first hear that music?",
      "Did you ever dance to {title}? Who was there with you?",
      "{title} was everywhere in the {decade}. Did you have a favourite song?",
      "Did anyone at home sing along to {title}? Who had the best voice?",
    ],
    film: [
      "Did you see {title} at the cinema? Who did you go with?",
      "{title} came out in {year}. What was life like for you that year?",
      "Tell me about going to the pictures back then. Were there films like {title} you saw more than once?",
    ],
    tv: [
      "Was {title} on in your house? Who watched it with you?",
      "What time did {title} come on? Did everyone gather around the television?",
      "Tell me about evenings at home when {title} was on. What would you have for supper?",
    ],
    dining: [
      "Did you ever eat somewhere like {title}? What would you order?",
      "Tell me about a special night out in {hometown}. Somewhere like {title}?",
      "What was a special meal out in {hometown} like when you were young? Anywhere like {title}?",
    ],
    place: [
      "Have you been to {title}? What was that part of {hometown} like when you were young?",
      "Tell me about a day out in {hometown} when you were young. Did you go anywhere like {title}?",
      "Have you seen {title}? How did you get around {hometown} when you were young?",
    ],
    destination: [
      "Did you ever take a trip to {title}? How did you get there?",
      "Tell me about a holiday to somewhere like {title}. The journey, the food, where you stayed?",
      "If you could go back to {title} for a day, what would you do first?",
    ],
  },
  ja: {
    music: [
      "{title}の歌は、どこで聴いていましたか？",
      "{title}の曲で踊ったことはありますか？誰と一緒でしたか？",
      "{decade}頃、{title}はどこでも流れていましたね。お気に入りの歌はありましたか？",
      "ご家族で{title}の歌を口ずさんだことはありますか？",
    ],
    film: [
      "『{title}』は映画館でご覧になりましたか？どなたと行きましたか？",
      "『{title}』は{year}年の映画です。その頃はどんな毎日でしたか？",
      "昔の映画館のこと、教えてください。『{title}』のような映画を何度も観ましたか？",
    ],
    tv: [
      "『{title}』はお家で観ていましたか？どなたと一緒に？",
      "『{title}』は何時に始まりましたか？家族みんなでテレビの前に集まりましたか？",
      "『{title}』を観ていた夜のことを教えてください。晩ごはんは何でしたか？",
    ],
    dining: [
      "{title}のようなお店で食べたことはありますか？何を頼みましたか？",
      "{hometown}での特別な外食のこと、教えてください。{title}のようなお店で？",
      "{title}のようなお店の味を思い出しますか？昔のごちそうは外で食べましたか、それともお家の味でしたか？",
    ],
    place: [
      "{title}に行かれたことはありますか？若い頃、{hometown}のそのあたりはどんな様子でしたか？",
      "若い頃、{hometown}での休日はどう過ごしましたか？{title}のような場所へも出かけましたか？",
      "{title}をご覧になったことはありますか？若い頃は{hometown}の中をどうやって移動していましたか？",
    ],
    destination: [
      "{title}へ旅行したことはありますか？どうやって行きましたか？",
      "{title}のような場所への旅の思い出を教えてください。道中のこと、食べ物、泊まった宿は？",
      "もう一度{title}へ一日だけ行けるなら、まず何をしますか？",
    ],
  },
  es: {
    music: [
      "Cuénteme sobre {title}. ¿Dónde escuchaba sus canciones?",
      "¿Bailó alguna vez con la música de {title}? ¿Quién estaba con usted?",
      "{title} sonaba por todas partes en los {decade}. ¿Tenía una canción favorita?",
      "¿Alguien en casa cantaba las canciones de {title}? ¿Quién tenía la mejor voz?",
    ],
    film: [
      "¿Vio {title} en el cine? ¿Con quién fue?",
      "{title} se estrenó en {year}. ¿Cómo era su vida ese año?",
      "Cuénteme cómo era ir al cine entonces. ¿Había películas como {title} que viera más de una vez?",
    ],
    tv: [
      "¿Se veía {title} en su casa? ¿Quién la veía con usted?",
      "¿A qué hora empezaba {title}? ¿Se reunía toda la familia frente al televisor?",
      "Cuénteme sobre las tardes en casa cuando daban {title}. ¿Qué cenaban?",
    ],
    dining: [
      "¿Comió alguna vez en un sitio como {title}? ¿Qué pedía?",
      "Cuénteme sobre una salida especial en {hometown}. ¿Algún sitio como {title}?",
      "¿Cómo era una comida especial fuera de casa en {hometown} cuando era joven? ¿Había algún sitio como {title}?",
    ],
    place: [
      "¿Ha estado alguna vez en {title}? ¿Cómo era esa parte de {hometown} cuando usted era joven?",
      "Cuénteme sobre un día de paseo en {hometown} cuando era joven. ¿Iba a algún sitio como {title}?",
      "¿Conoce {title}? ¿Cómo se movía por {hometown} cuando era joven?",
    ],
    destination: [
      "¿Hizo alguna vez un viaje a {title}? ¿Cómo llegó hasta allí?",
      "Cuénteme sobre unas vacaciones en un lugar como {title}. ¿El viaje, la comida, dónde se alojó?",
      "Si pudiera volver a {title} por un día, ¿qué haría primero?",
    ],
  },
};

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function fill(template: string, vars: Vars): string {
  return template
    .replace(/\{title\}/g, vars.title)
    .replace(/\{year\}/g, vars.year ? String(vars.year) : "")
    .replace(/\{decade\}/g, vars.decade ?? "")
    .replace(/\{person\}/g, vars.person)
    .replace(/\{hometown\}/g, vars.hometown)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The decade to name in "{title} was everywhere in the {decade}": the artist's
 * own first decade when it falls inside the person's youth, otherwise none.
 * Qloo gives artists no release year, and the youth window's start is not a
 * fact about the artist ("Bette Midler was everywhere in the 1950s").
 */
export function artistDecade(startYear: number | undefined, youth: { start: number; end: number }): string | undefined {
  if (startYear === undefined || startYear < youth.start || startYear > youth.end) return undefined;
  return describeDecade(startYear);
}

/**
 * Deterministic conversation prompt for a card. Places and restaurants may be
 * newer than the person's youth, so their templates never say the person went
 * there back then; they ask about the hometown instead.
 */
export function offlinePrompt(opts: {
  domain: Domain;
  language: Language;
  title: string;
  year?: number;
  /** Artists: the year they started performing (Qloo's start_year), if known. */
  startYear?: number;
  entityId: string;
  person: Person;
  youthWindow: { start: number; end: number };
}): string {
  const list = TEMPLATES[opts.language][opts.domain];
  const decade = opts.domain === "music" ? artistDecade(opts.startYear, opts.youthWindow) : undefined;
  const usable = list.filter((t) => (!t.includes("{year}") || opts.year !== undefined) && (!t.includes("{decade}") || decade !== undefined));
  const pool = usable.length > 0 ? usable : list;
  const pick = pool[hashString(opts.entityId + opts.domain) % pool.length] ?? pool[0]!;
  return fill(pick, {
    title: opts.title,
    year: opts.year,
    decade,
    person: opts.person.name,
    hometown: opts.person.hometown,
  });
}

export function ageLabel(bucket: QlooAgeBucket, language: Language = "en"): string {
  return dictionary(language).age[bucket];
}

/**
 * The provenance fragment under a card, read as "From Qloo: {whyLine} ·
 * affinity 0.91". For example "artists close to Hibari Misora, tuned to Osaka,
 * for people 55 and older". Seeds without a name are left out rather than
 * printed as ids. Written in the session's language.
 */
export function whyLine(domain: Domain, signals: CardSignals, language: Language = "en"): string {
  const t = dictionary(language);
  const seeds = signals.seedNames.filter((n) => n.trim().length > 0);
  const country = signals.params["filter.release_country"];
  return t.why.line({
    plural: t.domain[domain].plural,
    from: signals.yearRange ? t.why.from(signals.yearRange[0], signals.yearRange[1]) : undefined,
    releasedIn: country ? t.why.releasedIn(country) : undefined,
    closeTo: seeds.length > 0 ? t.why.closeTo(joinNames(seeds, 3, language)) : undefined,
    location: signals.locationQuery ? (signals.params["filter.location.query"] ? t.why.within(signals.locationQuery) : t.why.tunedTo(signals.locationQuery)) : undefined,
    age: signals.ageBucket ? t.why.forAge(t.age[signals.ageBucket]) : undefined,
  });
}

/** "A", "A and B", "A, B and C"; five or more become "A, B, C and 2 others". The newest seed comes first. */
export function joinNames(names: string[], max = 3, language: Language = "en"): string {
  const t = dictionary(language).why;
  const sep = language === "ja" ? "、" : ", ";
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > max + 1) return `${names.slice(0, max).join(sep)} ${t.and} ${t.others(names.length - max)}`.replace(/ {2,}/g, " ");
  return `${names.slice(0, -1).join(sep)} ${t.and} ${names[names.length - 1]}`;
}

/** Planner narration used by the deterministic policy. */
export const NARRATION = {
  start: (p: Person, start: number, end: number) =>
    `${p.name} was 15 to 30 between ${start} and ${end}. Building around ${p.hometown} and ${
      p.favorites.length > 0 ? p.favorites.map((f) => f.name).join(", ") : `${pronounsFor(p.pronoun).possessive} generation's taste`
    }.`,
  resolve: (favorites: string[], hometown: string) =>
    favorites.length === 0
      ? `Resolving ${hometown} to a Qloo locality for the location signal.`
      : `Looking up ${favorites.join(", ")} in Qloo's entity search to seed the taste graph, and resolving ${hometown} to a Qloo locality.`,
  insights: (what: string) => `Asking Qloo for ${what}.`,
  insightsAll: (place: string, start: number, end: number) =>
    `Asking Qloo, all at once, for the music, films, television, places to eat, landmarks and trips of ${place} from ${start} to ${end}.`,
  widen: (what: string) => `Few results. Widening the ${what} request.`,
  plan: (count: number, domains: number) => `Choosing ${count} cards across ${domains} domains, highest affinity first.`,
  adaptLiked: (title: string, p: Person) =>
    `${capitalize(pronounsFor(p.pronoun).subject)} lit up at ${title}. Adding it as a taste signal and refreshing the cards ahead.`,
  adaptDisliked: (title: string) => `${title} didn't land. Steering the cards ahead away from it.`,
  adaptDone: (n: number) => (n === 0 ? "Nothing new came back; leaving the deck as it is." : `Swapping ${n} upcoming card${n === 1 ? "" : "s"}.`),
} as const;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
