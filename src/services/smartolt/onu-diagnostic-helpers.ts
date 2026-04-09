import type { OltContext, OfflineCause } from './types.js';
import { parseSignalPower, analyzeSignalQuality } from './client.js';

export function classifyOfflineCause(input: {
  isOnline: boolean; isLos: boolean; isPowerFail: boolean; isAdminDisabled: boolean;
}): OfflineCause {
  if (input.isOnline) return 'ONLINE';
  if (input.isAdminDisabled) return 'ADMIN_DISABLED';
  if (input.isPowerFail) return 'DYING_GASP';
  if (input.isLos) return 'LOS_FIBER';
  return 'UNKNOWN_OFFLINE';
}

export function processSignalData(signalResult: { 
  success: boolean; 
  data?: { quality: string; rxPower: string; txPower: string; rawValue: string } 
}) {
  let rxPower: number | null = null;
  let txPower: number | null = null;
  let signalQuality = 'Unknown';
  let rawSignalValue = 'No disponible';
  
  if (signalResult.success && signalResult.data) {
    rxPower = parseSignalPower(signalResult.data.rxPower);
    txPower = parseSignalPower(signalResult.data.txPower);
    signalQuality = signalResult.data.quality;
    rawSignalValue = signalResult.data.rawValue;
  }
  
  return { rxPower, txPower, signalQuality, rawSignalValue };
}

export interface DiagnosisInput {
  isAdminDisabled: boolean;
  isLos: boolean;
  isPowerFail: boolean;
  isOnline: boolean;
  status: string;
  signalAnalysis: ReturnType<typeof analyzeSignalQuality>;
  offlineCause: OfflineCause;
  oltContext: OltContext | null;
}

export interface DiagnosisResult {
  issues: string[];
  recommendations: string[];
  diagnosis: string;
}

export function buildDiagnosis(input: DiagnosisInput): DiagnosisResult {
  const { isAdminDisabled, isLos, isPowerFail, isOnline, status, signalAnalysis, oltContext } = input;
  const issues: string[] = [];
  const recommendations: string[] = [];
  let diagnosis = '';

  if (isAdminDisabled) {
    issues.push('ONU DESHABILITADA ADMINISTRATIVAMENTE');
    issues.push('El servicio fue suspendido desde el sistema de gestión');
    recommendations.push('Verificar estado de cuenta del cliente en Sisprot');
    recommendations.push('Si el cliente está al día, habilitar la ONU desde SmartOLT');
    diagnosis = 'SUSPENSION_ADMINISTRATIVA - El servicio está bloqueado desde el sistema (posible falta de pago o retiro de servicio). NO es una falla técnica.';
    if (isLos) {
      issues.push('Además, la ONU está en estado LOS (sin señal de fibra)');
    }
  } else if (isPowerFail) {
    issues.push('ONU reporta DYING GASP (Power Fail) — Corte de energía eléctrica');
    issues.push('La ONU envió una señal de apagado controlado antes de desconectarse');
    issues.push('Esto indica que el equipo perdió alimentación eléctrica, NO es un problema de fibra');
    recommendations.push('Verificar que el cliente tenga energía eléctrica en su domicilio');
    recommendations.push('Revisar si hay corte de luz en la zona (común en La Guaira)');
    recommendations.push('Verificar el adaptador de corriente y la regleta/UPS del equipo');
    recommendations.push('Si hay energía, probar con otro tomacorriente o adaptador');
    diagnosis = 'DYING_GASP - La ONU se apagó por corte eléctrico. El equipo envió señal de apagado controlado (dying gasp). Causa: falla de energía, NO de fibra. Verificar suministro eléctrico.';
  } else if (isLos) {
    issues.push('ONU en estado LOS (Loss of Signal) — Pérdida de señal óptica');
    issues.push('La ONU tiene energía pero NO recibe luz por la fibra');
    issues.push('Esto indica un problema FÍSICO en la ruta de fibra óptica');
    recommendations.push('Verificar que la fibra no esté cortada o desconectada en la roseta');
    recommendations.push('Revisar si hay daño visible en el cable de fibra (dobleces, aplastamientos)');
    recommendations.push('Limpiar conectores de fibra (SC/APC verde)');
    recommendations.push('Verificar empalmes y ODB/splitter de la zona');
    diagnosis = 'LOS_FIBRA - La ONU tiene energía pero no recibe señal óptica. Causa: problema físico en la fibra (corte, conector sucio/dañado, empalme defectuoso). Requiere revisión técnica.';
  } else if (isOnline) {
    if (signalAnalysis.quality === 'CRITICA') {
      issues.push(...signalAnalysis.issues);
      recommendations.push(...signalAnalysis.recommendations);
      diagnosis = 'ONLINE_SEÑAL_CRITICA - La ONU está conectada pero con señal crítica. Requiere atención preventiva.';
    } else if (signalAnalysis.quality === 'LIMITE') {
      issues.push(...signalAnalysis.issues);
      recommendations.push(...signalAnalysis.recommendations);
      diagnosis = 'ONLINE_SEÑAL_LIMITE - La ONU está conectada con señal en límite operativo. Monitorear.';
    } else {
      diagnosis = 'OPERATIVA - La ONU está funcionando correctamente con buena señal.';
    }
  } else {
    issues.push(`ONU offline (estado: ${status})`);
    issues.push(...signalAnalysis.issues);
    recommendations.push('Verificar conexión del equipo');
    recommendations.push(...signalAnalysis.recommendations);
    diagnosis = `OFFLINE - Estado: ${status}. Verificar conexión física.`;
  }

  if (oltContext) {
    if (oltContext.recentReboot) {
      issues.push(`⚠ OLT "${oltContext.oltName}" reinició recientemente (uptime: ${oltContext.uptime})`);
      recommendations.push('El reinicio del OLT puede causar reconexiones masivas — no necesariamente indica falla del cliente');
    }
    if (oltContext.highTemperature) {
      issues.push(`⚠ OLT "${oltContext.oltName}" con temperatura elevada: ${oltContext.envTemp}`);
      recommendations.push('La temperatura alta del OLT puede causar inestabilidad en el puerto PON');
    }
  }

  return { issues, recommendations, diagnosis };
}
