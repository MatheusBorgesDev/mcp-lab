import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

// The prompt agendar_horario (docs/SPEC.md, section 5). A prompt is the visitor's own request, picked from a
// menu and sent in their name, so it is in pt-BR like the shop content (section 2).

const MAX_SERVICE_LENGTH = 80

const args = z.object({
  service: z
    .string()
    .trim()
    .max(MAX_SERVICE_LENGTH)
    .optional()
    .describe('O serviço que você quer, nas suas palavras. Opcional.'),
})

export function bookingRequest(service: string | undefined): string {
  const wanted = service ? `: ${service}` : ''
  const pick = service
    ? 'ache o que eu pedi (se não houver, me mostre os parecidos)'
    : 'me pergunte qual eu quero'
  return [
    `Quero agendar um horário na MCP Barber Shop${wanted}.`,
    '',
    'Me ajude assim:',
    `1. Veja os serviços com list_services e ${pick}.`,
    '2. Pergunte o dia e se prefiro algum barbeiro, consulte check_availability e me mostre alguns horários livres.',
    '3. Antes de reservar, resuma serviço, barbeiro, dia, horário e preço, e espere o meu ok.',
    '4. Depois de reservar, me mostre o código da reserva, que vou guardar, e o link da agenda ao vivo.',
  ].join('\n')
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'agendar_horario',
    {
      title: 'Agendar horário',
      description: 'Marca um horário na MCP Barber Shop, passo a passo.',
      argsSchema: args,
    },
    ({ service }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: bookingRequest(service || undefined) } }],
    }),
  )
}
