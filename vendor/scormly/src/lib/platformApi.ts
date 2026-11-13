/** The Studio shares the platform's mount and same-origin session cookie. */
export const workspaceBase = import.meta.env.BASE_URL.replace(/studio\/$/, '')
export const companyApi = workspaceBase + 'api/'
