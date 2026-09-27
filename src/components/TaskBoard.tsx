import { useEffect, useRef, useState } from 'react';
import type { MemoryWorld } from '../../prototype/world';

export default function TaskBoard({
  tasks,
  onOpenChange,
  hidden = false,
}: {
  hidden?: boolean;
  tasks: ReturnType<MemoryWorld['taskViews']>;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = tasks.find((t) => t.id === selectedId) ?? tasks[0];
  const current = tasks.find((t) => t.completed.length < t.steps.length);
  const currentStep = current?.steps.find((step) => !current.completed.includes(step.id));
  const complete = tasks.length > 0 && !current;
  const [dismissed, setDismissed] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => panel.current?.close();
  const open = () => {
    if (panel.current?.open) return;
    panel.current?.showModal();
    onOpenChange(true);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (event.key.toLowerCase() === 't') {
        // Respect other dialogs (for example the help screen).
        if (!panel.current?.open && document.querySelector('[role="dialog"], dialog[open]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (panel.current?.open) close();
        else open();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [onOpenChange]);
  useEffect(() => {
    setDismissed(false);
    if (!complete) return;
    const timer = setTimeout(() => setDismissed(true), 4000);
    return () => clearTimeout(timer);
  }, [complete]);
  return (
    <>
      <section hidden={hidden} className="task-board" aria-label="Current task">
        {!dismissed && (
          <div aria-live="polite">
            <h2>{current?.title ?? '✓ Task complete'}</h2>
            <p>{currentStep?.text ?? 'All tasks complete.'}</p>
            {currentStep?.marker && (
              <div className="task-board__guide">
                <p>
                  <strong>Background: </strong>
                  {current?.background}
                </p>
                <p>
                  <strong>Go now: </strong>
                  {current?.description}
                </p>
                <p className="task-board__legend">Gold ! inspect/take · ? confirm/deliver · E interact</p>
              </div>
            )}
          </div>
        )}
        <button
          ref={trigger}
          className="task-board__trigger"
          aria-label="Task panel (T to open/close)"
          aria-haspopup="dialog"
          onClick={open}
        >
          <kbd>T</kbd>
        </button>
      </section>
      <dialog
        ref={panel}
        className="task-panel"
        aria-labelledby="task-panel-title"
        onCancel={(event) => event.preventDefault()}
        onClose={() => {
          onOpenChange(false);
          trigger.current?.focus();
        }}
      >
        <header>
          <h2 id="task-panel-title">Task</h2>
          <button autoFocus onClick={close} aria-label="Close task panel" title="Close task panel">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="task-panel__body">
          <nav aria-label="Task list">
            <h3>Task</h3>
            {tasks.map((task) => (
              <button
                key={task.id}
                aria-current={task.id === selected?.id ? 'true' : undefined}
                onClick={() => setSelectedId(task.id)}
              >
                {task.title} {task.completed.length === task.steps.length ? '✓' : ''}
              </button>
            ))}
          </nav>
          {selected ? (
            <article>
              <h3>{selected.title}</h3>
              {selected.background && (
                <>
                  <h4 className="mt-4 font-semibold text-amber-200">Task Background</h4>
                  <p className="whitespace-pre-wrap">{selected.background}</p>
                </>
              )}
              <h4 className="mt-4 font-semibold text-amber-200">Task Details</h4>
              <p className="whitespace-pre-wrap">{selected.description}</p>
              <h4 className="mt-4 font-semibold text-amber-200">Known Progress</h4>
              <ul>
                {selected.steps.map((step) => (
                  <li key={step.id}>
                    {selected.completed.includes(step.id) ? '✓' : '□'} {step.text}
                    {` (${selected.progress[step.id]?.count ?? 0}/${step.condition.count})`}
                    {step.condition.items && (
                      <ul>
                        {step.condition.items.map((item) => (
                          <li key={item.value}>
                            {selected.progress[step.id]?.values.includes(item.value) ? '✓' : '□'}{' '}
                            {item.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              <p className="task-panel__status">
                {selected.completed.length === selected.steps.length ? 'Done' : 'Active'}
              </p>
            </article>
          ) : (
            <p>No tasks</p>
          )}
        </div>
      </dialog>
    </>
  );
}
