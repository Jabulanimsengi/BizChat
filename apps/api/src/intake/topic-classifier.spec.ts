import {
  classify,
  compileCatalog,
  stem,
  tokenize,
  tokensMatch,
  type ClassifierTopic,
} from './topic-classifier';

describe('topic classifier', () => {
  const thresholds = { autoRouteThreshold: 0.6, confirmThreshold: 0.35 };
  const topics: ClassifierTopic[] = [
    {
      id: 'registration',
      keywords: [{ phrase: 'register' }, { phrase: 'new company' }, { phrase: 'incorporate' }],
      negativeKeywords: ['deregister'],
      examples: ['I want to start a private company'],
    },
    {
      id: 'annual-returns',
      keywords: [{ phrase: 'annual return' }, { phrase: 'penalty' }],
      negativeKeywords: [],
      examples: [],
    },
    {
      id: 'deregistration',
      keywords: [{ phrase: 'deregister', weight: 3 }, { phrase: 'close company' }],
      negativeKeywords: [],
      examples: [],
    },
  ];
  const catalog = compileCatalog(topics);

  it('normalises case, accents, punctuation, and stop words', () => {
    expect(tokenize('Hi! I NEED help with my Cómpany, please.')).toEqual(['company']);
  });

  it('gives related word forms one stem or a stem one letter apart', () => {
    expect(stem('registering')).toBe(stem('register'));
    expect(stem('registered')).toBe(stem('register'));
    expect(stem('companies')).toBe(stem('company'));
    expect(tokensMatch(stem('registration'), stem('register'))).toBe(true);
    expect(stem('speed')).toBe('speed');
  });

  it('tolerates one typo in longer words but not in short ones', () => {
    expect(tokensMatch('regstr', 'registr')).toBe(true);
    expect(tokensMatch('recieve', 'receive')).toBe(true);
    expect(tokensMatch('tax', 'tab')).toBe(false);
    expect(tokensMatch('return', 'retrieve')).toBe(false);
  });

  it('routes a clear message to its topic', () => {
    const result = classify(catalog, 'How do I register a new company?', thresholds);
    expect(result).toMatchObject({ decision: 'ROUTE', topicId: 'registration' });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('matches phrases only when their words appear together', () => {
    expect(classify(catalog, 'my annual return is late', thresholds).topicId).toBe(
      'annual-returns',
    );
    const apart = classify(catalog, 'the return on my annual fee', thresholds);
    expect(apart.candidates.find(({ topicId }) => topicId === 'annual-returns')).toBeUndefined();
  });

  it('lets a negative keyword rule a topic out', () => {
    const result = classify(catalog, 'I need to deregister my business', thresholds);
    expect(result.topicId).toBe('deregistration');
    expect(result.candidates.map(({ topicId }) => topicId)).not.toContain('registration');
  });

  it('asks for confirmation when only one weak keyword matches', () => {
    const result = classify(catalog, 'question about a penalty', thresholds);
    expect(result).toMatchObject({
      decision: 'CONFIRM',
      topicId: 'annual-returns',
      confidence: 0.5,
    });
  });

  it('lowers confidence when two topics match equally', () => {
    const result = classify(catalog, 'penalty for a company I want to incorporate', thresholds);
    expect(result.candidates).toHaveLength(2);
    expect(result.confidence).toBeLessThan(0.6);
  });

  it('uses example messages as a weaker signal', () => {
    const result = classify(catalog, 'starting a private company soon', thresholds);
    expect(result.topicId).toBe('registration');
    expect(result.decision).not.toBe('ROUTE');
  });

  it('asks when nothing matches', () => {
    expect(classify(catalog, 'hello there', thresholds)).toEqual({
      decision: 'ASK',
      topicId: null,
      confidence: 0,
      candidates: [],
    });
  });

  it('respects tenant thresholds', () => {
    const strict = { autoRouteThreshold: 0.9, confirmThreshold: 0.8 };
    expect(classify(catalog, 'How do I register a new company?', strict).decision).toBe('ASK');
  });

  it('breaks score ties deterministically', () => {
    const tied = compileCatalog([
      { id: 'b', keywords: [{ phrase: 'invoice' }], negativeKeywords: [], examples: [] },
      { id: 'a', keywords: [{ phrase: 'invoice' }], negativeKeywords: [], examples: [] },
    ]);
    expect(classify(tied, 'invoice', thresholds).topicId).toBe('a');
  });
});
