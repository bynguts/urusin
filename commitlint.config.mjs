import { isBannedSubject, hasAiAttribution } from './scripts/lib/commit-rules.mjs';

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-not-meaningless': ({ subject }) => [
          !subject || !isBannedSubject(subject),
          'subjek tidak boleh hanya "update", "test", "final", atau "wip"',
        ],
        'no-ai-attribution': ({ raw }) => [
          !hasAiAttribution(raw ?? ''),
          'pesan tidak boleh memuat trailer Co-Authored-By atau atribusi AI',
        ],
      },
    },
  ],
  rules: {
    'subject-not-meaningless': [2, 'always'],
    'no-ai-attribution': [2, 'always'],
    'subject-case': [0],
  },
};
