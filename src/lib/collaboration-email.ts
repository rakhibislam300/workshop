export function collaborationEmailAvailable() {
  return Boolean(
    process.env.RESEND_API_KEY &&
    process.env.REMINDER_FROM_EMAIL &&
    process.env.COLLABORATION_EMAIL_WORKER_SECRET &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.APP_URL,
  );
}

export function collaborationAppUrl() {
  const configured = process.env.APP_URL;
  if (!configured) throw new Error("APP_URL is required for collaboration email delivery.");
  return configured.replace(/\/$/, "");
}
