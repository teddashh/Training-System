import type { BlockSettings } from '../types/course'
import { useAssetUrl } from '../hooks/useAssetUrl'
import { blockWrapperProps } from './styleClasses'

/** blockWrapperProps with the background photo resolved to a displayable URL. */
export function useBlockWrapper(settings: BlockSettings | undefined) {
  const url = useAssetUrl(settings?.background === 'image' ? settings.backgroundImage ?? '' : '')
  return blockWrapperProps(settings, url || undefined)
}
