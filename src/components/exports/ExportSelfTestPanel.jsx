import React from 'react';
import { CheckCircle2, AlertCircle, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ExportSelfTestPanel({ results, loading, onRunTest }) {
  if (!results) {
    return (
      <div className="flex gap-3">
        <Button
          onClick={onRunTest}
          disabled={loading}
          variant="outline"
          className="border-purple-200 text-purple-700 hover:bg-purple-50"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 mr-2 animate-spin" />
              Testing...
            </>
          ) : (
            '🧪 Run Export Self-Test'
          )}
        </Button>
      </div>
    );
  }

  const pdfResult = results.pdfTest;
  const xlsxResult = results.xlsxTest;
  const overallPass = results.status === 'PASS';

  return (
    <Card className={`border-2 ${overallPass ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {overallPass ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600" />
            )}
            <div>
              <CardTitle className={overallPass ? 'text-emerald-900' : 'text-red-900'}>
                Export Self-Test: {results.status}
              </CardTitle>
              <CardDescription>{results.message}</CardDescription>
            </div>
          </div>
          <Button
            onClick={onRunTest}
            disabled={loading}
            variant="outline"
            size="sm"
            className="border-purple-200 text-purple-700 hover:bg-purple-50"
          >
            {loading ? <Loader className="w-3 h-3 animate-spin" /> : 'Re-run'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* PDF Test Result */}
          <div className={`p-4 rounded-lg border ${
            pdfResult.status === 'PASS'
              ? 'bg-emerald-100 border-emerald-300'
              : 'bg-red-100 border-red-300'
          }`}>
            <div className="flex items-start gap-2">
              {pdfResult.status === 'PASS' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-1 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 mt-1 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className={`font-semibold ${pdfResult.status === 'PASS' ? 'text-emerald-900' : 'text-red-900'}`}>
                  PDF Export
                </p>
                <p className={`text-sm ${pdfResult.status === 'PASS' ? 'text-emerald-800' : 'text-red-800'}`}>
                  {pdfResult.status === 'PASS' ? '✅ PASS' : '❌ FAIL'}
                </p>
                {pdfResult.engine && (
                  <p className="text-xs text-slate-600 mt-1">
                    Engine: {pdfResult.engine}
                  </p>
                )}
                {pdfResult.bufferSize > 0 && (
                  <p className="text-xs text-slate-600">
                    Size: {(pdfResult.bufferSize / 1024).toFixed(1)} KB
                  </p>
                )}
                {pdfResult.reason && (
                  <div className="mt-2 p-2 bg-white/50 rounded text-xs text-slate-700 break-words">
                    <strong>Error:</strong> {pdfResult.reason}
                  </div>
                )}
                {pdfResult.errorId && (
                  <p className="text-xs text-slate-500 mt-1">
                    ID: <code>{pdfResult.errorId}</code>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* XLSX Test Result */}
          <div className={`p-4 rounded-lg border ${
            xlsxResult.status === 'PASS'
              ? 'bg-emerald-100 border-emerald-300'
              : 'bg-red-100 border-red-300'
          }`}>
            <div className="flex items-start gap-2">
              {xlsxResult.status === 'PASS' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-1 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 mt-1 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className={`font-semibold ${xlsxResult.status === 'PASS' ? 'text-emerald-900' : 'text-red-900'}`}>
                  XLSX Export
                </p>
                <p className={`text-sm ${xlsxResult.status === 'PASS' ? 'text-emerald-800' : 'text-red-800'}`}>
                  {xlsxResult.status === 'PASS' ? '✅ PASS' : '❌ FAIL'}
                </p>
                {xlsxResult.engine && (
                  <p className="text-xs text-slate-600 mt-1">
                    Engine: {xlsxResult.engine}
                  </p>
                )}
                {xlsxResult.bufferSize > 0 && (
                  <p className="text-xs text-slate-600">
                    Size: {(xlsxResult.bufferSize / 1024).toFixed(1)} KB
                  </p>
                )}
                {xlsxResult.reason && (
                  <div className="mt-2 p-2 bg-white/50 rounded text-xs text-slate-700 break-words">
                    <strong>Error:</strong> {xlsxResult.reason}
                  </div>
                )}
                {xlsxResult.errorId && (
                  <p className="text-xs text-slate-500 mt-1">
                    ID: <code>{xlsxResult.errorId}</code>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs text-slate-500 text-right">
          Tested: {new Date(results.timestamp).toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}