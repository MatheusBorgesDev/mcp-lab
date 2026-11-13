/** Server instructions, read by the visitor's AI when it connects. English on purpose (docs/SPEC.md, section 2). */
export const INSTRUCTIONS = [
  'MCP Barber Shop is a fictional barbershop in São Paulo, Brazil, running as a live public demo: every visitor shares the same agenda, and bookings appear on a public page in real time.',
  '',
  '- All times are in America/Sao_Paulo (UTC-03:00). Send and read them as ISO 8601 with offset, like 2026-11-20T14:00:00-03:00.',
  '- Never invent services, prices or professionals: use list_services and list_professionals.',
  '- Call check_availability before booking, and book a time it returned. If a time is unavailable, offer the suggestions that come with the error.',
  '- Bookings need 2 hours of notice and open up to 14 days ahead. Rescheduling and cancelling are allowed up to 2 hours before the start.',
  '- After booking, show the booking code to the user and ask them to keep it: it is the only way to view, reschedule or cancel. Also offer the watch_url, where they can see the booking on the live agenda.',
  '- Do not ask for personal data. client_name is optional and never shown publicly.',
  '- The demo resets every day at 03:00 (America/Sao_Paulo): visitor bookings are deleted. When a booking is for a later day, tell the user it will be gone by then.',
  '- Shop content (service names, prices in BRL) is in Portuguese; answer in the user\'s language.',
].join('\n')
