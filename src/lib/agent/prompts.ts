/**
 * Deterministic, offline text used when no LLM key is configured (or the LLM
 * fails): conversation prompts per domain and language, planner narration,
 * and the one-line "why Qloo chose this" explanation.
 *
 * Prompts follow reminiscence-practice guidance: open, warm, one question at a
 * time, inviting a story rather than testing recall.
 */
import type { QlooAgeBucket } from "@/lib/qloo/types";
import { DOMAIN_INFO, type CardSignals, type Domain, type Language, type Person } from "@/lib/session/types";
import { describeDecade } from "@/lib/session/youth-window";

type Vars = { title: string; year?: number; decade?: string; person: string; hometown: string };

const TEMPLATES: Record<Language, Record<Domain, string[]>> = {
  en: {
    music: [
      "Tell me about {title}. Where would you have heard their songs?",
      "Did you ever dance to {title}? Who was there with you?",
      "{title} was everywhere in the {decade}. Did you have a favourite of their songs?",
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
      "What did a treat taste like back then? Something from {title}, or made at home?",
    ],
    place: [
      "Tell me about {title}. What was it like when you were young?",
      "Did you ever spend a day at {title}? Was the weather good?",
      "How would you get to {title} from home? Who would come along?",
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
      "昔のごちそうはどんな味でしたか？{title}のようなお店の味、それともお家の味？",
    ],
    place: [
      "{title}のこと、教えてください。若い頃はどんな場所でしたか？",
      "{title}で一日過ごしたことはありますか？お天気は良かったですか？",
      "お家から{title}へはどうやって行きましたか？誰と一緒でしたか？",
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
      "¿A qué sabía un capricho entonces? ¿Algo de {title} o hecho en casa?",
    ],
    place: [
      "Cuénteme sobre {title}. ¿Cómo era cuando usted era joven?",
      "¿Pasó alguna vez un día en {title}? ¿Hacía buen tiempo?",
      "¿Cómo iba a {title} desde casa? ¿Quién le acompañaba?",
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

/** Deterministic conversation prompt for a card. */
export function offlinePrompt(opts: {
  domain: Domain;
  language: Language;
  title: string;
  year?: number;
  entityId: string;
  person: Person;
  youthStart: number;
}): string {
  const list = TEMPLATES[opts.language][opts.domain];
  const usable = list.filter((t) => !t.includes("{year}") || opts.year !== undefined);
  const pool = usable.length > 0 ? usable : list;
  const pick = pool[hashString(opts.entityId + opts.domain) % pool.length] ?? pool[0]!;
  return fill(pick, {
    title: opts.title,
    year: opts.year,
    decade: describeDecade(opts.year ?? opts.youthStart),
    person: opts.person.name,
    hometown: opts.person.hometown,
  });
}

const AGE_LABEL: Record<QlooAgeBucket, string> = {
  "24_and_younger": "listeners 24 and younger",
  "25_to_29": "people aged 25 to 29",
  "30_to_34": "people aged 30 to 34",
  "35_to_44": "people aged 35 to 44",
  "45_to_54": "people aged 45 to 54",
  "55_and_older": "people aged 55 and older",
};

/** One line, in English, naming the Qloo signals that produced a card. */
export function whyLine(domain: Domain, signals: CardSignals): string {
  const info = DOMAIN_INFO[domain];
  const parts: string[] = [];
  let head = `Qloo ${info.plural}`;
  if (signals.yearRange) head += ` from ${signals.yearRange[0]} to ${signals.yearRange[1]}`;
  const country = signals.params["filter.release_country"];
  if (country) head += ` released in ${country}`;
  parts.push(head);
  if (signals.seedNames.length > 0) {
    const aff = signals.affinity !== null ? ` (affinity ${signals.affinity.toFixed(2)})` : "";
    parts.push(`with taste affinity to ${joinNames(signals.seedNames)}${aff}`);
  } else if (signals.affinity !== null) {
    parts.push(`(affinity ${signals.affinity.toFixed(2)})`);
  }
  if (signals.locationQuery) {
    parts.push(signals.params["filter.location.query"] ? `in ${signals.locationQuery}` : `tuned to ${signals.locationQuery}`);
  }
  if (signals.ageBucket) parts.push(`for ${AGE_LABEL[signals.ageBucket]}`);
  return parts.join(", ").replace(", (", " (") + ".";
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Planner narration used by the deterministic policy. */
export const NARRATION = {
  start: (p: Person, start: number, end: number) =>
    `${p.name} was ${15} to ${30} between ${start} and ${end}. Building a session around ${p.hometown} and ${
      p.favorites.length > 0 ? p.favorites.map((f) => f.name).join(", ") : "their generation's taste"
    }.`,
  resolveFavorite: (name: string) => `Looking up "${name}" in Qloo's entity search so it can seed the taste graph.`,
  resolveHometown: (name: string) => `Resolving "${name}" to a Qloo locality for the location signal.`,
  tags: (what: string) => `Finding valid Qloo tag ids for ${what}.`,
  insights: (what: string) => `Asking Qloo Insights for ${what}.`,
  widen: (what: string) => `Few results. Widening the ${what} query.`,
  plan: (count: number, domains: number) => `Choosing ${count} cards across ${domains} domains, highest affinity first.`,
  adaptLiked: (title: string) => `"${title}" lit them up. Re-querying Qloo with it as an added taste signal.`,
  adaptDisliked: (title: string) => `"${title}" didn't land. Steering upcoming cards away from it.`,
  adaptDone: (n: number) => `Swapped ${n} upcoming card${n === 1 ? "" : "s"}.`,
} as const;
