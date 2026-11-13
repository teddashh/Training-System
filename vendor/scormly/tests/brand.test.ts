import { expect, it } from 'vitest'
import { brand, companyThemeTokens } from '../src/brand'
import { repairCourse } from '../src/lib/repairCourse'
import { withThemeTokens } from '../src/export/packageCommon'
import { DEFAULT_THEME, THEMES } from '../src/theme/themes'
import { contrastRatio } from '../src/theme/customTheme'

it('uses the active organization and exports its palette', () => {
  expect(DEFAULT_THEME).toBe('company')
  expect(THEMES.company.label).toBe(brand.organization)
  const { course } = repairCourse({ id: 'synthetic', title: 'Synthetic course', theme: 'company', lessons: [] })
  expect(withThemeTokens(course).themeTokens).toEqual(companyThemeTokens)
  expect(contrastRatio(companyThemeTokens.brand, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(companyThemeTokens.brandDark, '#ffffff')).toBeGreaterThanOrEqual(4.5)
})
it('normalizes every active pack alias while preserving upstream presets', () => {
  for (const alias of brand.studio_theme_aliases) {
    expect(repairCourse({ id: 'synthetic', title: 'Synthetic course', theme: alias, lessons: [] }).course.theme).toBe('company')
  }
  expect(repairCourse({ id: 'synthetic', title: 'Synthetic course', theme: 'ocean', lessons: [] }).course.theme).toBe('ocean')
})
