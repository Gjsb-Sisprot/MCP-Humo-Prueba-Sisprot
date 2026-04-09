
export function createSuccessResponse(data: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function createErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: message }, null, 2),
      },
    ],
    isError: true,
  };
}
