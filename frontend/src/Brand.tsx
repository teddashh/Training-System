import { brand } from "./brand";

/** The active pack supplies artwork, intrinsic size and accessible name. */
export default function Brand({ className = "" }: { className?: string }) {
  return <img className={"brand-logo " + (brand.uploadedLogo ? "uploaded-logo " : "") + className} src={brand.logo} width={brand.logo_size[0]} height={brand.logo_size[1]} alt={brand.logo_alt} />;
}
