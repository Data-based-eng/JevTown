import { decider, deciderIsSystemOne } from './config';

describe('decider', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  test('defaults to the chat model', () => {
    delete process.env.ACTION_DECIDER;
    expect(decider()).toBe('llm');
    expect(deciderIsSystemOne()).toBe(false);
  });

  test('selects the Jev cloud backend', () => {
    process.env.ACTION_DECIDER = 'jev';
    expect(decider()).toBe('jev');
    expect(deciderIsSystemOne()).toBe(true);
  });

  test('selects the local Laya backend', () => {
    process.env.ACTION_DECIDER = 'laya';
    expect(decider()).toBe('laya');
    expect(deciderIsSystemOne()).toBe(true);
  });

  test('an unknown setting falls back to the chat model', () => {
    process.env.ACTION_DECIDER = 'gpt-5';
    expect(decider()).toBe('llm');
    expect(deciderIsSystemOne()).toBe(false);
  });
});
