import { useEffect, useRef, useState } from 'react';

export default function DebugConsole({
  open,
  disabled,
  feedback,
  sceneId,
  onClose,
  onCommand,
}: {
  open: boolean;
  disabled: boolean;
  feedback: string;
  sceneId: string;
  onClose: () => void;
  onCommand: (command: string) => boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [command, setCommand] = useState('');

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="pointer-events-auto fixed inset-x-0 top-0 z-[100] border-b border-amber-300/60 bg-black/95 p-3 font-sans text-amber-100 shadow-2xl"
      role="dialog"
      aria-label="Dev Console"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <form
        className="mx-auto flex max-w-4xl items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const value = command.trim();
          if (!value || disabled) return;
          if (onCommand(value)) setCommand('');
          input.current?.focus();
        }}
      >
        <span className="font-mono text-amber-300" aria-hidden="true">
          &gt;
        </span>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Console command</span>
          <input
            ref={input}
            autoFocus
            className="block w-full border-0 bg-transparent p-1 font-mono text-lg text-amber-100 outline-none"
            placeholder="Type help for available commands"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            aria-label="Console command"
            disabled={disabled}
          />
        </label>
        <span className="hidden whitespace-pre-line text-xs opacity-70 sm:inline">
          {sceneId} · Enter runs · Esc closes
        </span>
      </form>
      {feedback && (
        <p
          className="mx-auto mt-2 max-w-4xl whitespace-pre-wrap font-sans text-sm leading-6"
          role="status"
        >
          {feedback}
        </p>
      )}
    </div>
  );
}
