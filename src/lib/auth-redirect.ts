// Only same-origin, absolute application paths may survive the auth flow.
export function safeAuthNext(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/dashboard";
  try {
    const base = "https://jibon.invalid";
    const target = new URL(value, base);
    return target.origin === base ? `${target.pathname}${target.search}${target.hash}` : "/dashboard";
  } catch { return "/dashboard"; }
}
