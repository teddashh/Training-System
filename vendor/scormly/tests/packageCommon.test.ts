// Export asset collection (src/export/packageCommon.ts).

import { describe, test, expect, vi, afterEach } from 'vitest'
import JSZip from 'jszip'
import { addSchemas, collectAssetPaths, SCHEMA_FILES } from '../src/export/packageCommon'
import type { Course } from '../src/types/course'

describe('collectAssetPaths', () => {
  test('includes the hotspot block image', () => {
    const course = {
      lessons: [{
        id: 'l', title: 'L', status: 'draft',
        blocks: [{
          id: 'b', type: 'hotspot', settings: {},
          data: { src: 'assets/images/map-1.png', alt: '', hotspots: [{ id: 'h', x: 1, y: 2, title: 't', text: '' }] },
        }],
      }],
    } as unknown as Course
    expect([...collectAssetPaths(course)]).toEqual(['assets/images/map-1.png'])
  })
})

describe('addSchemas', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  test('adds every schema file at the package root', async () => {
    vi.stubGlobal('fetch', async () => new Response('<xs:schema/>'))
    const zip = new JSZip()
    expect(await addSchemas(zip, 'scorm2004')).toBe(true)
    expect(Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort()).toEqual([...SCHEMA_FILES.scorm2004].sort())
  })

  test('a failed schema download skips all schemas instead of failing the export', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('lom.xsd') ? new Response('', { status: 404 }) : new Response('<xs:schema/>'))
    const zip = new JSZip()
    expect(await addSchemas(zip, 'scorm2004')).toBe(false)
    expect(Object.keys(zip.files)).toEqual([])
  })
})
