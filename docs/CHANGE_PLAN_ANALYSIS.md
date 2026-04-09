# Análisis del Proceso "Cambio de Plan"

He trazado el proceso propuesto en `CHANGE_PLAN.md` contrastándolo con los endpoints recuperados desde su documentación de Redoc (`https://api.sisprotgf.com/api/redoc/`) y el código actual del MCP (`src/services/sisprot-api.ts`).

## 1. Mapeo de Flujo a las API

### UPGRADE (Aumento de plan)
El proceso indica 3 hitos:
1. **Calcular Presupuesto:** Usa `POST /api/public/contracts/new_plan_budget/`.
   - Payload: `{ contract: <id_contrato>, new_plan: <id_plan_nuevo> }`
   - Retorna: Prorrateo, `cycle_end_date`, monto a pagar, etc.
2. **Validar Pago (Solo BNC):** Usa `POST /api/public/payments/register_payment/image/`.
   - Payload requiere: `invoice`, `date_payment`, `payment_image_base64`.
3. **Solicitud de Cambio de Plan:** Usa `POST /api/public/plan/change_plan_request/`.
   - Payload: `{ contract_gsoft_id: <id>, change_type: "UPGRADE", new_plan: <id_plan_nuevo> ... }`.

### DOWNGRADE (Disminución de plan)
1. **Solicitud de Cambio:** Usa la misma API `change_plan_request/` pero enviando `change_type: "DOWNGRADE"`.
2. Las lógicas de diferir o aplicar instantáneo basadas en el estado del contrato (ACTIVO vs SUSPENDIDO/CANCELADO) son manejadas por el backend de Gsoft según la descripción, o delegadas a parámetros como `scheduled_for`.

## 2. Puntos Ciegos y Preguntas Críticas (Para el Usuario)

Al revisar a nivel de payload y de negocio, encuentro los siguientes cabos sueltos que el MCP debe gestionar. **Necesito tu feedback en estos puntos para proceder a integrarlo como Herramienta / Prompt en el MCP:**

1. **Paradoja del ID de Factura (Invoice) en el UPGRADE:**
   El paso 2 (Registrar Pago) requiere explícitamente un `invoice` (ID numérico de la factura) en la API. Sin embargo, el paso 1 (presupuesto) solo "calcula", no genera factura. Y el documento dice: *"SI EL PAGO VIENE NULL SE GENERA NCB... DE LO CONTRARIO SE GENERA LA NCB PAGADA"* lo que implica que la NCB (factura) se genera en el **Paso 3**.
   - **Pregunta:** ¿De dónde obtenemos la ID de factura para el Paso 2 si la misma se crea en el Paso 3? ¿Acaso Sisprot permite enviar nulo aquí, o creamos primero la solicitud de cambio y luego reportamos el pago contra la solicitud/contrato?

2. **Carga de Imagen (Validación BNC):**
   El endpoint `/api/public/payments/register_payment/image/` requiere el comprobante en base64 (`payment_image_base64`). 
   - **Pregunta:** En el flujo de chat (GPT/Claude), ¿pediremos al usuario final que suba la captura al chat para convertirla en base64 y subirla o la IA simplemente le dará un link al portal de clientes para el pago en caso de ser BNC?

3. **Lógica de Fecha para DOWNGRADE (scheduled_for):**
   El archivo dice que un downgrade (si activo) *"SE PROGRAMA PARA QUE SE EJECUTE EN LA FECHA DE SU GENERACION DE FACTURA"*.
   - **Pregunta:** En el endpoint de `change_plan_request` existe el campo opcional `scheduled_for`. ¿Es el MCP (la Inteligencia Artificial) el encargado de leer la fecha de "cycle_end" del cliente y programarla manualmente enviando ese parámetro en la petición? ¿O Gsoft asume esta lógica de programación automáticamente si le enviamos fecha nula?

4. **Selección del Plan Destino:**
   Actualmente usamos un prompt `consultar-planes` basado en un RAG de Base de Datos de Conocimiento para mostrar los planes.
   - **Pregunta:** Para que la IA procese la ID `new_plan` correcta, ¿vamos a consultar una API nueva (`GET /public/plan/`) para recuperar IDs vivos de la base de datos de Sisprot y presentárselos al usuario internamente, o continuaremos basándonos en nombres predeterminados mapeando los nombres a los IDs harcodeados en el sistema?

## Siguientes Pasos propuestos para integración en el MCP:
Una vez resueltos estos bloqueos lógicos, agregaré Zod Schemas a `src/services/sisprot-api.ts`, los endpoints fetchers, y propondré **Tools específicas** (ej. `calcular_presupuesto_upgrade`, `solicitar_cambio_plan`) en lugar de depender únicamente de Prompts, ya que esta acción requiere mutación de estado en múltiples pasos y obtención de los IDs de planes.
