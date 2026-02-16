import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle } from 'lucide-react';

export default function DeleteOrdersModal({ isOpen, onClose, orderIds, onConfirm, isDeleting }) {
  const [confirmText, setConfirmText] = useState('');
  const isConfirmed = confirmText === 'DELETE';

  const handleConfirm = () => {
    if (isConfirmed) {
      onConfirm();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <DialogTitle>Delete Orders?</DialogTitle>
          </div>
          <DialogDescription>
            This will remove profitability data for {orderIds.length} selected order{orderIds.length > 1 ? 's' : ''}. 
            This action can be undone by admin.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {orderIds.length <= 10 ? (
            <div className="bg-slate-50 rounded-lg p-3 max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-slate-600 mb-2">Orders to delete:</p>
              <div className="space-y-1">
                {orderIds.map(id => (
                  <div key={id} className="text-xs text-slate-800 font-mono">{id}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-600">
                {orderIds.slice(0, 5).join(', ')} and {orderIds.length - 5} more...
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="confirm-text">
              Type <span className="font-bold">DELETE</span> to confirm
            </Label>
            <Input
              id="confirm-text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-2"
              disabled={isDeleting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isConfirmed || isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Orders'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}