import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { commerceApiLayout } from '../samples/commerce-api.layout';
import { ExploreProvider, useExplore } from './ExploreContext';
import type { Emphasis } from './emphasis';
import type { ExploreAction } from './state';

const draft = commerceApiLayout.draft;
const first = draft.nodes[0]!;

afterEach(() => history.replaceState(null, '', location.pathname));

function mount() {
  const seen: Emphasis[] = [];
  let send!: (a: ExploreAction) => void;
  function Probe() {
    const { emphasis, dispatch } = useExplore();
    seen.push(emphasis);
    send = dispatch;
    return null;
  }
  render(
    <ExploreProvider draft={draft} syncHash={false}>
      <Probe />
    </ExploreProvider>,
  );
  return { latest: () => seen[seen.length - 1]!, dispatch: (a: ExploreAction) => act(() => send(a)) };
}

describe('ExploreProvider emphasis', () => {
  it('keeps the same emphasis through play and speed changes', () => {
    const { latest, dispatch } = mount();
    const before = latest();
    dispatch({ type: 'togglePlay' });
    dispatch({ type: 'cycleSpeed' });
    expect(latest()).toBe(before);
  });

  it('rebuilds emphasis when the selection changes', () => {
    const { latest, dispatch } = mount();
    const before = latest();
    dispatch({ type: 'select', id: first.id });
    expect(latest()).not.toBe(before);
    expect(latest().nodes.get(first.id)).toBe('focus');
  });

  it('rebuilds emphasis when a type is hidden', () => {
    const { latest, dispatch } = mount();
    const before = latest();
    dispatch({ type: 'toggleType', nodeType: first.type });
    expect(latest()).not.toBe(before);
    expect(latest().nodes.get(first.id)).toBe('dim');
  });
});
