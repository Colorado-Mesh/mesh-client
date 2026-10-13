import {
  ArrowLeft,
  ArrowUp,
  Battery,
  Bluetooth,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Map,
  MessageCircle,
  Network,
  Radio,
  RadioTower,
  Search,
  ShieldCheck,
  Signal,
  TriangleAlert,
} from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type MeshProtocol,
  REGISTERED_MESH_PROTOCOLS as MESH_PROTOCOLS,
} from '@/shared/meshProtocol';

import { Button } from '../components/ui/Button';
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
  const wide = useWideMobileLayout(phone);
  const restoringProtocolFocus = useRef(false);
  const scene = scenes[protocol];
  const sample = SAMPLE_CONVERSATIONS[protocol];
  const setScene = (next: MobileScene) => {
    setScenes((previous) => ({ ...previous, [protocol]: next }));
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
      className="mobile-conversation-row"
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
        <span className="text-body-lg text-muted mt-1 block">{t(sample.incomingKey)}</span>
        <span className="text-label text-muted mt-2 block font-mono">09:41</span>
      </span>
      <ChevronRight aria-hidden="true" size={18} className="text-muted" />
    </button>
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
          className="mobile-shell"
          data-platform={platform}
        >
          <header aria-label={t('mobilePrototype.phonePreview')}>
            <div className="mobile-header">
              {chatScene && !wide ? (
                <button
                  type="button"
                  className="mobile-back"
                  aria-label={t('mobilePrototype.backToChats')}
                  onClick={() => {
                    setScene('conversations');
                  }}
                >
                  <ArrowLeft aria-hidden="true" size={22} />
                  {platform === 'ios' && <span>{t('mobilePrototype.chats')}</span>}
                </button>
              ) : (
                <RadioTower aria-hidden="true" size={25} className="text-bright-green" />
              )}
              <span className="font-medium">{t('mobilePrototype.brand')}</span>
              <div className="mobile-protocol-control">
                <ProtocolSwitcher
                  protocol={protocol}
                  onSelect={switchProtocol}
                  contexts={protocolContexts}
                />
              </div>
            </div>

            <button
              type="button"
              className="mobile-link-status"
              aria-label={t('mobilePrototype.previewConnection')}
              onClick={() => {
                setScene(connected ? 'ready' : 'connect');
              }}
            >
              <Bluetooth
                aria-hidden="true"
                size={16}
                className={connected ? 'text-green-400' : 'text-muted'}
              />
              <span>
                {connected
                  ? t('mobilePrototype.sampleConnected', { name: radioName })
                  : t('mobilePrototype.notConnected')}
              </span>
              <ChevronRight aria-hidden="true" size={16} className="text-muted ml-auto shrink-0" />
            </button>
          </header>

          <main
            className={`mobile-content ${chatScene ? 'mobile-chat-content' : ''} ${messagingScene && wide ? 'mobile-split-content' : ''}`}
          >
            {messagingScene && wide && (
              <section
                className="mobile-chat-sidebar"
                aria-label={t('mobilePrototype.conversationList')}
              >
                <h2 className="text-title font-semibold">{t('mobilePrototype.chats')}</h2>
                <p className="text-label text-muted mt-2">{t('mobilePrototype.sampleMessages')}</p>
                {conversationRow()}
                <div className="mobile-note mt-5">{t('mobilePrototype.historyNote')}</div>
              </section>
            )}
            <div className="mobile-page-title">
              <p className={`text-label ${theme.nameTextClass}`}>
                {t(
                  messagingScene
                    ? 'mobilePrototype.sampleMessages'
                    : 'mobilePrototype.bluetoothSetup',
                )}
              </p>
              <h1 ref={heading} tabIndex={-1} className="mt-1 text-2xl font-semibold outline-none">
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
                  <div className="mobile-radio-art-ring">
                    <RadioTower size={64} strokeWidth={1.25} />
                  </div>
                  <span className="mobile-radio-art-mark">
                    <Bluetooth size={24} />
                  </span>
                </div>
                <p className="text-title text-ink-300 leading-relaxed">
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
                <p className="text-title leading-relaxed">
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
                <p className="text-title leading-relaxed">
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
                <p className="text-title text-muted leading-relaxed">
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
                <p className="text-title text-muted leading-relaxed">
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

            {scene === 'conversations' && !wide && (
              <>
                <p className="text-title text-muted mb-6">
                  {t('mobilePrototype.conversationsBody')}
                </p>
                {conversationRow()}
                <div className="mobile-note mt-6">{t('mobilePrototype.historyNote')}</div>
              </>
            )}
            {scene === 'conversations' && wide && (
              <div className="mobile-chat-empty">
                <MessageCircle aria-hidden="true" size={40} className="text-muted" />
                <p className="text-title mt-4">{t('mobilePrototype.chooseConversation')}</p>
              </div>
            )}

            {chatScene && (
              <>
                <div
                  className="mobile-message-history"
                  aria-label={t('mobilePrototype.messageHistory')}
                >
                  <p className="text-label text-muted mb-6 text-center font-mono">
                    {t('mobilePrototype.today')}
                  </p>
                  <div className="mobile-message incoming">
                    <p className="text-label text-ink-200 mb-2 font-medium">{t(sample.nameKey)}</p>
                    <p>{t(sample.incomingKey)}</p>
                    <p className="text-label text-muted mt-3 font-mono">09:41</p>
                  </div>
                  <div className="mobile-message outgoing">
                    <p>{t(sample.outgoingKey)}</p>
                    <p
                      className={`mobile-delivery ${scene === 'message-error' ? 'text-red-400' : 'text-green-400'}`}
                    >
                      {scene === 'message-error' ? (
                        <CircleAlert aria-hidden="true" size={16} />
                      ) : (
                        <CheckCheck aria-hidden="true" size={16} />
                      )}
                      {t(
                        scene === 'message-error'
                          ? 'mobilePrototype.sampleFailed'
                          : 'mobilePrototype.sampleDelivered',
                      )}
                    </p>
                    {scene === 'message-error' && (
                      <Button
                        className="mobile-action mt-3 w-full"
                        aria-label={t('mobilePrototype.retryPlaceholder')}
                        disabled
                      >
                        {t('mobilePrototype.retry')}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mobile-composer-area">
                  {scene === 'message-error' && (
                    <p className="text-body-lg mb-3 text-red-400">
                      {t('mobilePrototype.failedHint')}
                    </p>
                  )}
                  <label htmlFor="mobile-message" className="sr-only">
                    {t('mobilePrototype.messageLabel')}
                  </label>
                  <div className="mobile-composer">
                    <textarea
                      id="mobile-message"
                      rows={2}
                      value={drafts[protocol]}
                      onChange={(event) => {
                        setDrafts((previous) => ({ ...previous, [protocol]: event.target.value }));
                      }}
                      placeholder={t('mobilePrototype.messagePlaceholder')}
                      aria-label={t('mobilePrototype.messageLabel')}
                    />
                    <button
                      type="button"
                      disabled
                      className="mobile-send"
                      aria-label={t('mobilePrototype.sendPlaceholder')}
                    >
                      <ArrowUp aria-hidden="true" size={22} />
                    </button>
                  </div>
                  <p className="text-label text-muted mt-2">{t('mobilePrototype.composerNote')}</p>
                </div>
              </>
            )}
          </main>

          <nav className="mobile-nav" aria-label={t('mobilePrototype.mainNavigation')}>
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
            <button type="button" disabled aria-label={t('mobilePrototype.incidentPending')}>
              <TriangleAlert aria-hidden="true" size={22} />
              <span>{t('mobilePrototype.incident')}</span>
            </button>
            <button
              type="button"
              aria-label={t('mobilePrototype.more')}
              aria-current={!messagingScene ? 'page' : undefined}
              onClick={() => {
                setScene('connect');
              }}
            >
              <Ellipsis aria-hidden="true" size={22} />
              <span>{t('mobilePrototype.more')}</span>
            </button>
          </nav>
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
