import { buildTranslationUnits, chunkBatches } from '@platform/shared';
import { FakeAiAdapter } from '../providers/fake-ai.adapter';
import {
  TRANSLATION_SYSTEM_PROMPT,
  parseCopywritingOutput,
  parseReplyOutput,
  parseTranslationOutput,
  translationLanguageBlock,
  translationUserMessage,
} from '../prompts';
import { AiProviderError } from '../providers/ai-provider';
import { TRANSLATION_BATCH_SIZE, evaluateBatch } from './translation-engine.service';

const BASE = {
  'common.save': 'Kaydet',
  'common.greeting': 'Merhaba {name}, {count} yeni mesajın var',
  'common.itemCount.one': '{count} kayıt',
  'common.itemCount.other': '{count} kayıt',
};

async function translate(locale: string, adapter = new FakeAiAdapter()) {
  const units = buildTranslationUnits({ base: BASE, reference: null, current: {}, locale, namespaces: [], overwrite: false });
  const result = await adapter.complete('sk-ant-test-key-000000000000', {
    model: 'claude-sonnet-5',
    system: [TRANSLATION_SYSTEM_PROMPT, translationLanguageBlock({ code: locale, name: 'Test', nativeName: 'Test' }, [])],
    messages: [{ role: 'user', content: translationUserMessage(units) }],
    maxTokens: 1000,
  });
  return { units, evaluation: evaluateBatch(units, parseTranslationOutput(result.text)) };
}

describe('translation batches', () => {
  it('accepts values that keep every placeholder', async () => {
    const { evaluation } = await translate('de');
    expect(evaluation.rejected.size).toBe(0);
    expect(evaluation.accepted.get('common.greeting')).toEqual([{ key: 'common.greeting', value: 'de: Merhaba {name}, {count} yeni mesajın var' }]);
  });

  it('writes every plural form the target language needs', async () => {
    const { evaluation } = await translate('ru');
    const forms = evaluation.accepted.get('common.itemCount.*');
    expect(forms?.map((f) => f.key)).toEqual(['common.itemCount.one', 'common.itemCount.few', 'common.itemCount.many', 'common.itemCount.other']);
    expect(forms?.every((f) => f.value.includes('{count}'))).toBe(true);
  });

  it('rejects a value that lost a placeholder and a key missing from the answer', async () => {
    const adapter = new FakeAiAdapter();
    adapter.dropPlaceholdersFor.add('common.greeting');
    adapter.dropPlaceholdersFor.add('common.itemCount.*');
    adapter.omit.add('common.save');
    const { evaluation } = await translate('ru', adapter);
    expect(evaluation.rejected.get('common.greeting')).toBe('PLACEHOLDER_MISMATCH');
    expect(evaluation.rejected.get('common.itemCount.*')).toBe('PLACEHOLDER_MISMATCH');
    expect(evaluation.rejected.get('common.save')).toBe('MISSING_IN_OUTPUT');
    expect(evaluation.accepted.size).toBe(0);
  });

  it('rejects markup and a plural answer missing a form', () => {
    const units = buildTranslationUnits({ base: BASE, reference: null, current: {}, locale: 'ru', namespaces: [], overwrite: false });
    const answer = new Map([
      ['common.save', { value: '<b>Speichern</b>' }],
      ['common.itemCount.*', { forms: { one: '{count} a', other: '{count} b' } }],
    ]);
    const evaluation = evaluateBatch(units, answer);
    expect(evaluation.rejected.get('common.save')).toBe('HTML');
    expect(evaluation.rejected.get('common.itemCount.*')).toBe('MISSING_IN_OUTPUT');
  });

  it('batches a catalogue into requests of the configured size', () => {
    const keys = Array.from({ length: 890 }, (_, i) => `k${i}`);
    expect(chunkBatches(keys, TRANSLATION_BATCH_SIZE)).toHaveLength(18);
  });

  it('only accepts answers in the expected JSON shape', () => {
    expect(() => parseTranslationOutput('Sorry, I cannot help')).toThrow(AiProviderError);
    expect(() => parseTranslationOutput('{"items": []}')).toThrow(AiProviderError);
    expect(parseTranslationOutput('```json\n{"translations":[{"id":"a","value":"b"}]}\n```').get('a')).toEqual({ value: 'b', forms: undefined });
  });
});

describe('writing outputs', () => {
  it('parses a copywriting answer and strips markup', () => {
    expect(parseCopywritingOutput('{"subject":"<b>Yeni</b> dönem","text":"Yerinizi ayırtın."}')).toEqual({ subject: 'Yeni dönem', text: 'Yerinizi ayırtın.' });
    expect(parseCopywritingOutput('{"subject":"","text":"SMS metni"}')).toEqual({ subject: null, text: 'SMS metni' });
    expect(() => parseCopywritingOutput('{"subject":"","text":"<p></p>"}')).toThrow(AiProviderError);
  });

  it('cleans a reply suggestion', () => {
    expect(parseReplyOutput('"Merhaba, kontrol edip dönüyoruz."')).toBe('Merhaba, kontrol edip dönüyoruz.');
    expect(() => parseReplyOutput('   ')).toThrow(AiProviderError);
  });
});
