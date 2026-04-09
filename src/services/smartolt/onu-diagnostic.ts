import type { 
  GetOnuBySerialInput, 
  GetOnuByIdInput, 
  OnuDiagnostic, 
} from './types.js';
import { analyzeSignalQuality } from './client.js';
import { 
  getOnuBySerial, 
  getOnuDetails, 
  getOnuStatus, 
  getOnuSignal, 
  getOnuSignalBulk, 
  getOnuSignalGraphUrl 
} from './onu-queries.js';
import { getOltContext } from './system.js';
import {
  classifyOfflineCause,
  processSignalData,
  buildDiagnosis,
} from './onu-diagnostic-helpers.js';

export async function diagnoseOnu(input: GetOnuBySerialInput | GetOnuByIdInput): Promise<{
  success: boolean; data?: OnuDiagnostic; error?: string;
}> {
  try {
    
    const detailsResult = 'serial' in input 
      ? await getOnuBySerial(input) 
      : await getOnuDetails(input);
    
    if (!detailsResult.success || !detailsResult.data) {
      return { success: false, error: detailsResult.error || 'ONU no encontrada' };
    }
    
    const onuDetails = detailsResult.data;
    const onuId = onuDetails.id;
    
    const isAdminDisabled = onuDetails.adminStatus === 'Disabled';
    
    const [statusResult, signalResult, bulkSignalResult, oltContext] = await Promise.all([
      getOnuStatus({ onuId }),
      getOnuSignal({ onuId }),
      getOnuSignalBulk(onuId),
      getOltContext(onuDetails.oltId),
    ]);
    
    const status = statusResult.success ? statusResult.data?.status : 'Unknown';
    const lastStatusChange = statusResult.success ? statusResult.data?.lastStatusChange || null : null;
    const isOnline = status === 'Online';
    const isLos = status === 'LOS';
    const isPowerFail = status === 'Power fail';
    
    const offlineCause = classifyOfflineCause({ isOnline, isLos, isPowerFail, isAdminDisabled });
    
    const { rxPower, txPower, signalQuality, rawSignalValue } = processSignalData(signalResult);
    
    const signalAnalysis = analyzeSignalQuality(rxPower);
    
    const diagnosticResult = buildDiagnosis({
      isAdminDisabled, isLos, isPowerFail, isOnline, status: status as string,
      signalAnalysis, offlineCause, oltContext,
    });
    
    const requiresTechnicalVisit = !isAdminDisabled && (
      isLos || 
      signalAnalysis.quality === 'CRITICA' || 
      (!isOnline && !isPowerFail)
    );
    
    const signalGraphUrl = getOnuSignalGraphUrl(onuId);

    return {
      success: true,
      data: {
        onu: { 
          ...onuDetails, 
          status: status as string, 
          signalQuality,
          rxPower: signalResult.data?.rxPower, 
          txPower: signalResult.data?.txPower 
        },
        signal: { rxPower, txPower, quality: signalQuality, rawValue: rawSignalValue },
        analysis: { 
          signalQuality: signalAnalysis.quality, 
          isOnline, 
          isLos, 
          isPowerFail,
          isAdminDisabled,
          offlineCause,
          requiresTechnicalVisit, 
          issues: diagnosticResult.issues, 
          recommendations: diagnosticResult.recommendations,
          diagnosis: diagnosticResult.diagnosis,
          lastStatusChange,
          signalGraphUrl,
          oltContext,
        },
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error en diagnóstico de ONU' };
  }
}
