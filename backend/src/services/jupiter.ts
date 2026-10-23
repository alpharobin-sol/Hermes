import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';

/**
 * Client for the Jupiter swap API (quotes and swap transactions).
 * Uses JUPITER_API_KEY when set, which stays server-side.
 */
export function createJupiterClient(): AxiosInstance {
  const apiKey = process.env.JUPITER_API_KEY;

  const client = axios.create({
    baseURL: process.env.JUPITER_API_URL || 'https://lite-api.jup.ag/swap/v1',
    timeout: 15000,
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  });

  axiosRetry(client, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
      return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
             error.response?.status === 429;
    },
  });

  return client;
}
