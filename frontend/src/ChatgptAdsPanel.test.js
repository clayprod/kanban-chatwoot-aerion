import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import ChatgptAdsPanel from './ChatgptAdsPanel';
jest.mock('axios', () => ({ put: jest.fn(), post: jest.fn() }));
beforeEach(() => jest.clearAllMocks());
test('connection uses a password field, clears the key after success and cannot activate advertising', async () => {
  axios.put.mockResolvedValue({ data: { configured: true } });const refresh = jest.fn();
  render(<ChatgptAdsPanel isAdmin onRefresh={refresh} />);
  const key = screen.getByLabelText('Advertiser API key do ChatGPT Ads');
  fireEvent.change(key, { target: { value: 'test-advertiser-key-123' } });fireEvent.click(screen.getByRole('button', { name: 'Testar e conectar ChatGPT Ads' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());expect(key).toHaveValue('');expect(axios.post).not.toHaveBeenCalled();
});
test('viewers see the connection state without a key form and unavailable data is not shown as zero', () => {
  render(<ChatgptAdsPanel data={{ snapshot: { observedAt: '2026-11-04', datasets: { campaigns: { available: false } } } }} />);
  expect(screen.queryByLabelText('Advertiser API key do ChatGPT Ads')).not.toBeInTheDocument();
  expect(screen.getAllByText('Indisponível').length).toBe(4);
});
