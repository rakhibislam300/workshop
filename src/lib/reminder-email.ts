export function emailReminderAvailable() {
  return Boolean(process.env.RESEND_API_KEY && process.env.REMINDER_FROM_EMAIL && process.env.REMINDER_WORKER_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
