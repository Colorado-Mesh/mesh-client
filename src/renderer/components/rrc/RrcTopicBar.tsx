import { useTranslation } from 'react-i18next';

export interface RrcTopicBarProps {
  room: string | null;
  topic: string | null | undefined;
  memberCount?: number;
}

export function RrcTopicBar({ room, topic, memberCount }: RrcTopicBarProps) {
  const { t } = useTranslation();
  if (!room || room.startsWith('[')) return null;
  return (
    <div className="flex items-center gap-2 border-b border-amber-800/40 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-100/80">
      <span className="font-semibold text-amber-200">{room}</span>
      <span className="text-amber-500/50">|</span>
      <span className="min-w-0 flex-1 truncate text-amber-200/60 italic">
        {topic?.trim() ? topic : t('rrc.noTopic')}
      </span>
      {memberCount != null && memberCount > 0 && (
        <span className="shrink-0 text-amber-200/50">
          {t('rrc.memberCount', { count: memberCount })}
        </span>
      )}
    </div>
  );
}
