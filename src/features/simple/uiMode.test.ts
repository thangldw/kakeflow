import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readQuickAddUsage, readUiMode, recordQuickAddUse, writeUiMode } from './uiMode'

const MODE_KEY = 'kakeflow.uiMode'
const usageKey = (householdId: string) => `kakeflow.simpleUsage.${householdId}`

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('ui mode storage', () => {
  it('defaults to full when nothing is stored or no household is known', () => {
    expect(readUiMode('a')).toBe('full')
    expect(readUiMode(null)).toBe('full')
  })

  it('stores the mode per household', () => {
    writeUiMode('a', 'simple')
    expect(readUiMode('a')).toBe('simple')
    expect(readUiMode('b')).toBe('full')
    writeUiMode('b', 'simple')
    writeUiMode('a', 'full')
    expect(readUiMode('a')).toBe('full')
    expect(readUiMode('b')).toBe('simple')
  })

  it('does not read a mode for a null household even when others are stored', () => {
    writeUiMode('a', 'simple')
    expect(readUiMode(null)).toBe('full')
  })

  it('falls back to full for corrupt or invalid stored data', () => {
    localStorage.setItem(MODE_KEY, '{not json')
    expect(readUiMode('a')).toBe('full')
    localStorage.setItem(MODE_KEY, '[]')
    expect(readUiMode('a')).toBe('full')
    localStorage.setItem(MODE_KEY, '"simple"')
    expect(readUiMode('a')).toBe('full')
    localStorage.setItem(MODE_KEY, JSON.stringify({ a: 'compact', b: 3, c: 'simple' }))
    expect(readUiMode('a')).toBe('full')
    expect(readUiMode('b')).toBe('full')
    expect(readUiMode('c')).toBe('simple')
  })

  it('recovers from corrupt stored data when writing', () => {
    localStorage.setItem(MODE_KEY, '{not json')
    writeUiMode('a', 'simple')
    expect(readUiMode('a')).toBe('simple')
  })

  it('never throws when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
    expect(readUiMode('a')).toBe('full')
    expect(() => writeUiMode('a', 'simple')).not.toThrow()
    expect(() => writeUiMode('a', 'full')).not.toThrow()
  })
})

describe('ui mode storage with prototype-like household ids', () => {
  it('round-trips __proto__ and constructor as plain households without polluting Object.prototype', () => {
    writeUiMode('a', 'simple')
    writeUiMode('__proto__', 'simple')
    writeUiMode('constructor', 'simple')
    expect(readUiMode('__proto__')).toBe('simple')
    expect(readUiMode('constructor')).toBe('simple')
    expect(readUiMode('a')).toBe('simple')
    expect(readUiMode('toString')).toBe('full')
    expect(Object.keys(JSON.parse(localStorage.getItem(MODE_KEY) ?? '{}')).sort()).toEqual(['__proto__', 'a', 'constructor'])
    expect(({} as Record<string, unknown>).simple).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('a')
    expect(typeof ({}).constructor).toBe('function')

    writeUiMode('__proto__', 'full')
    expect(readUiMode('__proto__')).toBe('full')
    expect(readUiMode('constructor')).toBe('simple')
    expect(readUiMode('a')).toBe('simple')
  })

  it('reads a stored "__proto__" key as data, not as the prototype', () => {
    localStorage.setItem(MODE_KEY, '{"__proto__":"simple","b":"simple"}')
    expect(readUiMode('__proto__')).toBe('simple')
    expect(readUiMode('b')).toBe('simple')
    expect(readUiMode('c')).toBe('full')
    expect(Object.prototype).not.toHaveProperty('b')
  })

  it('does not report simple for a household without an entry just because the name exists on Object.prototype', () => {
    writeUiMode('a', 'simple')
    for (const id of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) expect(readUiMode(id)).toBe('full')
  })
})

describe('quick-add usage storage', () => {
  it('starts empty', () => {
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: {}, lastPayingAccountId: null })
  })

  it('counts category uses and remembers the latest paying account', () => {
    recordQuickAddUse('a', 'food', 'cash')
    recordQuickAddUse('a', 'food', 'card')
    recordQuickAddUse('a', 'rent', 'bank')
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: { food: 2, rent: 1 }, lastPayingAccountId: 'bank' })
    expect(readQuickAddUsage('b')).toEqual({ categoryCounts: {}, lastPayingAccountId: null })
  })

  it('keeps usage under a per-household key', () => {
    recordQuickAddUse('a', 'food', 'cash')
    expect(localStorage.getItem(usageKey('a'))).not.toBeNull()
    expect(localStorage.getItem(usageKey('b'))).toBeNull()
  })

  it('treats corrupt usage JSON as empty and recovers on the next record', () => {
    localStorage.setItem(usageKey('a'), '{not json')
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: {}, lastPayingAccountId: null })
    recordQuickAddUse('a', 'food', 'cash')
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: { food: 1 }, lastPayingAccountId: 'cash' })
  })

  it('rejects invalid shapes and keeps only valid counts', () => {
    localStorage.setItem(usageKey('a'), JSON.stringify([1, 2]))
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: {}, lastPayingAccountId: null })
    localStorage.setItem(usageKey('a'), JSON.stringify({ categoryCounts: 'x', lastPayingAccountId: 5 }))
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: {}, lastPayingAccountId: null })
    // 1e999 parses to Infinity, which must be rejected as non-finite.
    localStorage.setItem(usageKey('a'), '{"categoryCounts":{"ok":3,"neg":-1,"frac":1.5,"str":"2","nan":null,"inf":1e999},"lastPayingAccountId":"cash"}')
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: { ok: 3 }, lastPayingAccountId: 'cash' })
  })

  it('counts __proto__ and constructor category ids as plain data and keeps other households', () => {
    recordQuickAddUse('a', 'food', 'cash')
    recordQuickAddUse('__proto__', '__proto__', 'cash')
    recordQuickAddUse('__proto__', '__proto__', 'card')
    recordQuickAddUse('__proto__', 'constructor', 'card')
    recordQuickAddUse('constructor', 'constructor', 'bank')
    const usage = readQuickAddUsage('__proto__')
    expect(Object.getPrototypeOf(usage.categoryCounts)).toBe(Object.prototype)
    expect(Object.entries(usage.categoryCounts).sort()).toEqual([['__proto__', 2], ['constructor', 1]])
    expect(usage.lastPayingAccountId).toBe('card')
    expect(readQuickAddUsage('constructor')).toEqual({ categoryCounts: { constructor: 1 }, lastPayingAccountId: 'bank' })
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: { food: 1 }, lastPayingAccountId: 'cash' })
    expect(localStorage.getItem(usageKey('__proto__'))).not.toBeNull()
    expect(({} as Record<string, unknown>).food).toBeUndefined()
    expect(typeof ({}).constructor).toBe('function')
  })

  it('reads a stored "__proto__" category count without changing the prototype', () => {
    localStorage.setItem(usageKey('a'), '{"categoryCounts":{"__proto__":4,"food":1},"lastPayingAccountId":"cash"}')
    const usage = readQuickAddUsage('a')
    expect(Object.hasOwn(usage.categoryCounts, '__proto__')).toBe(true)
    expect(usage.categoryCounts['__proto__']).toBe(4)
    expect(usage.categoryCounts.food).toBe(1)
    expect(Object.getPrototypeOf(usage.categoryCounts)).toBe(Object.prototype)
  })

  it('never throws when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(readQuickAddUsage('a')).toEqual({ categoryCounts: {}, lastPayingAccountId: null })
    expect(() => recordQuickAddUse('a', 'food', 'cash')).not.toThrow()
  })
})
