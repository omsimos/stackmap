import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { commerceApiLayout } from '../samples/commerce-api.layout';
import { ExploreProvider, useExplore } from '../explore/ExploreContext';
import { Toolbar } from './Toolbar';

let explore: ReturnType<typeof useExplore>;
function Spy() {
  explore = useExplore();
  return null;
}

describe('Toolbar', () => {
  it('shows one popover at a time, even when search is opened from outside the toolbar', () => {
    render(
      <ExploreProvider draft={commerceApiLayout.draft} syncHash={false}>
        <Toolbar theme="light" onToggleTheme={() => {}} exports={false} />
        <Spy />
      </ExploreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter by type' }));
    expect(screen.getByRole('button', { name: 'Filter by type' })).toHaveAttribute('aria-expanded', 'true');
    // A page beside the viewer (the website's demo buttons) opens search through the explorer, without a click here.
    act(() => explore.dispatch({ type: 'search', query: 'orders' }));
    expect(screen.getByRole('button', { name: 'Filter by type' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Search nodes (/)' })).toHaveAttribute('aria-expanded', 'true');
    // Closing search doesn't bring the lens back.
    act(() => explore.dispatch({ type: 'search', query: null }));
    expect(screen.getByRole('button', { name: 'Filter by type' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('presses Trace or Route for the mode that is on, and disables Trace while routing', () => {
    render(
      <ExploreProvider draft={commerceApiLayout.draft} syncHash={false}>
        <Toolbar theme="light" onToggleTheme={() => {}} exports={false} />
      </ExploreProvider>,
    );
    const trace = screen.getByRole('button', { name: 'Trace upstream and downstream of the selection' });
    const route = screen.getByRole('button', { name: 'Route between two nodes (R)' });
    fireEvent.click(trace);
    expect(trace).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(route);
    expect(route).toHaveAttribute('aria-pressed', 'true');
    expect(trace).toHaveAttribute('aria-pressed', 'false');
    expect(trace).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Pick where the route starts');
  });
});
