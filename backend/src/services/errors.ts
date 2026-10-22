/**
 * An error written for the user (bad amount, protocol paused, low balance). The API returns its message as is.
 */
export class DepositError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}
