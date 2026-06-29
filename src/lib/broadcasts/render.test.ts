import { describe, expect, it } from 'vitest';
import { renderTemplateBody } from './render';

describe('renderTemplateBody', () => {
  it('substitutes a single positional variable', () => {
    expect(renderTemplateBody('Hi {{1}} 👋', ['Ahmed'])).toBe('Hi Ahmed 👋');
  });

  it('substitutes multiple variables in order', () => {
    expect(
      renderTemplateBody('{{1}} ordered {{2}} units', ['Sara', '5']),
    ).toBe('Sara ordered 5 units');
  });

  it('handles {{10}} without colliding with {{1}}', () => {
    const params = Array.from({ length: 10 }, (_, i) => `v${i + 1}`);
    expect(renderTemplateBody('{{1}} and {{10}}', params)).toBe('v1 and v10');
  });

  it('replaces a missing value with empty string (never leaves raw {{n}})', () => {
    expect(renderTemplateBody('Hi {{1}}, code {{2}}', ['Ahmed'])).toBe(
      'Hi Ahmed, code ',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplateBody('Hi {{ 1 }}', ['Ahmed'])).toBe('Hi Ahmed');
  });

  it('returns body unchanged when there are no variables', () => {
    expect(renderTemplateBody('No variables here', [])).toBe(
      'No variables here',
    );
  });

  it('returns empty string for empty body', () => {
    expect(renderTemplateBody('', ['Ahmed'])).toBe('');
  });
});
