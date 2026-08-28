import { useTranslation } from 'react-i18next';

export interface RrcTopicBarProps {
  room: string | null;
  topic: string | null | undefined;
  memberCount?: number;
}

export function RrcTopicBar({ room, topic, memberCount }: RrcTopicBarProps) {
  const { t } = useTranslation();
  if (!room || room.startsWith('[') || room.startsWith('@')) return null;
  return (
    <div className="flex items-center gap-2 border-b border-gray-700 bg-slate-800/50 px-3 py-1.5 text-xs text-gray-200">
      <span className="font-semibold text-gray-100">{room}</span>
      <span className="text-gray-600">|</span>
      <span className="min-w-0 flex-1 truncate text-gray-400 italic">
        {topic?.trim() ? topic : t('rrc.noTopic')}
      </span>
      {memberCount != null && memberCount > 0 && (
        <span className="shrink-0 text-gray-400">
          {t('rrc.memberCount', { count: memberCount })}
        </span>
      )}
    </div>
  );
}
