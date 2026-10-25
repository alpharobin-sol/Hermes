// A transaction made outside Portfolio (a deposit) makes Portfolio's next read a fresh one, not the API's minute-old
// answer
let changed = false

export function markPortfolioChanged() {
  changed = true
}

export function takePortfolioChanged(): boolean {
  const was = changed
  changed = false
  return was
}
