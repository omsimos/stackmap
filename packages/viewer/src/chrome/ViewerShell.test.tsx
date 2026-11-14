import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commerceApiLayout } from '../samples/commerce-api.layout';
import { ViewerShell } from './ViewerShell';

describe('ViewerShell', () => {
  // Wide enough for the inspector to start open (it collapses below 1100px).
  beforeEach(() => {
    innerWidth = 1440;
    location.hash = '';
  });

  it('shows title, kind badge and counts', () => {
    render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Commerce API' })).toBeInTheDocument();
    expect(screen.getByText('Architecture')).toBeInTheDocument();
    expect(screen.getByText('6 nodes · 9 connections')).toBeInTheDocument();
  });

  it('titles the diagram one level down when embedded in a page with its own h1', () => {
    const { container } = render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} titleAs="h2" />);
    expect(within(container.querySelector('header')!).getByRole('heading', { level: 2, name: 'Commerce API' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('leaves the main landmark to the page it is embedded in', () => {
    const { unmount } = render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    unmount();
    render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} titleAs="h2" />);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('lists Overview first, then agent views, as tabs', () => {
    render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Data tier']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('legend counts nodes by type', () => {
    render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Service').closest('li')).toHaveTextContent('3');
  });

  it('theme button calls back and names the next theme', () => {
    const onToggle = vi.fn();
    render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders the scene: one named group per card and one path per edge', () => {
    const { container } = render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    expect(screen.getByRole('button', { name: 'Orders, Database' })).toBeInTheDocument();
    expect(container.querySelectorAll('.sm-card')).toHaveLength(6);
    expect(container.querySelectorAll('path.sm-edge-path')).toHaveLength(9);
    expect(screen.getByText('100%')).toBeInTheDocument(); // zero-size stage in jsdom → identity transform
  });

  it('names the diagram once, in the header: no title card on the canvas', () => {
    render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Diagram details' })).toBeNull();
    expect(screen.getAllByText('Commerce API')).toHaveLength(2); // the header and the inspector
  });

  it('hovering a legend row dims every other type until the pointer leaves', () => {
    const { container } = render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    const row = within(screen.getByRole('list', { name: 'Legend' })).getByText('Service').closest('li')!;
    const lit = () => [...container.querySelectorAll('.sm-card')].filter((c) => c.getAttribute('data-emphasis') !== 'dim').length;
    expect(lit()).toBe(6);
    fireEvent.mouseEnter(row);
    expect(lit()).toBe(3);
    fireEvent.mouseLeave(row);
    expect(lit()).toBe(6);
  });

  it('H hides the toolbar outside focus too, and the button beside it does the same', () => {
    render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    fireEvent.keyDown(window, { key: 'h' });
    expect(screen.queryByRole('button', { name: 'Search nodes (/)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the toolbar (H)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the toolbar (H)' }));
    expect(screen.queryByRole('button', { name: 'Search nodes (/)' })).toBeNull();
  });

  it('a card with nothing but a link still has it in the inspector, where the keyboard reaches it', () => {
    const draft = {
      ...commerceApiLayout.draft,
      nodes: commerceApiLayout.draft.nodes.map((n) =>
        n.id === 'orders' ? { ...n, card: { title: n.card.title, cta: { label: 'Open runbook', href: 'https://example.com/runbook' } } } : n,
      ),
    };
    render(<ViewerShell diagram={{ ...commerceApiLayout, draft }} theme="light" onToggleTheme={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Orders, Database' }));
    const link = within(screen.getByRole('complementary', { name: 'Inspector' })).getByRole('link', { name: 'Open runbook' });
    expect(link).toHaveAttribute('href', 'https://example.com/runbook');
  });

  it('has no editor controls', () => {
    render(<ViewerShell diagram={commerceApiLayout} theme="light" onToggleTheme={() => {}} />);
    for (const name of [/add/i, /undo/i, /redo/i, /lock/i]) expect(screen.queryByRole('button', { name })).toBeNull();
  });
});
