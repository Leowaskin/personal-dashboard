export const maximumOutputTokens = 2048;
export function reserveCost(body: unknown, inputRate: number, outputRate: number) {
  if (![inputRate, outputRate].every(rate => Number.isFinite(rate) && rate > 0)) throw new Error('Prices must be positive finite numbers');
  return ((Buffer.byteLength(JSON.stringify(body)) + 4096) * inputRate + maximumOutputTokens * outputRate) / 1e6;
}
export function withinBudget(reserved: number, next: number) { return reserved >= 0 && next > 0 && Number.isFinite(next) && reserved + next <= 5; }
