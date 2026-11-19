import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { commerceApiLayout } from '../samples/commerce-api.layout';
import { ExploreProvider } from '../explore/ExploreContext';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
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
