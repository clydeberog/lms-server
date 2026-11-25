import React, { useEffect } from 'react';
import { ShieldAlert, X } from 'lucide-react';

export interface ConfirmActionRequest {
  title: string;
  description: string;
  details?: string[];
  recipientEmails?: string[];
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<void> | void;
}

interface ConfirmActionModalProps {
  request: ConfirmActionRequest | null;
  onConfirmExecute: () => void;
  onCancel: () => void;
}

export const ConfirmActionModal: React.FC<ConfirmActionModalProps> = ({
  request,
  onConfirmExecute,
  onCancel,
}) => {
  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [request, onCancel]);

  if (!request) return null;

  const isDanger = request.tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1C1917]/45 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-action-title"
      onClick={onCancel}
    >
      <div
        className="bg-[#FBF9F5] border-t sm:border border-[#E5DFD3] rounded-t-2xl sm:rounded-lg max-w-lg w-full max-h-[90dvh] overflow-y-auto p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 shadow-xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-[#D6D0C4] mx-auto -mt-1" aria-hidden="true" />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <ShieldAlert
              className={`w-5 h-5 shrink-0 mt-0.5 ${
                isDanger ? 'text-[#78350F]' : 'text-[#1E3A8A]'
              }`}
            />
            <div className="min-w-0">
              <h2
                id="confirm-action-title"
                className="text-xl font-serif font-semibold text-[#1C1917]"
              >
                {request.title}
              </h2>
              <p className="text-sm text-[#57534E] mt-1 leading-relaxed">
                {request.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="text-[#57534E] hover:text-[#1C1917] min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-md transition-colors shrink-0"
          >
            <X className="w-5 h-5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {request.details && request.details.length > 0 && (
          <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-md p-3.5 sm:p-4 space-y-1.5">
            {request.details.map((item, idx) => (
              <p key={idx} className="text-xs text-[#1C1917] leading-relaxed break-words">
                {item}
              </p>
            ))}
          </div>
        )}

        {request.recipientEmails && request.recipientEmails.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#57534E] tabular-nums">
              Google Drive view access will be granted to {request.recipientEmails.length}{' '}
              enrolled course member{request.recipientEmails.length === 1 ? '' : 's'}:
            </p>
            <div className="max-h-36 overflow-y-auto bg-[#F5F1E8] border border-[#E5DFD3] rounded-md p-3 space-y-1">
              {request.recipientEmails.map((email) => (
                <div key={email} className="text-xs font-mono text-[#1C1917] truncate">
                  {email}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3 pt-3 border-t border-[#E5DFD3]">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-2 text-sm font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] rounded-md transition-colors text-center"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirmExecute}
            className={`w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-2 text-sm font-medium text-white rounded-md transition-colors text-center ${
              isDanger
                ? 'bg-[#78350F] hover:bg-[#5E290B]'
                : 'bg-[#1E3A8A] hover:bg-[#172E6E]'
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
