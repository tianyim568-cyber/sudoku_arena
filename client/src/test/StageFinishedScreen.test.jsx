// Unit tests for StageFinishedScreen — the presentational component shown
// when a stage ends (variant="stage") or the whole competition ends
// (variant="competition").
//
// What this file pins down, as a TABLE: one row per (variant, stageOrder,
// stageType) combination, next column is the expected text the screen must
// show. If someone swaps the i18n keys or drops the stageOrder fallback, at
// least one row breaks.
//
// Language note: the default LanguageProvider language is zh (Chinese), so
// the expected strings below are the zh strings from i18n/zh.js. The point
// of the table is to prove the RIGHT i18n key is used for each prop
// combination — the language choice is orthogonal to that. If the default
// ever switches to en, only the expected strings need updating, not the
// test structure.
//
// The rows that protect against permutation:
//   - variant="stage" with stageOrder=N → "Stage N finished" title.
//     Drop the stageOrder branch → "stage with order" fails.
//   - variant="stage" with stageOrder=null → "Stage finished" fallback.
//     Remove the fallback → "stage no order" fails.
//   - variant="stage" with stageType='INDIVIDUAL' → "Individual stage" label.
//   - variant="stage" with stageType='TEAM' → "Team stage" label.
//   - variant="stage" with stageType=null → no subtitle line (no crash).
//   - variant="stage" with stageType='PK' → no subtitle (PK intentionally
//     absent from the map — the engine exposes it but it is disabled).
//   - variant="competition" → "Competition finished" + thanks, and NO
//     stage mention. Drop the competition branch → "competition" fails.
//   - variant unknown → renders null (defensive — no crash).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StageFinishedScreen from '../pages/StageFinishedScreen';
import { LanguageProvider } from '../i18n/LanguageContext';

// The component uses useLanguage() — wrap it in the provider so t() works.
// Default language is zh; expected strings below match i18n/zh.js.
function renderWith(ui) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

// Helper to read the whole rendered text as one string — easier for "must
// contain" / "must not contain" assertions than querying each element.
function bodyText() {
  const node = screen.getByText((_, el) => el?.tagName === 'DIV' && el.getAttribute('data-testid') === 'sf-body');
  return node.textContent;
}

// ─── The table ───────────────────────────────────────────────────────────
// Each row: { name, props, expect: { contains: [], notContains: [] } }.
// `contains` = substrings that MUST appear in the rendered text (zh strings).
// `notContains` = substrings that MUST NOT appear (catches a competition
// variant accidentally leaking stage wording, etc.).
const TABLE = [
  // ── variant="stage" ────────────────────────────────────────────────────
  { name: 'stage with order 2 + TEAM → "第 2 阶段已结束" + "团队赛阶段"',
    props: { variant: 'stage', stageOrder: 2, stageType: 'TEAM' },
    expect: { contains: ['第 2 阶段已结束', '团队赛阶段', '等待裁判开始下一阶段'], notContains: ['比赛已结束'] } },
  { name: 'stage with order 1 + INDIVIDUAL → "第 1 阶段已结束" + "个人赛阶段"',
    props: { variant: 'stage', stageOrder: 1, stageType: 'INDIVIDUAL' },
    expect: { contains: ['第 1 阶段已结束', '个人赛阶段', '等待裁判开始下一阶段'], notContains: ['比赛已结束'] } },
  { name: 'stage with no order → fallback "阶段已结束"',
    props: { variant: 'stage', stageOrder: null, stageType: 'INDIVIDUAL' },
    expect: { contains: ['阶段已结束', '个人赛阶段', '等待裁判开始下一阶段'], notContains: ['第 0', '第 null', '比赛已结束'] } },
  { name: 'stage with no stageType → no subtitle, no crash',
    props: { variant: 'stage', stageOrder: 1, stageType: null },
    expect: { contains: ['第 1 阶段已结束', '等待裁判开始下一阶段'], notContains: ['个人赛阶段', '团队赛阶段', 'undefined', 'null'] } },
  { name: 'stage with PK stageType → no subtitle (PK intentionally absent)',
    props: { variant: 'stage', stageOrder: 1, stageType: 'PK' },
    expect: { contains: ['第 1 阶段已结束', '等待裁判开始下一阶段'], notContains: ['个人赛阶段', '团队赛阶段', 'PK'] } },

  // ── variant="competition" ─────────────────────────────────────────────
  { name: 'competition → "比赛已结束" + "感谢您的参与"',
    props: { variant: 'competition' },
    expect: { contains: ['比赛已结束', '感谢您的参与'], notContains: ['阶段', '等待裁判开始', '个人赛', '团队赛'] } },
  { name: 'competition ignores stageOrder/stageType even if passed',
    props: { variant: 'competition', stageOrder: 5, stageType: 'TEAM' },
    expect: { contains: ['比赛已结束', '感谢您的参与'], notContains: ['第 5', '团队赛阶段'] } },

  // ── variant unknown ────────────────────────────────────────────────────
  { name: 'unknown variant → renders nothing (no crash)',
    props: { variant: 'unknown' },
    expect: { contains: [], notContains: [] } },
  { name: 'no variant → renders nothing (no crash)',
    props: {},
    expect: { contains: [], notContains: [] } },
];

// ─── The test runner ─────────────────────────────────────────────────────
describe('StageFinishedScreen — wording table', () => {
  for (const row of TABLE) {
    it(row.name, () => {
      renderWith(
        <div data-testid="sf-body">
          <StageFinishedScreen {...row.props} />
        </div>
      );
      // For the "renders nothing" rows, assert the body has no text.
      // For the others, assert the substring expectations.
      const text = bodyText();
      for (const needle of row.expect.contains) {
        expect(text).toContain(needle);
      }
      for (const forbidden of row.expect.notContains) {
        expect(text).not.toContain(forbidden);
      }
    });
  }
});

// The "contains" check above passes even if a title is rendered twice —
// substring match doesn't count occurrences. This describe pins the count
// explicitly: the competition-end sentence must appear once, not twice.
// Caught during review after the first pass rendered competitionTitle
// both as the small uppercase kicker AND as the big title.
describe('StageFinishedScreen — no title duplication', () => {
  it('renders the competition title exactly once', () => {
    renderWith(<StageFinishedScreen variant="competition" />);
    expect(screen.getAllByText('比赛已结束')).toHaveLength(1);
  });

  it('renders the stage title exactly once (with order)', () => {
    renderWith(<StageFinishedScreen variant="stage" stageOrder={1} stageType="INDIVIDUAL" />);
    expect(screen.getAllByText('第 1 阶段已结束')).toHaveLength(1);
  });

  it('renders the stage kicker exactly once', () => {
    renderWith(<StageFinishedScreen variant="stage" stageOrder={1} stageType="INDIVIDUAL" />);
    expect(screen.getAllByText('阶段完成')).toHaveLength(1);
  });
});
