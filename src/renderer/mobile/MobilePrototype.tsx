import {
  ArrowLeft,
  Battery,
  Bluetooth,
  ChartNoAxesColumn,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Hash,
  Map,
  MapPin,
  MessageCircle,
  Network,
  Radio,
  RadioTower,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Signal,
  Smile,
  TriangleAlert,
  X,
} from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type MeshProtocol,
  REGISTERED_MESH_PROTOCOLS as MESH_PROTOCOLS,
} from '@/shared/meshProtocol';

import { ConversationLayout } from '../components/chat/ConversationLayout';
import { Button, IconButton } from '../components/ui/Button';
import { INPUT_CLASS, TEXTAREA_BOX_CLASS } from '../components/ui/formClasses';
import { PROTOCOL_THEME } from '../lib/protocolTheme';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from '../lib/radio/BaseRadioProvider';
import { ProtocolSwitcher } from './ProtocolSwitcher';
import { useWideMobileLayout } from './useWideMobileLayout';

export const MOBILE_SCENES = {
  connect: 'mobilePrototype.sceneConnect',
  permission: 'mobilePrototype.scenePermission',
  denied: 'mobilePrototype.sceneDenied',
  radios: 'mobilePrototype.sceneRadios',
  connecting: 'mobilePrototype.sceneConnecting',
  ready: 'mobilePrototype.sceneReady',
  'connection-error': 'mobilePrototype.sceneConnectionError',
  conversations: 'mobilePrototype.sceneConversations',
  chat: 'mobilePrototype.sceneChat',
  'message-error': 'mobilePrototype.sceneMessageError',
} as const;

export type MobileScene = keyof typeof MOBILE_SCENES;
export type MobilePlatform = 'ios' | 'android';
export type MobileDisplay = 'phone' | 'tablet' | 'foldable';

interface MobilePrototypeProps {
  initialScene?: MobileScene;
  initialPlatform?: MobilePlatform;
  initialProtocol?: MeshProtocol;
  initialDisplay?: MobileDisplay;
}

const SAMPLE_CAPABILITIES = {
  meshtastic: MESHTASTIC_CAPABILITIES,
  meshcore: MESHCORE_CAPABILITIES,
  reticulum: RETICULUM_CAPABILITIES,
};

const SAMPLE_RADIO_NAMES: Record<MeshProtocol, string> = {
  meshtastic: 'Trail radio',
  meshcore: 'Basecamp radio',
  reticulum: 'Field RNode',
};

const SAMPLE_CONVERSATIONS = {
  meshtastic: {
    nameKey: 'mobilePrototype.conversationName',
    incomingKey: 'mobilePrototype.incomingBody',
    outgoingKey: 'mobilePrototype.outgoingBody',
  },
  meshcore: {
    nameKey: 'mobilePrototype.meshcoreContactName',
    incomingKey: 'mobilePrototype.meshcoreIncoming',
    outgoingKey: 'mobilePrototype.meshcoreOutgoing',
  },
  reticulum: {
    nameKey: 'mobilePrototype.reticulumContactName',
    incomingKey: 'mobilePrototype.reticulumIncoming',
    outgoingKey: 'mobilePrototype.reticulumOutgoing',
  },
};
const SAMPLE_UNREAD_COUNTS = { meshtastic: 2, meshcore: 1, reticulum: 0 };

function updateProtocolPreview<T>(
  previous: Record<MeshProtocol, T>,
  protocol: MeshProtocol,
  next: T,
): Record<MeshProtocol, T> {
  switch (protocol) {
    case 'meshtastic':
      return { ...previous, meshtastic: next };
    case 'meshcore':
      return { ...previous, meshcore: next };
    case 'reticulum':
      return { ...previous, reticulum: next };
  }
}

function isMobileDisplay(value: string | null): value is MobileDisplay {
  return value === 'phone' || value === 'tablet' || value === 'foldable';
}
function sampleIsConnected(scene: MobileScene): boolean {
  return (
    scene === 'ready' || scene === 'conversations' || scene === 'chat' || scene === 'message-error'
  );
}

function isMobileScene(value: string | null): value is MobileScene {
  return value !== null && Object.hasOwn(MOBILE_SCENES, value);
}

function isMeshProtocol(value: string | null): value is MeshProtocol {
  return MESH_PROTOCOLS.some((protocol) => protocol === value);
}

export function MobilePrototype({
  initialScene,
  initialPlatform,
  initialProtocol,
  initialDisplay,
}: MobilePrototypeProps) {
  const { t } = useTranslation();
  const query = new URLSearchParams(window.location.search);
  const queryScene = query.get('scene');
  const queryProtocol = query.get('protocol');
  const startingScene = initialScene ?? (isMobileScene(queryScene) ? queryScene : 'connect');
  const [scenes, setScenes] = useState<Record<MeshProtocol, MobileScene>>({
    meshtastic: startingScene,
    meshcore: startingScene,
    reticulum: startingScene,
  });
  const [drafts, setDrafts] = useState<Record<MeshProtocol, string>>({
    meshtastic: '',
    meshcore: '',
    reticulum: '',
  });
  const queryDisplay = query.get('display');
  const [display, setDisplay] = useState<MobileDisplay>(
    initialDisplay ?? (isMobileDisplay(queryDisplay) ? queryDisplay : 'phone'),
  );
  const [platform, setPlatform] = useState<MobilePlatform>(
    initialPlatform ?? (query.get('platform') === 'android' ? 'android' : 'ios'),
  );
  const [protocol, setProtocol] = useState<MeshProtocol>(
    initialProtocol ?? (isMeshProtocol(queryProtocol) ? queryProtocol : 'meshtastic'),
  );
  const phone = useRef<HTMLDivElement>(null);
  const moreDialog = useRef<HTMLDialogElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = () => {
    moreDialog.current?.close();
    setMoreOpen(false);
    if (moreButton.current && !moreButton.current.disabled) moreButton.current.focus();
    else phone.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  };
  const wide = useWideMobileLayout(phone);
  const restoringProtocolFocus = useRef(false);
  const scene = scenes[protocol];
  const sample = SAMPLE_CONVERSATIONS[protocol];
  const setScene = (next: MobileScene) => {
    setScenes((previous) => updateProtocolPreview(previous, protocol, next));
  };
  const switchProtocol = (next: MeshProtocol) => {
    if (next === protocol) return;
    restoringProtocolFocus.current = true;
    setProtocol(next);
  };
  const protocolContexts = {
    meshtastic: {
      radioName: SAMPLE_RADIO_NAMES.meshtastic,
      connected: sampleIsConnected(scenes.meshtastic),
      unreadCount: SAMPLE_UNREAD_COUNTS.meshtastic,
    },
    meshcore: {
      radioName: SAMPLE_RADIO_NAMES.meshcore,
      connected: sampleIsConnected(scenes.meshcore),
      unreadCount: SAMPLE_UNREAD_COUNTS.meshcore,
    },
    reticulum: {
      radioName: SAMPLE_RADIO_NAMES.reticulum,
      connected: sampleIsConnected(scenes.reticulum),
      unreadCount: SAMPLE_UNREAD_COUNTS.reticulum,
    },
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const theme = PROTOCOL_THEME[protocol];
  const radioName = SAMPLE_RADIO_NAMES[protocol];
  const chatScene = scene === 'chat' || scene === 'message-error';
  const messagingScene = chatScene || scene === 'conversations';
  const connected = messagingScene || scene === 'ready';

  useEffect(() => {
    if (restoringProtocolFocus.current) {
      restoringProtocolFocus.current = false;
      return;
    }
    heading.current?.focus();
  }, [scene, protocol]);

  const previewButton = (label: string, next: MobileScene, primary = false) => (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      className="mobile-action w-full"
      aria-label={label}
      onClick={() => {
        setScene(next);
      }}
    >
      {label}
    </Button>
  );

  const radioRow = (name: string, id: string, nearby: boolean) => (
    <button
      type="button"
      className="mobile-radio-row"
      aria-label={t('mobilePrototype.previewRadio', { name })}
      onClick={() => {
        setScene('connecting');
      }}
    >
      <span className="mobile-device-icon">
        <Radio aria-hidden="true" size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink-100 block font-medium">{name}</span>
        <span className="text-label text-muted block font-mono">{id}</span>
        <span className={`text-label block ${theme.nameTextClass}`}>{theme.displayName}</span>
        <span className="text-label text-muted mt-1 flex items-center gap-1">
          <Signal aria-hidden="true" size={16} className="shrink-0" />
          {t(nearby ? 'mobilePrototype.nearby' : 'mobilePrototype.weaker')}
        </span>
      </span>
      <ChevronRight aria-hidden="true" size={18} className="text-muted" />
    </button>
  );

  const conversationRow = () => (
    <button
      type="button"
      className={`mobile-conversation-row ${chatScene ? 'is-selected' : ''}`}
      aria-label={t('mobilePrototype.openConversation', { name: t(sample.nameKey) })}
      onClick={() => {
        setScene('chat');
      }}
    >
      <span className="mobile-avatar" aria-hidden="true">
        {t(sample.nameKey).slice(0, 2).toLocaleUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{t(sample.nameKey)}</span>
        <span className="text-body text-muted mt-1 block">{t(sample.incomingKey)}</span>
        <span className="text-meta text-muted mt-1 block font-mono">09:41</span>
      </span>
      <ChevronRight aria-hidden="true" size={18} className="text-muted" />
    </button>
  );
  const conversationList = (
    <>
      <div className="mobile-list-header">
        <h1
          ref={!chatScene ? heading : undefined}
          tabIndex={-1}
          className="text-title font-semibold outline-none"
        >
          {t('mobilePrototype.chats')}
        </h1>
        <span className="text-label text-muted font-mono">3</span>
      </div>
      <div className="mobile-list-search">
        <Search aria-hidden="true" size={16} />
        <input
          className={INPUT_CLASS}
          readOnly
          disabled
          placeholder={t('mobilePrototype.searchConversations')}
          aria-label={t('mobilePrototype.searchConversations')}
        />
      </div>
      <div className="mobile-conversation-items">
        <p className="mobile-list-label">{t('mobilePrototype.channels')}</p>
        <button
          type="button"
          disabled
          className="mobile-conversation-row mobile-channel-row"
          aria-label={t('mobilePrototype.channelPending')}
        >
          <span className="mobile-channel-icon">
            <Hash aria-hidden="true" size={20} />
          </span>
          <span className="min-w-0">
            <span className="text-body block font-medium">
              {t('mobilePrototype.primaryChannel')}
            </span>
            <span className="text-label text-muted mt-1 block">
              {t('mobilePrototype.channelPreview')}
            </span>
          </span>
        </button>
        <p className="mobile-list-label">{t('mobilePrototype.directMessages')}</p>
        {conversationRow()}
        <button
          type="button"
          disabled
          className="mobile-conversation-row"
          aria-label={t('mobilePrototype.additionalConversationPending')}
        >
          <span className="mobile-avatar" aria-hidden="true">
            {t('mobilePrototype.secondContact').slice(0, 2).toLocaleUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="text-body block font-medium">
              {t('mobilePrototype.secondContact')}
            </span>
            <span className="text-label text-muted mt-1 block">
              {t('mobilePrototype.secondContactPreview')}
            </span>
          </span>
          <span className="text-label text-muted font-mono">09:28</span>
        </button>
      </div>
    </>
  );
  const sampleMessage = (body: string, own: boolean, time: string, failed = false) => (
    <div className={`mobile-message-row ${own ? 'own' : ''}`}>
      {!own && (
        <span className="mobile-message-avatar" aria-hidden="true">
          {t(sample.nameKey).slice(0, 2).toLocaleUpperCase()}
        </span>
      )}
      <div className={`mobile-message rounded-container ${own ? 'outgoing' : 'incoming'}`}>
        <div className="mobile-message-meta">
          <span className={`font-semibold ${own ? 'text-ink-200' : theme.nameTextClass}`}>
            {own ? t('mobilePrototype.you') : t(sample.nameKey)}
          </span>
          <span className="text-muted font-mono">{time}</span>
        </div>
        <p>{body}</p>
        {own && (
          <p className={`mobile-delivery ${failed ? 'text-red-400' : 'text-green-400'}`}>
            {failed ? (
              <CircleAlert aria-hidden="true" size={14} />
            ) : (
              <CheckCheck aria-hidden="true" size={14} />
            )}
            {t(failed ? 'mobilePrototype.sampleFailed' : 'mobilePrototype.sampleDelivered')}
          </p>
        )}
        {failed && (
          <Button
            className="mobile-action mt-2"
            aria-label={t('mobilePrototype.retryPlaceholder')}
            disabled
          >
            {t('mobilePrototype.retry')}
          </Button>
        )}
      </div>
    </div>
  );
  const conversationView = chatScene ? (
    <>
      <div className="mobile-conversation-header">
        {!wide && (
          <IconButton
            className="mobile-touch-control"
            aria-label={t('mobilePrototype.backToChats')}
            icon={<ArrowLeft size={20} aria-hidden="true" />}
            onClick={() => {
              setScene('conversations');
            }}
          />
        )}
        <span className="mobile-avatar" aria-hidden="true">
          {t(sample.nameKey).slice(0, 2).toLocaleUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 ref={heading} tabIndex={-1} className="text-title font-semibold outline-none">
            {t(sample.nameKey)}
          </h1>
          <p className="text-label text-muted">{t('mobilePrototype.directMessage')}</p>
        </div>
        <IconButton
          className="mobile-touch-control"
          disabled
          aria-label={t('mobilePrototype.conversationActionsPending')}
          icon={<Ellipsis aria-hidden="true" size={20} />}
        />
      </div>
      <div className="mobile-message-history" aria-label={t('mobilePrototype.messageHistory')}>
        <p className="mobile-day-label">{t('mobilePrototype.today')}</p>
        {sampleMessage(t(sample.incomingKey), false, '09:41')}
        {sampleMessage(t(sample.outgoingKey), true, '09:42')}
        {sampleMessage(t('mobilePrototype.followupIncoming'), false, '09:44')}
        {sampleMessage(
          t('mobilePrototype.followupOutgoing'),
          true,
          '09:45',
          scene === 'message-error',
        )}
      </div>
      <div className="mobile-composer-area">
        {scene === 'message-error' && (
          <p className="text-label mb-2 text-red-400">{t('mobilePrototype.failedHint')}</p>
        )}
        <label htmlFor="mobile-message" className="sr-only">
          {t('mobilePrototype.messageLabel')}
        </label>
        <div className="mobile-composer">
          <textarea
            id="mobile-message"
            className={TEXTAREA_BOX_CLASS}
            rows={1}
            value={drafts[protocol]}
            onChange={(event) => {
              setDrafts((previous) =>
                updateProtocolPreview(previous, protocol, event.target.value),
              );
            }}
            placeholder={t('mobilePrototype.messagePlaceholder')}
            aria-label={t('mobilePrototype.messageLabel')}
          />
          <IconButton
            className="mobile-touch-control"
            disabled
            aria-label={t('mobilePrototype.sendPlaceholder')}
            variant="secondary"
            icon={<Send aria-hidden="true" size={20} />}
          />
        </div>
        <div className="mobile-composer-tools">
          <IconButton
            className="mobile-touch-control"
            disabled
            aria-label={t('mobilePrototype.emojiPending')}
            icon={<Smile aria-hidden="true" size={18} />}
          />
          <IconButton
            className="mobile-touch-control"
            disabled
            aria-label={t('mobilePrototype.locationPending')}
            icon={<MapPin aria-hidden="true" size={18} />}
          />
          <span className="text-label text-muted ml-auto">{t('mobilePrototype.composerNote')}</span>
        </div>
      </div>
    </>
  ) : (
    <div className="mobile-chat-empty">
      <MessageCircle aria-hidden="true" size={32} className="text-muted" />
      <h1 ref={wide ? heading : undefined} tabIndex={-1} className="text-title mt-4 outline-none">
        {t('mobilePrototype.chooseConversation')}
      </h1>
    </div>
  );
  return (
    <div className="mobile-preview text-ink-200 font-sans" data-display={display}>
      <aside className="mobile-brief" aria-label={t('mobilePrototype.designBrief')}>
        <RadioTower aria-hidden="true" size={32} className="text-bright-green" />
        <p className="text-title mt-5 font-medium">{t('mobilePrototype.brand')}</p>
        <h2 className="mt-2 text-3xl font-semibold">{t('mobilePrototype.briefTitle')}</h2>
        <p className="text-muted mt-4 leading-relaxed">{t('mobilePrototype.briefBody')}</p>
        <div className="border-ink-700 text-body-lg text-muted mt-8 border-t pt-5 leading-relaxed">
          {t('mobilePrototype.briefDetails')}
        </div>
      </aside>

      <div className="mobile-device-column">
        <aside
          className="mobile-prototype-notice"
          aria-label={t('mobilePrototype.prototypeNotice')}
        >
          {t('mobilePrototype.prototypeNotice')}
        </aside>
        <div
          ref={phone}
          role="group"
          data-wide={wide}
          className="mobile-shell rounded-container"
          data-platform={platform}
        >
          <header aria-label={t('mobilePrototype.phonePreview')}>
            <div className="mobile-header">
              <h2 className="text-title font-semibold">
                {t(messagingScene ? 'mobilePrototype.chats' : 'shell.section.device')}
              </h2>
              {wide && (
                <div className="mobile-section-tabs">
                  <span className="is-selected">
                    {t(messagingScene ? 'mobilePrototype.chats' : 'mobilePrototype.bluetoothSetup')}
                  </span>
                </div>
              )}
              {!wide && (
                <div className="mobile-protocol-control">
                  <ProtocolSwitcher
                    protocol={protocol}
                    onSelect={switchProtocol}
                    contexts={protocolContexts}
                  />
                </div>
              )}
              {wide && (
                <IconButton
                  className="mobile-touch-control ml-auto"
                  disabled
                  aria-label={t('mobilePrototype.searchPending')}
                  icon={<Search aria-hidden="true" size={20} />}
                />
              )}
            </div>
          </header>

          <main className={`mobile-content ${messagingScene ? 'mobile-workspace' : ''}`}>
            {messagingScene ? (
              <ConversationLayout
                mode={{ compact: !wide, sideOverlay: !wide }}
                list={conversationList}
                listLabel={t('mobilePrototype.conversationList')}
                listOpen
                compactPane={chatScene ? 'conversation' : 'list'}
                conversation={conversationView}
                keepConversationMounted
              />
            ) : (
              <>
                <div className="mobile-page-title">
                  <p className={`text-label ${theme.nameTextClass}`}>
                    {t(
                      messagingScene
                        ? 'mobilePrototype.sampleMessages'
                        : 'mobilePrototype.bluetoothSetup',
                    )}
                  </p>
                  <h1
                    ref={heading}
                    tabIndex={-1}
                    className="mt-1 text-2xl font-semibold outline-none"
                  >
                    {chatScene ? t(sample.nameKey) : t(MOBILE_SCENES[scene])}
                  </h1>
                  {chatScene && (
                    <p className="text-body-lg text-muted mt-1">
                      {t('mobilePrototype.sampleConversation')}
                    </p>
                  )}
                </div>

                {scene === 'connect' && (
                  <>
                    <div className="mobile-radio-art" aria-hidden="true">
                      <div>
                        <RadioTower size={40} />
                      </div>
                    </div>
                    <p className="text-body-lg text-ink-300 leading-relaxed">
                      {t('mobilePrototype.connectBody')}
                    </p>
                    <div className="mobile-checklist">
                      <p>
                        <Check aria-hidden="true" size={18} />
                        {t('mobilePrototype.radioOn')}
                      </p>
                      <p>
                        <Check aria-hidden="true" size={18} />
                        {t('mobilePrototype.radioClose')}
                      </p>
                      <p>
                        <Check aria-hidden="true" size={18} />
                        {t('mobilePrototype.otherApps')}
                      </p>
                    </div>
                    <div className="mt-auto pt-8">
                      {previewButton(t('mobilePrototype.findRadios'), 'permission', true)}
                      <p className="text-label text-muted mt-3 text-center leading-relaxed">
                        {t('mobilePrototype.noInternet')}
                      </p>
                    </div>
                  </>
                )}

                {scene === 'permission' && (
                  <>
                    <div className="mobile-feature-icon">
                      <ShieldCheck aria-hidden="true" size={40} />
                    </div>
                    <p className="text-body-lg leading-relaxed">
                      {t(
                        platform === 'ios'
                          ? 'mobilePrototype.iosPermission'
                          : 'mobilePrototype.androidPermission',
                      )}
                    </p>
                    <p className="text-muted mt-4 leading-relaxed">
                      {t('mobilePrototype.permissionNote')}
                    </p>
                    <div className="mt-auto space-y-3 pt-8">
                      {previewButton(t('mobilePrototype.continue'), 'radios', true)}
                      {previewButton(t('mobilePrototype.notNow'), 'connect')}
                    </div>
                  </>
                )}

                {(scene === 'denied' || scene === 'connection-error') && (
                  <>
                    <div
                      className={`mobile-feature-icon ${scene === 'denied' ? 'text-orange-400' : 'text-red-400'}`}
                    >
                      <CircleAlert aria-hidden="true" size={40} />
                    </div>
                    <p className="text-body-lg leading-relaxed">
                      {t(
                        scene === 'denied'
                          ? 'mobilePrototype.deniedBody'
                          : 'mobilePrototype.connectionErrorBody',
                      )}
                    </p>
                    <div className="mobile-note mt-6">
                      {t(
                        scene === 'denied'
                          ? 'mobilePrototype.settingsHelp'
                          : 'mobilePrototype.connectionHelp',
                      )}
                    </div>
                    <div className="mt-auto space-y-3 pt-8">
                      {previewButton(
                        t('mobilePrototype.tryAgain'),
                        scene === 'denied' ? 'permission' : 'connecting',
                        true,
                      )}
                      {previewButton(t('mobilePrototype.chooseAnother'), 'radios')}
                    </div>
                  </>
                )}

                {scene === 'radios' && (
                  <>
                    <p className="text-body-lg text-muted leading-relaxed">
                      {t('mobilePrototype.radiosBody')}
                    </p>
                    <div className="text-body-lg text-bright-green mt-6 flex items-center gap-2">
                      <Search aria-hidden="true" size={18} />
                      {t('mobilePrototype.sampleScan')}
                    </div>
                    <div className="mobile-radio-list mt-3">
                      {radioRow(radioName, 'Demo 01', true)}
                      {radioRow(t('mobilePrototype.secondRadio'), 'Demo 02', false)}
                    </div>
                    <div className="mobile-note mt-6">{t('mobilePrototype.missingRadio')}</div>
                    <div className="mt-auto space-y-3 pt-8">
                      {previewButton(t('mobilePrototype.rescan'), 'radios')}
                      {previewButton(t('mobilePrototype.cancel'), 'connect')}
                    </div>
                  </>
                )}

                {scene === 'connecting' && (
                  <>
                    <div className="mobile-feature-icon">
                      <Bluetooth aria-hidden="true" size={42} />
                    </div>
                    <p className="text-title text-ink-100">{radioName}</p>
                    <p className="text-muted mt-2 leading-relaxed">
                      {t('mobilePrototype.pairingBody')}
                    </p>
                    <ol className="mobile-progress mt-8">
                      <li>
                        <Check aria-hidden="true" size={20} />
                        <span>{t('mobilePrototype.radioFound')}</span>
                      </li>
                      <li className="text-bright-green">
                        <Bluetooth aria-hidden="true" size={20} />
                        <span>{t('mobilePrototype.systemPairing')}</span>
                      </li>
                      <li className="text-muted">
                        <Radio aria-hidden="true" size={20} />
                        <span>{t('mobilePrototype.readSettings')}</span>
                      </li>
                    </ol>
                    <div className="mt-auto pt-8">
                      {previewButton(t('mobilePrototype.cancel'), 'radios')}
                    </div>
                  </>
                )}

                {scene === 'ready' && (
                  <>
                    <div className="mobile-feature-icon text-green-400">
                      <CheckCheck aria-hidden="true" size={42} />
                    </div>
                    <p className="text-body-lg text-muted leading-relaxed">
                      {t('mobilePrototype.readyBody')}
                    </p>
                    <div className="mobile-radio-summary mt-6">
                      <Radio aria-hidden="true" size={28} className={theme.nameTextClass} />
                      <div>
                        <p className="font-medium">{radioName}</p>
                        <p className="text-label text-muted">{t('mobilePrototype.sampleRadio')}</p>
                      </div>
                      {SAMPLE_CAPABILITIES[protocol].hasBatteryTelemetry && (
                        <div className="mobile-metrics">
                          <Battery aria-hidden="true" size={20} />
                          <span className="text-label font-mono">84%</span>
                        </div>
                      )}
                    </div>
                    <div className="mobile-note mt-5">{t('mobilePrototype.reachabilityNote')}</div>
                    <div className="mt-auto space-y-3 pt-8">
                      {previewButton(t('mobilePrototype.openChat'), 'conversations', true)}
                      {previewButton(t('mobilePrototype.disconnect'), 'connect')}
                    </div>
                  </>
                )}
              </>
            )}
          </main>

          <nav className="mobile-nav" aria-label={t('mobilePrototype.mainNavigation')}>
            <div className="mobile-nav-primary">
              {wide && (
                <div className="mobile-rail-protocol">
                  <ProtocolSwitcher
                    wide
                    protocol={protocol}
                    onSelect={switchProtocol}
                    contexts={protocolContexts}
                  />
                </div>
              )}
              <button
                type="button"
                aria-label={t('mobilePrototype.chats')}
                aria-current={messagingScene ? 'page' : undefined}
                onClick={() => {
                  setScene('conversations');
                }}
              >
                <MessageCircle aria-hidden="true" size={22} />
                <span>{t('mobilePrototype.chats')}</span>
              </button>
              <button type="button" disabled aria-label={t('mobilePrototype.networkPending')}>
                <Network aria-hidden="true" size={22} />
                <span>{t('mobilePrototype.network')}</span>
              </button>
              <button type="button" disabled aria-label={t('mobilePrototype.mapPending')}>
                <Map aria-hidden="true" size={22} />
                <span>{t('mobilePrototype.map')}</span>
              </button>
              {wide && (
                <>
                  <button type="button" disabled aria-label={t('shell.section.monitor')}>
                    <ChartNoAxesColumn size={20} aria-hidden="true" />
                    <span>{t('shell.section.monitor')}</span>
                  </button>
                  <button
                    type="button"
                    aria-current={!messagingScene ? 'page' : undefined}
                    aria-label={t('shell.section.device')}
                    onClick={() => {
                      setScene('connect');
                    }}
                  >
                    <Radio size={20} aria-hidden="true" />
                    <span>{t('shell.section.device')}</span>
                  </button>
                </>
              )}
            </div>
            <div className="mobile-nav-footer">
              <button
                className="mobile-nav-incident"
                type="button"
                disabled
                aria-label={t('mobilePrototype.incidentPending')}
              >
                <TriangleAlert aria-hidden="true" size={22} />
                <span>{t('mobilePrototype.incident')}</span>
              </button>
              <button
                type="button"
                ref={moreButton}
                disabled={wide}
                aria-label={t(wide ? 'mobilePrototype.app' : 'mobilePrototype.more')}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                onClick={() => {
                  moreDialog.current?.showModal();
                  setMoreOpen(true);
                }}
              >
                {wide ? (
                  <Settings aria-hidden="true" size={20} />
                ) : (
                  <Ellipsis aria-hidden="true" size={20} />
                )}
                <span>{t(wide ? 'mobilePrototype.app' : 'mobilePrototype.more')}</span>
              </button>
            </div>
          </nav>
          <footer className="mobile-status-bar">
            <button
              type="button"
              aria-label={t('mobilePrototype.previewConnection')}
              onClick={() => {
                setScene(connected ? 'ready' : 'connect');
              }}
            >
              <Bluetooth
                aria-hidden="true"
                size={14}
                className={connected ? 'text-green-400' : 'text-muted'}
              />
              <span>
                {connected
                  ? t('mobilePrototype.sampleConnected', { name: radioName })
                  : t('mobilePrototype.notConnected')}
              </span>
              <ChevronRight aria-hidden="true" size={14} />
            </button>
            {wide && (
              <span className="text-muted text-meta font-mono">
                {t('mobilePrototype.sampleCounts')}
              </span>
            )}
          </footer>
          <dialog
            ref={moreDialog}
            className="mobile-launcher-dialog"
            aria-labelledby="mobile-launcher-title"
            onCancel={(event) => {
              event.preventDefault();
              closeMore();
            }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault();
                closeMore();
              }
            }}
          >
            <div className="mobile-launcher-body">
              <div className="mobile-launcher-header">
                <h2 id="mobile-launcher-title" className="text-title font-semibold">
                  {t('shell.launcher.title')}
                </h2>
                <IconButton
                  className="mobile-touch-control"
                  aria-label={t('common.close')}
                  icon={<X aria-hidden="true" size={20} />}
                  onClick={closeMore}
                />
              </div>
              <button
                type="button"
                className="mobile-launcher-row"
                onClick={() => {
                  closeMore();
                  setScene('connect');
                }}
              >
                <Radio size={20} aria-hidden="true" />
                <span>
                  <span className="block font-medium">{t('mobilePrototype.connection')}</span>
                  <span className="text-label text-muted">
                    {t('mobilePrototype.bluetoothSetup')}
                  </span>
                </span>
                <ChevronRight size={16} aria-hidden="true" className="ml-auto" />
              </button>
              <button
                type="button"
                className="mobile-launcher-row"
                onClick={() => {
                  closeMore();
                  setScene('conversations');
                }}
              >
                <MessageCircle size={20} aria-hidden="true" />
                <span>{t('mobilePrototype.chats')}</span>
                <ChevronRight size={16} aria-hidden="true" className="ml-auto" />
              </button>
              <p className="text-label text-muted px-3 pt-4 pb-2">
                {t('mobilePrototype.futurePanels')}
              </p>
              <div className="mobile-launcher-future">
                <Button disabled icon={<Network aria-hidden="true" size={16} />}>
                  {t('mobilePrototype.network')}
                </Button>
                <Button disabled icon={<Map aria-hidden="true" size={16} />}>
                  {t('mobilePrototype.map')}
                </Button>
                <Button disabled icon={<TriangleAlert aria-hidden="true" size={16} />}>
                  {t('mobilePrototype.incident')}
                </Button>
              </div>
            </div>
          </dialog>
        </div>
      </div>

      <aside className="mobile-review" aria-label={t('mobilePrototype.reviewControls')}>
        <details open>
          <summary>{t('mobilePrototype.reviewControls')}</summary>
          <div className="mobile-review-fields">
            <label htmlFor="preview-display">{t('mobilePrototype.display')}</label>
            <select
              id="preview-display"
              value={display}
              aria-label={t('mobilePrototype.display')}
              onChange={(event) => {
                if (isMobileDisplay(event.target.value)) setDisplay(event.target.value);
              }}
            >
              <option value="phone">{t('mobilePrototype.phone')}</option>
              <option value="tablet">{t('mobilePrototype.tablet')}</option>
              <option value="foldable">{t('mobilePrototype.foldable')}</option>
            </select>
            <label htmlFor="preview-platform">{t('mobilePrototype.platform')}</label>
            <select
              id="preview-platform"
              value={platform}
              aria-label={t('mobilePrototype.platform')}
              onChange={(event) => {
                setPlatform(event.target.value === 'android' ? 'android' : 'ios');
              }}
            >
              <option value="ios">iOS</option>
              <option value="android">Android</option>
            </select>
            <label htmlFor="preview-protocol">{t('mobilePrototype.protocol')}</label>
            <select
              id="preview-protocol"
              value={protocol}
              aria-label={t('mobilePrototype.protocol')}
              onChange={(event) => {
                if (isMeshProtocol(event.target.value)) switchProtocol(event.target.value);
              }}
            >
              {MESH_PROTOCOLS.map((value) => (
                <option key={value} value={value}>
                  {PROTOCOL_THEME[value].displayName}
                </option>
              ))}
            </select>
            <label htmlFor="preview-scene">{t('mobilePrototype.screen')}</label>
            <select
              id="preview-scene"
              value={scene}
              aria-label={t('mobilePrototype.screen')}
              onChange={(event) => {
                if (isMobileScene(event.target.value)) setScene(event.target.value);
              }}
            >
              {Object.entries(MOBILE_SCENES).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
            <p className="text-body-lg text-muted mt-4 leading-relaxed">
              {t('mobilePrototype.reviewNote')}
            </p>
          </div>
        </details>
      </aside>
    </div>
  );
}
