export function parseEmailsFromParticipantes(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

/** mailto:dest1,dest2?subject=...&body=... (to va en la parte del path, no en ?to=). */
export function buildMailtoLink(options: {
  toEmails: string[];
  subject?: string;
  body?: string;
}): string {
  const to = options.toEmails.filter(Boolean).join(',');
  const params = new URLSearchParams();
  if (options.subject) params.set('subject', options.subject);
  if (options.body) params.set('body', options.body);
  const q = params.toString();
  return `mailto:${to}${q ? `?${q}` : ''}`;
}
