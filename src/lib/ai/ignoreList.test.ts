import { describe, it, expect } from 'vitest'
import { normalizeIgnoreName, namesMatch, isIgnored } from './ignoreList'

describe('normalizeIgnoreName', () => {
  it('lowercases, strips punctuation and ellipsis, collapses spaces', () => {
    expect(normalizeIgnoreName('Retail BLR PINSK PT KOFEJNYA …')).toBe('retail blr pinsk pt kofejnya')
    expect(normalizeIgnoreName('  CH Debit BLR MINSK P2P_SDBO  ')).toBe('ch debit blr minsk p2p sdbo')
  })
})

describe('namesMatch', () => {
  it('matches identical (incl. truncated-identically) names', () => {
    expect(namesMatch('Retail BLR PINSK PT KOFEJNYA …', 'Retail BLR PINSK PT KOFEJNYA …')).toBe(true)
  })

  it('matches a truncated name with its fuller form (prefix)', () => {
    expect(namesMatch('Retail BLR PINSK PT KOFEJNYA', 'Retail BLR PINSK PT KOFEJNYA CLUB')).toBe(true)
  })

  it('matches via token containment', () => {
    expect(namesMatch('Retail BLR PINSK KOFEJNYA', 'Retail BLR PINSK PT KOFEJNYA CLUB')).toBe(true)
  })

  it('does NOT merge distinct merchants sharing a generic prefix', () => {
    expect(namesMatch('Retail BLR MINSK TORGOVY', 'Retail BLR MINSK STOLOVAYA')).toBe(false)
    expect(namesMatch('Retail BLR PINSK PT KOFEJNYA', 'Retail BLR PINSK LAVAZZA CLUB')).toBe(false)
  })

  it('does not match empty names', () => {
    expect(namesMatch('', 'anything')).toBe(false)
    expect(namesMatch('…', 'anything')).toBe(false)
  })
})

describe('isIgnored', () => {
  const list = ['Retail BLR PINSK PT KOFEJNYA …', 'CH Debit BLR MINSK P2P_SDBO']
  it('flags names matching any ignore entry', () => {
    expect(isIgnored('Retail BLR PINSK PT KOFEJNYA CLUB', list)).toBe(true)
    expect(isIgnored('CH Debit BLR MINSK P2P_SDBO', list)).toBe(true)
  })
  it('lets unrelated names through', () => {
    expect(isIgnored('Retail BLR MINSK STOLOVAYA', list)).toBe(false)
  })
})
