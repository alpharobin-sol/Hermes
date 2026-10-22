// The admin panel is off unless ADMIN_PANEL_ENABLED="true" is set.
// Re-enabling it also needs SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSCODE in the deploy env.
export function isAdminPanelEnabled(): boolean {
  return process.env.ADMIN_PANEL_ENABLED === "true"
}
