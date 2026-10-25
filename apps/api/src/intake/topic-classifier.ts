import type { ClassificationDecision } from '@prisma/client';

/** A topic as the classifier sees it; compiled once per tenant catalogue version. */
export interface ClassifierTopic {
  id: string;
  keywords: { phrase: string; weight?: number }[];
  negativeKeywords: string[];
  examples: string[];
}

export interface ClassifierThresholds {
  autoRouteThreshold: number;
  confirmThreshold: number;
}

export interface Classification {
  decision: ClassificationDecision;
  /** Null when nothing matched. */
  topicId: string | null;
  confidence: number;
  /** Matching topics, best first (at most three). */
  candidates: { topicId: string; score: number }[];
}

interface CompiledTopic {
  id: string;
  keywords: { tokens: string[]; weight: number }[];
  negatives: string[][];
  examples: string[][];
}

export interface CompiledCatalog {
  topics: CompiledTopic[];
}

const STOP_WORDS = new Set(
  (
    'a an and are as at be been but by can could do does for from get got have help hello hi how i ' +
    "i'm im is it its me my need of on or our please so that the their there this to too want was " +
    'we what when where which who why will with would you your'
  ).split(' '),
);
// Longest first, so "ations" is tried before "s".
const SUFFIXES = [
  'ations',
  'ation',
  'ments',
  'ment',
  'ings',
  'ing',
  'ies',
  'ers',
  'er',
  'es',
  'ed',
  'ly',
  's',
];
const MIN_STEM = 4;
const FUZZY_MIN_LENGTH = 5;
const EXAMPLE_WEIGHT = 0.5;
const MAX_CANDIDATES = 3;

/** Lowercases, strips accents and punctuation, drops stop words, and stems each token. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
    .map(stem);
}

/**
 * Light suffix stripping, repeated until stable, so "registering", "registered", and "register" share
 * a stem; "registration" ends one letter away and is caught by the typo tolerance.
 */
export function stem(token: string): string {
  let current = token;
  for (;;) {
    const suffix = SUFFIXES.find(
      (candidate) => current.endsWith(candidate) && current.length - candidate.length >= MIN_STEM,
    );
    if (!suffix) return current;
    current = current.slice(0, -suffix.length) + (suffix === 'ies' ? 'y' : '');
  }
}

/** Equal stems, or one edit apart (Damerau-Levenshtein) when both are long enough to be distinctive. */
export function tokensMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < FUZZY_MIN_LENGTH || right.length < FUZZY_MIN_LENGTH) return false;
  if (Math.abs(left.length - right.length) > 1) return false;
  return editDistanceAtMostOne(left, right);
}

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (left.length === right.length) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index += 1)
      if (left[index] !== right[index]) differences.push(index);
    if (differences.length <= 1) return true;
    // One transposition of adjacent letters ("recieve") counts as a single edit.
    const [first, second] = differences;
    return (
      differences.length === 2 &&
      second === first! + 1 &&
      left[first!] === right[second] &&
      left[second] === right[first!]
    );
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  let skipped = false;
  for (let shortIndex = 0, longIndex = 0; shortIndex < shorter.length; longIndex += 1) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
  }
  return true;
}

export function compileCatalog(topics: ClassifierTopic[]): CompiledCatalog {
  return {
    topics: topics.map((topic) => ({
      id: topic.id,
      keywords: topic.keywords
        .map(({ phrase, weight }) => {
          const tokens = tokenize(phrase);
          return { tokens, weight: weight ?? (tokens.length > 1 ? 2 : 1) };
        })
        .filter(({ tokens }) => tokens.length > 0),
      negatives: topic.negativeKeywords.map(tokenize).filter((tokens) => tokens.length > 0),
      examples: topic.examples.map(tokenize).filter((tokens) => tokens.length > 0),
    })),
  };
}

/** True when the phrase's tokens appear consecutively in the message. */
function containsPhrase(message: string[], phrase: string[]): boolean {
  for (let start = 0; start + phrase.length <= message.length; start += 1)
    if (phrase.every((token, offset) => tokensMatch(message[start + offset]!, token))) return true;
  return false;
}

/** Share of an example's tokens that also occur in the message. */
function exampleOverlap(message: string[], example: string[]): number {
  const matched = example.filter((token) => message.some((word) => tokensMatch(word, token)));
  return matched.length / example.length;
}

export function scoreTopic(message: string[], topic: CompiledTopic): number {
  if (topic.negatives.some((negative) => containsPhrase(message, negative))) return 0;
  const keywordScore = topic.keywords
    .filter(({ tokens }) => containsPhrase(message, tokens))
    .reduce((total, { weight }) => total + weight, 0);
  const bestExample = topic.examples.reduce(
    (best, example) => Math.max(best, exampleOverlap(message, example)),
    0,
  );
  return keywordScore + EXAMPLE_WEIGHT * bestExample;
}

/**
 * Scores every topic and decides whether to route, route and let the visitor change the topic, or
 * ask. Confidence is s1 / (s1 + s2 + 1) for the top two scores, so a single weak hit never looks
 * certain and a close second lowers confidence.
 */
export function classify(
  catalog: CompiledCatalog,
  text: string,
  thresholds: ClassifierThresholds,
): Classification {
  const message = tokenize(text);
  const scored = catalog.topics
    .map((topic) => ({ topicId: topic.id, score: scoreTopic(message, topic) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.topicId.localeCompare(right.topicId));
  const [best, second] = scored;
  if (!best) return { decision: 'ASK', topicId: null, confidence: 0, candidates: [] };
  const confidence = round(best.score / (best.score + (second?.score ?? 0) + 1));
  const decision: ClassificationDecision =
    confidence >= thresholds.autoRouteThreshold
      ? 'ROUTE'
      : confidence >= thresholds.confirmThreshold
        ? 'CONFIRM'
        : 'ASK';
  return {
    decision,
    topicId: best.topicId,
    confidence,
    candidates: scored
      .slice(0, MAX_CANDIDATES)
      .map(({ topicId, score }) => ({ topicId, score: round(score) })),
  };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
