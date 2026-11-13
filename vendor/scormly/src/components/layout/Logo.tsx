import { brand } from '../../brand'

export default function Logo({ compact = false }: { compact?: boolean }) {
  return <div className={`studio-brand ${compact ? 'compact' : ''}`}>
    <img className={brand.uploadedLogo ? "uploaded-logo" : undefined} src={compact ? brand.horizontalLogo : brand.logo} alt={brand.logo_alt} />
  </div>
}
