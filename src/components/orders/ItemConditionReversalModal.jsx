import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export default function ItemConditionReversalModal({ 
  open, 
  orderLines, 
  skus,
  newStatus,
  onConfirm, 
  onCancel 
}) {
  const [itemConditions, setItemConditions] = useState(
    orderLines.reduce((acc, line) => ({
      ...acc,
      [line.id]: 'sound' // Default to sound
    }), {})
  );

  const allItemsSelected = orderLines.every(line => itemConditions[line.id]);

  const handleConditionChange = (lineId, condition) => {
    setItemConditions(prev => ({
      ...prev,
      [lineId]: condition
    }));
  };

  const handleConfirm = () => {
    if (allItemsSelected) {
      onConfirm(itemConditions);
    }
  };

  const soundCount = Object.values(itemConditions).filter(c => c === 'sound').length;
  const damagedCount = Object.values(itemConditions).filter(c => c === 'damaged').length;
  const lostCount = Object.values(itemConditions).filter(c => c === 'lost').length;

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) onCancel();
    }}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Specify Item Condition for Reversal
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p className="text-slate-700">
                You're changing this order status to <strong>{newStatus}</strong>. 
                For each item, specify whether it's in sound condition (returns to sellable inventory) or damaged/scrapped.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          {/* Items List */}
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {orderLines.map(line => {
              const sku = skus.find(s => s.id === line.sku_id);
              const selectedCondition = itemConditions[line.id];

              return (
                <div key={line.id} className="border border-slate-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{line.sku_code}</p>
                      <p className="text-sm text-slate-500">{sku?.product_name}</p>
                      <p className="text-sm font-semibold text-slate-700 mt-1">
                        Quantity: {line.quantity}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant={selectedCondition === 'sound' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleConditionChange(line.id, 'sound')}
                        className={
                          selectedCondition === 'sound'
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : ''
                        }
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Sound
                      </Button>
                      <Button
                        variant={selectedCondition === 'damaged' ? 'destructive' : 'outline'}
                        size="sm"
                        onClick={() => handleConditionChange(line.id, 'damaged')}
                      >
                        <AlertCircle className="w-4 h-4 mr-1" />
                        Damaged
                      </Button>
                      <Button
                        variant={selectedCondition === 'lost' ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => handleConditionChange(line.id, 'lost')}
                        className={
                          selectedCondition === 'lost'
                            ? 'bg-slate-600 hover:bg-slate-700 text-white'
                            : ''
                        }
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Lost/Missing
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 bg-slate-50 rounded-lg p-4">
            <div>
              <p className="text-xs text-emerald-700 font-medium">Sound</p>
              <p className="text-2xl font-bold text-emerald-900">{soundCount}</p>
            </div>
            <div>
              <p className="text-xs text-red-700 font-medium">Damaged</p>
              <p className="text-2xl font-bold text-red-900">{damagedCount}</p>
            </div>
            <div>
              <p className="text-xs text-slate-700 font-medium">Lost</p>
              <p className="text-2xl font-bold text-slate-900">{lostCount}</p>
            </div>
          </div>

          {/* Warning */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Sound items return to sellable inventory. Damaged items are logged separately. Lost items are written off with no stock change.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!allItemsSelected}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            Confirm & Update Status
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}