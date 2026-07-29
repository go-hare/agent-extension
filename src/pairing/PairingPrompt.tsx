/**
 * Official PairingPrompt (PairingPrompt-C-26AHZP.js) structure + classNames.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

export type PairingClientType = 'desktop' | 'claude-code' | string;

export interface PairingPromptProps {
  requestId: string;
  clientType: PairingClientType;
  currentName?: string;
  onConfirm: (requestId: string, name: string) => void;
  onDismiss: (requestId: string) => void;
}

function clientLabel(clientType: PairingClientType): string {
  return clientType === 'claude-code' ? 'Claude Code' : 'Claude Desktop';
}

export function PairingPrompt({
  requestId,
  clientType,
  currentName,
  onConfirm,
  onDismiss,
}: PairingPromptProps) {
  const [name, setName] = useState(currentName || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const confirm = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(requestId, trimmed);
  }, [name, requestId, onConfirm]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') confirm();
    },
    [confirm],
  );

  return (
    <div className="flex flex-col gap-4 p-5 bg-bg-100 rounded-xl border border-border-300 shadow-lg">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium text-text-000">
          {clientLabel(clientType)} wants to connect
        </h3>
        <p className="text-sm text-text-300">
          Name this browser so you can identify it later.
        </p>
      </div>

      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={'e.g., “Work laptop”, “Personal Chrome”'}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border-300 bg-bg-000 text-text-000 placeholder:text-text-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-transparent"
      />

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => onDismiss(requestId)}
          className="px-4 py-2 text-sm rounded-lg border border-border-300 text-text-200 hover:bg-bg-200 transition-colors"
        >
          Ignore
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!name.trim()}
          className="px-4 py-2 text-sm rounded-lg bg-brand-100 text-oncolor-100 hover:bg-brand-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Connect
        </button>
      </div>
    </div>
  );
}
