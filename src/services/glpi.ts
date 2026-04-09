import type { Conversation, ConversationStatus, ChatLog } from '../db/types.js';
import { repairMojibake } from '../lib/text.js';
const GLPI_BASE_URL = process.env.GLPI_BASE_URL || 'http://137.184.87.234/glpi/apirest.php';
const GLPI_APP_TOKEN = process.env.GLPI_APP_TOKEN || '';
const GLPI_AUTH_BASIC = process.env.GLPI_AUTH_BASIC || '';
const GLPI_TIMEOUT = 15_000;

export interface GLPITicketResult {
  success: boolean;
  ticketId?: number;
  message: string;
  error?: string;
}

export interface GLPICloseResult {
  success: boolean;
  ticketId: number;
  message: string;
  solutionAdded?: boolean;
  error?: string;
}

export interface ConversationTicketData {
  conversation: Conversation;
  messages: ChatLog[];
  reason: string;
  ticketTypeId?: number;
  ticketTypeName?: string;
  ticketSummary?: string;
  urgencyOverride?: number;
  previousStatus?: ConversationStatus;
  
  conversationPriority?: string | null;
}

export interface CloseTicketData {
  ticketId: number;
  resolution: string;
  solutionTypeId?: number;
}

async function initSession(): Promise<string> {
  const response = await fetch(`${GLPI_BASE_URL}/initSession`, {
    method: 'GET',
    headers: {
      'App-Token': GLPI_APP_TOKEN,
      'Authorization': GLPI_AUTH_BASIC,
    },
    signal: AbortSignal.timeout(GLPI_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GLPI initSession failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { session_token: string };

  if (!data.session_token) {
    throw new Error('GLPI initSession: no session_token in response');
  }

  return data.session_token;
}

async function killSession(sessionToken: string): Promise<void> {
  try {
    await fetch(`${GLPI_BASE_URL}/killSession`, {
      method: 'GET',
      headers: {
        'App-Token': GLPI_APP_TOKEN,
        'Session-Token': sessionToken,
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
  }
}

async function createTicketRaw(
  sessionToken: string,
  title: string,
  content: string,
  opts: { itilcategoryId?: number; type?: number; urgency?: number; priority?: number }
): Promise<{ id: number; message: string }> {
  const body = {
    input: {
      name: title,
      content,
      type: opts.type ?? 1,
    },
  };

  const response = await fetch(`${GLPI_BASE_URL}/Ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'App-Token': GLPI_APP_TOKEN,
      'Session-Token': sessionToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GLPI_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GLPI createTicket failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { id: number; message: string };
  return data;
}

async function addSolutionRaw(
  sessionToken: string,
  ticketId: number,
  content: string,
  solutionTypeId = 1
): Promise<void> {
  const body = {
    input: {
      itemtype: 'Ticket',
      items_id: ticketId,
      content,
      solutiontypes_id: solutionTypeId,
    },
  };

  const response = await fetch(`${GLPI_BASE_URL}/ITILSolution`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'App-Token': GLPI_APP_TOKEN,
      'Session-Token': sessionToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GLPI_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GLPI addSolution failed: ${response.status} ${text}`);
  }

}

async function updateTicketStatusRaw(
  sessionToken: string,
  ticketId: number,
  status: number
): Promise<void> {
  const body = {
    input: {
      id: ticketId,
      status,
    },
  };

  const response = await fetch(`${GLPI_BASE_URL}/Ticket/${ticketId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'App-Token': GLPI_APP_TOKEN,
      'Session-Token': sessionToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GLPI_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GLPI updateTicketStatus failed: ${response.status} ${text}`);
  }

}

function buildTicketContent(data: ConversationTicketData): { title: string; content: string } {
  const conv = data.conversation;
  const clientName = conv.contact_name || 'Sin nombre';
  const contractLabel = conv.contract ? `Contrato ${conv.contract}` : 'Sin contrato';

  let displayReason = data.reason;
  if (conv.status === 'paused') {
    displayReason = conv.specialist_name
      ? `Pausado por ${conv.specialist_name} debido a: ${data.reason}`
      : `Pausado debido a: ${data.reason}`;
  }

  const title = repairMojibake(`${displayReason} - ${contractLabel} - ${clientName}`);

  const sections: string[] = [];

  sections.push(`<h3>Motivo</h3>\n<p>${esc(displayReason)}</p>`);

  const hasEscalation = conv.escalation_reason || conv.escalated_at;
  if (hasEscalation) {
    const escalationRows: string[] = [];

    if (conv.escalation_reason && conv.escalation_reason !== data.reason) {
      escalationRows.push(`<tr><td><b>Razón de escalación (IA)</b></td><td>${esc(conv.escalation_reason)}</td></tr>`);
    }
    if (conv.escalated_at) {
      escalationRows.push(`<tr><td><b>Escalada</b></td><td>${formatVE(conv.escalated_at)}</td></tr>`);
    }
    if (conv.taken_at) {
      escalationRows.push(`<tr><td><b>Tomada por especialista</b></td><td>${formatVE(conv.taken_at)}</td></tr>`);
    }
    if (conv.specialist_name) {
      escalationRows.push(`<tr><td><b>Especialista</b></td><td>${esc(conv.specialist_name)} (${esc(conv.specialist_id || '')})</td></tr>`);
    }
    if (conv.closed_by) {
      let closedByLabel: string;
      if (conv.closed_by === 'system') {
        closedByLabel = 'Sistema (inactividad)';
      } else if (conv.closed_by === 'agent') {
        closedByLabel = conv.specialist_name || 'Agente';
      } else if (conv.closed_by === 'user') {
        closedByLabel = 'Usuario';
      } else {
        closedByLabel = conv.closed_by;
      }
      escalationRows.push(`<tr><td><b>Cerrada por</b></td><td>${esc(closedByLabel)}</td></tr>`);
    }
    if (conv.closed_at) {
      escalationRows.push(`<tr><td><b>Cerrada</b></td><td>${formatVE(conv.closed_at)}</td></tr>`);
    }

    if (escalationRows.length > 0) {
      sections.push(`<h3>Contexto de Escalación</h3>
<p><i>La IA no pudo resolver este caso y fue escalado a un especialista.</i></p>
<table border="1" cellpadding="4" cellspacing="0">
${escalationRows.join('\n')}
</table>`);
    }
  }

  sections.push(`<h3>Datos del Cliente</h3>
<table border="1" cellpadding="4" cellspacing="0">
<tr><td><b>Cliente</b></td><td>${esc(clientName)}</td></tr>
<tr><td><b>Identificación</b></td><td>${esc(conv.identification || 'N/A')}</td></tr>
<tr><td><b>N° Contrato</b></td><td>${esc(conv.contract || 'N/A')}</td></tr>
<tr><td><b>Sector</b></td><td>${esc(conv.sector || 'N/A')}</td></tr>
<tr><td><b>Teléfono</b></td><td>${esc(conv.contact_phone || 'N/A')}</td></tr>
<tr><td><b>Email</b></td><td>${esc(conv.contact_email || 'N/A')}</td></tr>
</table>`);

  if (conv.summary) {
    sections.push(`<h3>Resumen de la Conversación</h3>\n<p>${esc(conv.summary)}</p>`);
  }

  if (conv.specialist_name && !hasEscalation) {
    sections.push(`<h3>Especialista</h3>\n<p>${esc(conv.specialist_name)} (${esc(conv.specialist_id || '')})</p>`);
  }

  const relevant = data.messages
    .filter(m => m.role === 'user' || m.role === 'model' || m.role === 'assistant')
    .slice(-30);

  if (relevant.length > 0) {
    const rows = relevant.map(m => {
      const role = m.role === 'user' ? 'Cliente' : 'Asistente';
      const time = formatVE(m.created_at);
      const text = esc(m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content);
      return `<tr><td><b>${role}</b></td><td>${text}</td><td>${time}</td></tr>`;
    }).join('\n');

    sections.push(`<h3>Historial de Conversación</h3>
<table border="1" cellpadding="4" cellspacing="0">
<tr><th>Rol</th><th>Mensaje</th><th>Hora</th></tr>
${rows}
</table>`);
  }

  const metaRows: string[] = [
    `<tr><td><b>Estado</b></td><td>${esc(conv.status)}</td></tr>`,
    `<tr><td><b>Creada</b></td><td>${formatVE(conv.created_at)}</td></tr>`,
  ];
  if (!hasEscalation) {
    metaRows.push(`<tr><td><b>Escalada</b></td><td>${conv.escalated_at ? formatVE(conv.escalated_at) : 'N/A'}</td></tr>`);
    metaRows.push(`<tr><td><b>Tomada</b></td><td>${conv.taken_at ? formatVE(conv.taken_at) : 'N/A'}</td></tr>`);
  }
  sections.push(`<h3>Metadatos</h3>
<table border="1" cellpadding="4" cellspacing="0">
${metaRows.join('\n')}
</table>`);

  return { title, content: sections.join('\n\n') };
}

function buildSolutionContent(
  resolution: string,
  conversation: Conversation,
  messages: ChatLog[],
  previousStatus?: ConversationStatus
): string {
  const sections: string[] = [];

  sections.push(`<h3>Resolución</h3>\n<p>${esc(resolution)}</p>`);

  if (conversation.escalation_reason) {
    let escalationText = conversation.escalation_reason;
    if (previousStatus === 'paused') {
      escalationText = conversation.specialist_name
        ? `Pausado por ${conversation.specialist_name} debido a: ${conversation.escalation_reason}`
        : `Pausado debido a: ${conversation.escalation_reason}`;
    } else if (previousStatus === 'waiting_specialist' || previousStatus === 'handed_over') {
      escalationText = `Incapacidad del asistente o por petición del usuario: ${conversation.escalation_reason}`;
    }
    sections.push(`<h3>Razón de Escalación</h3>\n<p>${esc(escalationText)}</p>`);
  }
  if (conversation.closed_by) {
    let closedByLabel: string;
    if (conversation.closed_by === 'system') {
      closedByLabel = 'Sistema (inactividad)';
    } else if (conversation.closed_by === 'agent') {
      closedByLabel = conversation.specialist_name || 'Agente';
    } else if (conversation.closed_by === 'user') {
      closedByLabel = 'Usuario';
    } else {
      closedByLabel = conversation.closed_by;
    }
    sections.push(`<p><b>Cerrada por:</b> ${esc(closedByLabel)}</p>`);
  }

  if (conversation.summary) {
    sections.push(`<h3>Resumen Final</h3>\n<p>${esc(conversation.summary)}</p>`);
  }

  const recent = messages
    .filter(m => m.role === 'user' || m.role === 'model' || m.role === 'assistant')
    .slice(-10);

  if (recent.length > 0) {
    const rows = recent.map(m => {
      const role = m.role === 'user' ? 'Cliente' : 'Asistente';
      const text = esc(m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content);
      return `<tr><td><b>${role}</b></td><td>${text}</td></tr>`;
    }).join('\n');

    sections.push(`<h3>Últimos Mensajes</h3>
<table border="1" cellpadding="4" cellspacing="0">
<tr><th>Rol</th><th>Mensaje</th></tr>
${rows}
</table>`);
  }



  return sections.join('\n\n');
}

function esc(text: string): string {
  return repairMojibake(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatVE(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('es-VE', { timeZone: 'America/Caracas' });
  } catch {
    return dateStr;
  }
}

export function priorityToUrgency(priority: string | null | undefined): number {
  switch (priority) {
    case 'critical': return 5;
    case 'high':     return 4;
    case 'low':      return 2;
    case 'medium':
    default:         return 3;
  }
}

export async function createConversationTicket(data: ConversationTicketData): Promise<GLPITicketResult> {
  let sessionToken: string | null = null;

  try {
    sessionToken = await initSession();

    const { title, content } = buildTicketContent(data);

    const result = await createTicketRaw(sessionToken, title, content, {
      type: 1,
    });

    killSession(sessionToken).catch(() => {});

    return {
      success: true,
      ticketId: result.id,
      message: `Ticket #${result.id} creado exitosamente`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (sessionToken) killSession(sessionToken).catch(() => {});

    return {
      success: false,
      message: 'Error al crear ticket en GLPI',
      error: errMsg,
    };
  }
}

export async function closeTicket(data: CloseTicketData): Promise<GLPICloseResult> {
  let sessionToken: string | null = null;

  try {
    sessionToken = await initSession();

    await addSolutionRaw(
      sessionToken,
      data.ticketId,
      data.resolution,
      data.solutionTypeId ?? 1
    );

    try {
      await updateTicketStatusRaw(sessionToken, data.ticketId, 6);
    } catch (statusErr) {
    }

    killSession(sessionToken).catch(() => {});

    return {
      success: true,
      ticketId: data.ticketId,
      message: `Ticket #${data.ticketId} cerrado con solución`,
      solutionAdded: true,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (sessionToken) killSession(sessionToken).catch(() => {});

    return {
      success: false,
      ticketId: data.ticketId,
      message: `Error al cerrar ticket #${data.ticketId}`,
      error: errMsg,
    };
  }
}

export async function createAndCloseTicket(
  ticketData: ConversationTicketData,
  resolution: string
): Promise<GLPITicketResult & { closed?: boolean }> {
  let sessionToken: string | null = null;

  try {
    sessionToken = await initSession();

    const { title, content } = buildTicketContent(ticketData);
    const ticket = await createTicketRaw(sessionToken, title, content, {
      type: 1,
    });

    const solutionContent = buildSolutionContent(
      resolution,
      ticketData.conversation,
      ticketData.messages,
      ticketData.previousStatus
    );
    await addSolutionRaw(sessionToken, ticket.id, solutionContent);

    let closed = true;
    try {
      await updateTicketStatusRaw(sessionToken, ticket.id, 6);
    } catch {
      closed = false;
    }

    killSession(sessionToken).catch(() => {});

    return {
      success: true,
      ticketId: ticket.id,
      message: `Ticket #${ticket.id} creado y cerrado`,
      closed,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (sessionToken) killSession(sessionToken).catch(() => {});

    return {
      success: false,
      message: 'Error al crear y cerrar ticket en GLPI',
      error: errMsg,
    };
  }
}
