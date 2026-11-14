import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { commerceApiLayout } from '../samples/commerce-api.layout';
import { ExploreProvider } from '../explore/ExploreContext';
import { ViewerScope } from '../explore/scope';
import { DiagramCanvas } from './DiagramCanvas';
import { StaticScene } from './StaticScene';

const { nodeCardRenders } = vi.hoisted(() => ({ nodeCardRenders: vi.fn() }));

// Stand-in for the real NodeCard so we can count renders without measuring layout.
vi.mock('../card/NodeCard', () => ({
  NodeCard: (props: { node: { id: string } }) => {
    nodeCardRenders(props.node.id);
    return <div data-testid="node-card-stub" />;
  },
}));

describe('DiagramCanvas', () => {
  it('changes the viewport transform on wheel without re-rendering the cards', () => {
    const { container } = render(
      <ExploreProvider draft={commerceApiLayout.draft}>
        <DiagramCanvas diagram={commerceApiLayout} />
      </ExploreProvider>,
    );
    const stage = container.querySelector('.sm-stage')!;
    const viewport = () => container.querySelector('.sm-viewport') as HTMLElement;

    const transformBefore = viewport().style.transform;
    const rendersBefore = nodeCardRenders.mock.calls.length;
    expect(rendersBefore).toBeGreaterThan(0);

    fireEvent.wheel(stage, { deltaY: -100, clientX: 0, clientY: 0 });

    expect(viewport().style.transform).not.toBe(transformBefore);
    expect(nodeCardRenders.mock.calls.length).toBe(rendersBefore);
  });

  it('selecting a card restyles the cards around it without re-rendering what is inside any of them', () => {
    const { container } = render(
      <ExploreProvider draft={commerceApiLayout.draft}>
        <DiagramCanvas diagram={commerceApiLayout} />
      </ExploreProvider>,
    );
    nodeCardRenders.mockClear();
    fireEvent.click(container.querySelector('.sm-card[data-card-id="orders"]')!);
    // orders gains focus; sessions, not a neighbour, dims. Only their wrappers change: a card's body depends on its node.
    const emphasis = (id: string) => container.querySelector(`.sm-card[data-card-id="${id}"]`)!.getAttribute('data-emphasis');
    expect([emphasis('orders'), emphasis('sessions')]).toEqual(['focus', 'dim']);
    expect(nodeCardRenders).not.toHaveBeenCalled();
  });

  it('shares nothing document-wide with another drawing of the same diagram on the page', () => {
    function Embedded() {
      const root = useRef<HTMLDivElement>(null);
      return (
        <ViewerScope value={root}>
          <div ref={root} data-testid="embedded">
            <ExploreProvider draft={commerceApiLayout.draft} syncHash={false}>
              <DiagramCanvas diagram={commerceApiLayout} />
            </ExploreProvider>
          </div>
        </ViewerScope>
      );
    }
    const { getAllByTestId } = render(
      <>
        <StaticScene diagram={commerceApiLayout} />
        <Embedded />
        <Embedded />
      </>,
    );
    const [first, second] = getAllByTestId('embedded') as [HTMLElement, HTMLElement];
    // Arrow keys move focus to a card of the viewer they were pressed in, not the first copy in the document.
    const from = second.querySelector<HTMLElement>('.sm-card[data-card-id="orders"]')!;
    from.focus();
    fireEvent.keyDown(from, { key: 'ArrowDown' });
    expect(second.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(from);
    // Each canvas paints its dot grid from its own pattern.
    const fill = (el: HTMLElement) => el.querySelector('rect[fill^="url(#"]')!.getAttribute('fill')!.slice(5, -1);
    expect(fill(first)).not.toBe(fill(second));
    expect(first.querySelector('pattern')!.id).toBe(fill(first));
  });

  it('leaves modified keys to the browser: ⌘/Ctrl + and 0 zoom the page, Alt+← goes back', () => {
    const { container } = render(
      <ExploreProvider draft={commerceApiLayout.draft}>
        <DiagramCanvas diagram={commerceApiLayout} />
      </ExploreProvider>,
    );
    // fireEvent returns false when the handler prevented the default.
    for (const target of [container.querySelector('.sm-stage')!, container.querySelector('.sm-card[data-card-id="orders"]')!]) {
      expect(fireEvent.keyDown(target, { key: 'ArrowLeft' })).toBe(false);
      expect(fireEvent.keyDown(target, { key: '=', metaKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: '-', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: '0', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: 'ArrowLeft', altKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: 'ArrowLeft', metaKey: true })).toBe(true);
    }
  });
});
