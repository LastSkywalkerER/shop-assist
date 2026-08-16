import { describe, it, expect } from 'vitest'
import { categoryIdForLabel, suggestLabelFromExpenses, type LabelExpenseLite } from './labelSuggestion'

const today = new Date().toISOString()
const longAgo = new Date(Date.now() - 900 * 86_400_000).toISOString()

function expense(over: Partial<LabelExpenseLite>): LabelExpenseLite {
  return { name: 'Магаз', date: today, ...over }
}

describe('suggestLabelFromExpenses', () => {
  it('returns nothing when there is no history', () => {
    expect(suggestLabelFromExpenses({ storeName: 'ДобрыняДар' }, [])).toEqual({})
  })

  it('reuses the label the store is usually given', () => {
    const expenses = [
      expense({ name: 'Продукты', storeId: 's1' }),
      expense({ name: 'Продукты', storeId: 's1' }),
      expense({ name: 'Одежда', storeId: 's2' }),
    ]
    expect(suggestLabelFromExpenses({ storeId: 's1' }, expenses).name).toBe('Продукты')
  })

  it('matches a store name against an existing label', () => {
    const expenses = [
      expense({ name: 'ЖКХ', storeId: 's9' }),
      expense({ name: 'Одежда', storeId: 's2' }),
    ]
    expect(suggestLabelFromExpenses({ storeName: 'Кобринское ЖКХ' }, expenses).name).toBe('ЖКХ')
  })

  it('prefers the store history over a weaker name match', () => {
    const expenses = [
      expense({ name: 'Коммуналка', storeId: 's1' }),
      expense({ name: 'ЖКХ', storeId: 's2' }),
    ]
    const got = suggestLabelFromExpenses({ storeId: 's1', storeName: 'Кобринское ЖКХ' }, expenses)
    expect(got.name).toBe('Коммуналка')
  })

  it('carries over the category last used with that label', () => {
    const expenses = [
      expense({ name: 'Продукты', storeId: 's1', categoryId: 'c-old', date: longAgo }),
      expense({ name: 'Продукты', storeId: 's1', categoryId: 'c-new' }),
    ]
    expect(suggestLabelFromExpenses({ storeId: 's1' }, expenses)).toEqual({
      name: 'Продукты',
      categoryId: 'c-new',
    })
  })

  it('ignores unnamed expenses', () => {
    const expenses = [expense({ name: undefined, storeId: 's1' }), expense({ name: '  ', storeId: 's1' })]
    expect(suggestLabelFromExpenses({ storeId: 's1' }, expenses)).toEqual({})
  })

  it('does not match an unrelated store name', () => {
    const expenses = [expense({ name: 'Одежда', storeId: 's2' })]
    expect(suggestLabelFromExpenses({ storeName: 'ДобрыняДар' }, expenses)).toEqual({})
  })
})

describe('categoryIdForLabel', () => {
  it('picks the most recent categorised expense with that label', () => {
    const expenses = [
      expense({ name: 'Аптека', categoryId: 'c1', date: longAgo }),
      expense({ name: 'аптека', categoryId: 'c2' }),
      expense({ name: 'Аптека', categoryId: undefined }),
    ]
    expect(categoryIdForLabel('Аптека', expenses)).toBe('c2')
  })

  it('returns undefined when the label was never categorised', () => {
    expect(categoryIdForLabel('Аптека', [expense({ name: 'Аптека' })])).toBeUndefined()
  })
})
