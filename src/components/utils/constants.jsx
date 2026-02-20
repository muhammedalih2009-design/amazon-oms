// P0 SECURITY: Auto-provisioning DISABLED globally
export const AUTO_WORKSPACE_PROVISIONING = false;
export const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

export function blockAutoProvisioning(actionName) {
  if (!AUTO_WORKSPACE_PROVISIONING) {
    throw new Error(`Auto-provisioning disabled: ${actionName} not allowed`);
  }
}