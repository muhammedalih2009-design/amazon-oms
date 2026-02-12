/**
 * Backend Capabilities Check
 * Returns which backend functions are available
 */

export default async function handler(request, context) {
  return {
    status: 200,
    body: {
      backendFunctionsEnabled: true,
      resetStockToZeroAvailable: true,
      version: '1.0.0'
    }
  };
}