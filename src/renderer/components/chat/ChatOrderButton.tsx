import { ArrowDown, ArrowUp, GripVertical, ListOrdered } from 'lucide-react-motion';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { type OrderedChat, reconcileChatOrder } from '@/renderer/hooks/useChatOrder';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { Button, IconButton } from '../ui/Button';

interface Props {
  items: readonly OrderedChat[];
  ids: readonly string[];
  onSave: (ids: readonly string[]) => void;
  title?: string;
}

export function ChatOrderButton({ items, ids, onSave, title }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  return (
    <>
      <IconButton
        size="sm"
        aria-label={t('chatOrder.title')}
        title={title}
        disabled={items.length < 2}
        onClick={() => {
          setOpen(true);
        }}
        icon={<ListOrdered aria-hidden size={16} />}
      />
      {open && <ChatOrderDialog items={items} ids={ids} onSave={onSave} onClose={close} />}
    </>
  );
}

function ChatOrderDialog({ items, ids, onSave, onClose }: Props & { onClose: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState([...ids]);
  const [error, setError] = useState(false);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const dragging = useRef<string | null>(null);
  const visible = reconcileChatOrder(items, draft);
  const names = new Map(items.map((item) => [item.id, item.name]));

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const buttons = [
        ...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
      ];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !panel.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      previous?.focus();
    };
  }, [onClose]);

  const move = (id: string, target: string) => {
    if (id === target) return;
    setDraft((current) => {
      const next = reconcileChatOrder(items, current);
      const from = next.indexOf(id);
      const to = next.indexOf(target);
      if (from < 0 || to < 0) return next;
      next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-app-bg border-ink-800 flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-xl border p-4"
      >
        <h2 id={titleId} className="text-ink-100 text-sm font-semibold">
          {t('chatOrder.title')}
        </h2>
        <p className="text-muted text-xs">{t('chatOrder.hint')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            aria-label={t('chatOrder.alphabetical')}
            onClick={() => {
              setDraft(
                [...items]
                  .sort((a, b) =>
                    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
                  )
                  .map((item) => item.id),
              );
            }}
          >
            {t('chatOrder.alphabetical')}
          </Button>
          <Button
            size="sm"
            aria-label={t('chatOrder.default')}
            onClick={() => {
              setDraft(items.map((item) => item.id));
            }}
          >
            {t('chatOrder.default')}
          </Button>
        </div>
        <ol className="min-h-0 overflow-y-auto">
          {visible.map((id, index) => (
            <li
              key={id}
              data-chat-order-id={id}
              className="border-ink-800 flex items-center gap-2 border-b py-1"
            >
              <button
                type="button"
                aria-label={t('chatOrder.drag', { name: names.get(id) })}
                className="text-muted flex h-11 w-11 shrink-0 touch-none items-center justify-center"
                onPointerDown={(event) => {
                  dragging.current = id;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (dragging.current !== id) return;
                  const target = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>('[data-chat-order-id]')?.dataset.chatOrderId;
                  if (target) move(id, target);
                }}
                onPointerUp={() => {
                  dragging.current = null;
                }}
                onPointerCancel={() => {
                  dragging.current = null;
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' && index > 0) {
                    event.preventDefault();
                    move(id, visible[index - 1]);
                  }
                  if (event.key === 'ArrowDown' && index < visible.length - 1) {
                    event.preventDefault();
                    move(id, visible[index + 1]);
                  }
                }}
              >
                <GripVertical aria-hidden size={16} />
              </button>
              <span className="text-ink-200 min-w-0 flex-1 text-sm break-words">
                {names.get(id)}
              </span>
              <IconButton
                aria-label={t('chatOrder.up', { name: names.get(id) })}
                disabled={index === 0}
                onClick={() => {
                  move(id, visible[index - 1]);
                }}
                icon={<ArrowUp aria-hidden size={16} />}
              />
              <IconButton
                aria-label={t('chatOrder.down', { name: names.get(id) })}
                disabled={index === visible.length - 1}
                onClick={() => {
                  move(id, visible[index + 1]);
                }}
                icon={<ArrowDown aria-hidden size={16} />}
              />
            </li>
          ))}
        </ol>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {t('chatOrder.saveFailed')}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button aria-label={t('common.cancel')} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            aria-label={t('common.save')}
            onClick={() => {
              try {
                onSave(visible);
                onClose();
              } catch (error) {
                console.warn('[ChatOrderButton] save failed ' + errLikeToLogString(error));
                setError(true);
              }
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
