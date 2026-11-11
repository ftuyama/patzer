// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../api', () => ({ api: { get, post, put, patch: put, del: vi.fn() } }));

import i18n from '../../i18n';
import AdminSystem from './System';

beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (path: string) => path === '/api/admin/system'
    ? { llm_provider: 'ollama', ollama_url: 'http://192.168.1.126:11434', ollama_model: 'mistral:7b' }
    : {});
  post.mockImplementation(async (path: string) => path === '/api/admin/test/ollama'
    ? { ok: true, models: [{ name: 'gpt-oss:20b' }] }
    : { ok: true });
});
afterEach(cleanup);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AdminSystem /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Admin → System → providers', () => {
  it('shows the Gemini API-key field for Gemini only, and hides it again for Ollama', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Gemini' }));
    expect(await screen.findByText('Gemini-API-Schlüssel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ollama' }));
    expect(screen.queryByText('Gemini-API-Schlüssel')).toBeNull();
  });
});

describe('Admin → System → model', () => {
  it('shows a saved model the server does not have, and lets you pick the one it has', async () => {
    // The bug: the select showed gpt-oss:20b while mistral:7b stayed saved, and
    // with one option there was no change event — Save kept the missing model.
    renderPage();
    const select = await screen.findByDisplayValue('mistral:7b (auf diesem Server nicht vorhanden)') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'gpt-oss:20b' } });
    expect(select.value).toBe('gpt-oss:20b');
  });
});

describe('Admin → System → test the coach', () => {
  // The coach failing is only visible inside a game; this button runs the real
  // pipeline on a sample blunder so the admin sees the answer — or the
  // provider's own error — right here.
  it('shows the coach answer with the model that produced it', async () => {
    post.mockImplementation(async (path: string) => path === '/api/admin/test/coach'
      ? { ok: true, ms: 900, source: 'llm', model: 'gemini-flash-lite-latest', text: 'Der Zug verliert sofort.' }
      : { ok: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Trainer testen' }));
    expect(await screen.findByText('Der Zug verliert sofort.')).toBeTruthy();
    expect(screen.getByText(/900 ms/)).toBeTruthy();
    expect(screen.getByText(/gemini-flash-lite-latest/)).toBeTruthy();
  });

  it('shows the provider error verbatim, not just "no answer"', async () => {
    post.mockImplementation(async (path: string) => path === '/api/admin/test/coach'
      ? { ok: false, ms: 300, error: 'llm_http_404: This model models/gemini-2.5-flash-lite is no longer available to new users.' }
      : { ok: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Trainer testen' }));
    expect(await screen.findByText(/no longer available to new users/)).toBeTruthy();
  });
});
