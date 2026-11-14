/** Deployment identity; future runtime organization/logo overrides belong here. */
import data from '@brand/brand.json';
import logo from '@brand/logo.svg';
import horizontalLogo from '@brand/logo-horizontal.svg';
export const brand = { ...data, logo, horizontalLogo, customized: false, uploadedLogo: false };

export type Organization = { name: string; title: string; logo_url: string | null };
export type SessionSettings = { organization?: Organization; sign_in?: { entra: boolean; google: boolean; password?: boolean }; email_enabled?: boolean };
export const signIn = { entra: false, google: false, email: true, password: true };
export function applySessionSettings(session: SessionSettings) {
  if (session.organization) {
    const org = session.organization;
    Object.assign(brand, { uploadedLogo: !!org.logo_url, customized: org.name !== data.organization || org.title !== data.title, organization: org.name, title: org.title,
      logo: org.logo_url || logo, horizontalLogo: org.logo_url || horizontalLogo,
      logo_alt: org.logo_url ? org.name : data.logo_alt });
  }
  Object.assign(signIn, session.sign_in, { email: session.email_enabled !== false });
}
