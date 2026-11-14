import { ProtocolError, ProtocolErrorCode, type McpServer } from '@modelcontextprotocol/server'
import type { Barbershop } from '../app/barbershop.js'
import type { Catalog } from '../db/schedule.js'
import type { ShopRules } from '../domain/rules.js'
import { formatMinutes } from './format.js'
import { describeError, publicOrigin } from './tools.js'

// The resource salon://info (docs/SPEC.md, section 5): shop content, so in pt-BR (section 2). The hours come
// from the database and the policies from the shop rules, so the text never drifts from what the tools apply.

const INFO_URI = 'salon://info'

/** Fictitious on purpose, like the shop. */
const ADDRESS = 'Rua das Navalhas, 42, Vila Madalena, São Paulo, SP (endereço fictício)'

/** Monday first, as the sign on a shop's door reads. */
const WEEKDAYS = [
  [1, 'Segunda'],
  [2, 'Terça'],
  [3, 'Quarta'],
  [4, 'Quinta'],
  [5, 'Sexta'],
  [6, 'Sábado'],
  [0, 'Domingo'],
] as const

/** "1 hora", "2 horas", "90 minutos". */
function duration(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutos`
  return minutes === 60 ? '1 hora' : `${minutes / 60} horas`
}

/** The shop is open from the first start to the last end of the active professionals that day. */
function openingHours(catalog: Catalog, weekday: number): string {
  const active = new Set(catalog.professionals.filter((p) => p.active).map((p) => p.id))
  const intervals = catalog.workingHours.filter((w) => w.weekday === weekday && active.has(w.professionalId))
  if (intervals.length === 0) return 'fechado'
  const start = Math.min(...intervals.map((w) => w.startMin))
  const end = Math.max(...intervals.map((w) => w.endMin))
  return `${formatMinutes(start)} às ${formatMinutes(end)}`
}

export function salonInfo(catalog: Catalog, rules: ShopRules, liveAgenda: string): string {
  return [
    '# MCP Barber Shop',
    '',
    'Barbearia fictícia, servidor MCP de verdade: uma demonstração pública. A agenda é a mesma para todos os ' +
      `visitantes, e cada reserva aparece na hora na agenda ao vivo: ${liveAgenda}`,
    '',
    `Endereço: ${ADDRESS}`,
    '',
    `## Horário de funcionamento (fuso ${rules.timeZone})`,
    '',
    ...WEEKDAYS.map(([weekday, name]) => `- ${name}: ${openingHours(catalog, weekday)}`),
    '',
    'Cada barbeiro tem a sua escala (list_professionals). Feriados e folgas aparecem na consulta de horários ' +
      '(check_availability).',
    '',
    '## Políticas',
    '',
    `- Reservas com pelo menos ${duration(rules.minAdvanceMinutes)} de antecedência e até ${rules.maxDaysAhead} dias ` +
      `à frente, em horários de ${rules.slotMinutes} em ${rules.slotMinutes} minutos.`,
    `- Remarcar e cancelar: até ${duration(rules.minChangeAdvanceMinutes)} antes do início, com o código da reserva. ` +
      'Sem custo: nada é cobrado.',
    '- O código da reserva é o único jeito de consultar, remarcar ou cancelar: guarde-o.',
    `- Cada visitante pode ter até ${rules.maxActiveBookingsPerVisitor} reservas ativas.`,
    `- Cada dia aceita reservas até ${rules.maxDailyOccupancyPercent}% do tempo de trabalho; o resto fica livre para ` +
      'o próximo visitante.',
    '- O nome é opcional e nunca aparece na página pública.',
    '- Todo dia às 3h a agenda reinicia: as reservas dos visitantes são apagadas e as fictícias, refeitas.',
  ].join('\n')
}

/**
 * Registers salon://info. A failure (database down) is logged on the server and reaches the client without
 * details: the SDK would otherwise send the error's own message.
 */
export function registerResources(server: McpServer, { shop }: { shop: Barbershop }): void {
  server.registerResource(
    'salon_info',
    INFO_URI,
    {
      title: 'Informações da barbearia',
      description: 'Endereço fictício, horário de funcionamento e políticas da MCP Barber Shop.',
      mimeType: 'text/markdown',
    },
    async (uri, ctx) => {
      let catalog: Catalog
      try {
        catalog = await shop.catalog()
      } catch (error) {
        console.error('[mcp] resource failed', describeError(error))
        throw new ProtocolError(ProtocolErrorCode.InternalError, 'Something went wrong on our side. Try again shortly.')
      }
      const text = salonInfo(catalog, shop.rules, `${publicOrigin(ctx)}/`)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
    },
  )
}
