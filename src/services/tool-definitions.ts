
interface GeminiSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  format?: string;
  items?: { type: string };
}

interface GeminiParameterSchema {
  type: 'object';
  properties: Record<string, GeminiSchemaProperty>;
  required?: string[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: GeminiParameterSchema;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required: string[];
  };
}

const MEMORY_TOOLS: ToolDefinition[] = [
  {
    name: 'save_interaction',
    description: 'Guarda un mensaje en el historial de conversación. Usar después de cada interacción para mantener contexto.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID único de la sesión de chat' },
        role: { type: 'string', description: 'Rol del mensaje', enum: ['user', 'model', 'assistant', 'system', 'tool'] },
        content: { type: 'string', description: 'Contenido del mensaje' },
        toolCallId: { type: 'string', description: 'ID de la llamada a herramienta' },
        toolName: { type: 'string', description: 'Nombre de la herramienta usada' },
        identification: { type: 'string', description: 'Identificación del cliente (cédula/RIF)' },
        contract: { type: 'string', description: 'Número de contrato del cliente' },
        sector: { type: 'string', description: 'Sector/barrio del cliente' },
        contact_name: { type: 'string', description: 'Nombre de contacto para escalamiento' },
        contact_email: { type: 'string', description: 'Email de contacto para escalamiento' },
        contact_phone: { type: 'string', description: 'Teléfono de contacto para escalamiento' },
      },
      required: ['sessionId', 'role', 'content'],
    },
  },
  {
    name: 'set_session_state',
    description: 'Guarda estado temporal de sesión. Útil para operaciones de múltiples pasos.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID de la sesión' },
        key: { type: 'string', description: 'Clave del estado' },
        value: { type: 'string', description: 'Valor a guardar (JSON string)' },
        expiresInMinutes: { type: 'number', description: 'Minutos hasta expiración' },
      },
      required: ['sessionId', 'key'],
    },
  },
  {
    name: 'delete_session_state',
    description: 'Elimina estado temporal de sesión.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID de la sesión' },
        key: { type: 'string', description: 'Clave del estado a eliminar' },
      },
      required: ['sessionId', 'key'],
    },
  },
];

const RAG_TOOLS: ToolDefinition[] = [
  {
    name: 'search_knowledge_base',
    description: 'Busca información relevante en la base de conocimientos usando búsqueda semántica.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto de búsqueda' },
        threshold: { type: 'number', description: 'Umbral de similitud (0-1). Default 0.3' },
        limit: { type: 'number', description: 'Máximo de resultados (1-20, default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_knowledge',
    description: 'Agrega un documento a la base de conocimientos.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Contenido del documento' },
        title: { type: 'string', description: 'Título del documento' },
        source: { type: 'string', description: 'URL o referencia de origen' },
        chunkSize: { type: 'number', description: 'Tamaño de chunks' },
        chunkOverlap: { type: 'number', description: 'Superposición entre chunks' },
      },
      required: ['content'],
    },
  },
];

const HANDOVER_TOOLS: ToolDefinition[] = [
  {
    name: 'update_summary',
    description: 'Actualiza el resumen de la conversación para handover.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID de la sesión' },
        summary: { type: 'string', description: 'Resumen actualizado de la conversación' },
      },
      required: ['sessionId', 'summary'],
    },
  },
  {
    name: 'escalate_to_specialist',
    description: 'Escala la conversación a un especialista.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID de la sesión' },
        reason: { type: 'string', description: 'Motivo del escalamiento' },
        priority: { type: 'string', description: 'Prioridad', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['sessionId', 'reason'],
    },
  },
  {
    name: 'close_conversation',
    description: 'Cierra una conversación marcándola como finalizada.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID de la sesión' },
        resolution: { type: 'string', description: 'Explicación de cómo se resolvió (mín 10 chars)' },
      },
      required: ['sessionId', 'resolution'],
    },
  },
  {
    name: 'takeover_conversation',
    description: 'Permite a un especialista tomar control de una conversación.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID de la sesión' },
        specialistEmail: { type: 'string', description: 'Email del especialista' },
        specialistName: { type: 'string', description: 'Nombre del especialista' },
      },
      required: ['sessionId', 'specialistEmail', 'specialistName'],
    },
  },
];

const SEARCH_TOOLS: ToolDefinition[] = [
  {
    name: 'list_conversations',
    description: 'Lista conversaciones con filtros y paginación.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Estado a filtrar', enum: ['active', 'paused', 'waiting_specialist', 'handed_over', 'closed'] },
        limit: { type: 'number', description: 'Elementos por página (max: 100)' },
        offset: { type: 'number', description: 'Desplazamiento para paginación' },
      },
      required: [],
    },
  },
  {
    name: 'search_conversations',
    description: 'Busca conversaciones por identificación, contrato o sector.',
    parameters: {
      type: 'object',
      properties: {
        identification: { type: 'string', description: 'Identificación del cliente' },
        contract: { type: 'string', description: 'Número de contrato' },
        sector: { type: 'string', description: 'Sector/barrio del cliente' },
        limit: { type: 'number', description: 'Máximo de resultados' },
      },
      required: [],
    },
  },
  {
    name: 'get_specialist_stats',
    description: 'Obtiene estadísticas de rendimiento de un especialista.',
    parameters: {
      type: 'object',
      properties: {
        specialistEmail: { type: 'string', description: 'Email del especialista' },
      },
      required: ['specialistEmail'],
    },
  },
];

const SUPPORT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_onu_diagnostic',
    description: 'Diagnóstico completo de una ONU: estado, señal, potencia.',
    parameters: {
      type: 'object',
      properties: {
        serial: { type: 'string', description: 'Serial de la ONU' },
      },
      required: ['serial'],
    },
  },
  {
    name: 'reboot_onu',
    description: 'Reinicia una ONU remotamente. ADVERTENCIA: Desconecta al cliente 2-3 minutos.',
    parameters: {
      type: 'object',
      properties: {
        onuId: { type: 'string', description: 'ID externo de la ONU' },
      },
      required: ['onuId'],
    },
  },
  {
    name: 'get_unconfigured_onus',
    description: 'Lista las ONUs detectadas pero NO configuradas.',
    parameters: {
      type: 'object',
      properties: {
        oltId: { type: 'string', description: 'ID del OLT (opcional)' },
        serial: { type: 'string', description: 'Filtrar por serial (opcional)' },
      },
      required: [],
    },
  },
  {
    name: 'authorize_onu',
    description: 'Autoriza una ONU desconfigurada y activa el servicio del cliente. Proceso completo automatizado.',
    parameters: {
      type: 'object',
      properties: {
        contract_id: { type: 'number', description: 'ID del contrato del cliente' },
        confirmation: { type: 'boolean', description: 'Confirmación del cliente' },
      },
      required: ['contract_id', 'confirmation'],
    },
  },
  {
    name: 'get_olts_list',
    description: 'Lista todos los OLTs disponibles en el sistema.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_zones_list',
    description: 'Lista todas las zonas disponibles en SmartOLT.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_onu_types_list',
    description: 'Lista todos los tipos de ONU configurados en SmartOLT.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];



export function getAllToolDefinitions(): ToolDefinition[] {
  return [
    ...MEMORY_TOOLS,
    ...RAG_TOOLS,
    ...HANDOVER_TOOLS,
    ...SEARCH_TOOLS,
    ...SUPPORT_TOOLS,
  ];
}

export function toGeminiFunctionDeclarations(tools: ToolDefinition[]): GeminiFunctionDeclaration[] {
  return tools.map(tool => {
    const properties: Record<string, GeminiSchemaProperty> = {};
    
    for (const [key, value] of Object.entries(tool.parameters.properties)) {
      const prop: GeminiSchemaProperty = {
        type: value.type.toUpperCase(),
        description: value.description,
      };
      
      if (value.enum && value.enum.length > 0) {
        prop.enum = value.enum;
        prop.format = 'enum';
      }
      
      properties[key] = prop;
    }
    
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties,
        required: tool.parameters.required.length > 0 ? tool.parameters.required : undefined,
      },
    };
  });
}


export function getToolCounts(): Record<string, number> {
  return {
    memory: MEMORY_TOOLS.length,
    rag: RAG_TOOLS.length,
    handover: HANDOVER_TOOLS.length,
    search: SEARCH_TOOLS.length,
    support: SUPPORT_TOOLS.length,
    totalAll: getAllToolDefinitions().length,
  };
}

export const TOOL_COUNTS = getToolCounts();
