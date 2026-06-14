// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  interpolationPlaceholderIssues,
  localeStringQualityIssues,
  nodeListPanelConnectionCrossKeyIssues,
  protectedBrandIssues,
  roomsSavedPasswordsCrossKeyIssues,
  roomsSidebarMarkerCrossKeyIssues,
} from './check-i18n-quality.mjs';

function expectIssue(issues, substring) {
  expect(issues.some((msg) => msg.includes(substring))).toBe(true);
}

describe('localeStringQualityIssues', () => {
  const enCopyFailed = 'Copy failed';
  const enCopyMeshtastic = 'Copy meshtastic:// link';
  const enCopyPublicKey = 'Copy';
  const enPreviewLora = 'LoRa: region {{region}}, preset {{preset}}, usePreset {{usePreset}}';
  const enRoleSecondary = 'Secondary';
  const enModeAdd = 'Add channels';
  const enRemoteBanner = 'Configuring remote node: {{name}} ({{nodeId}})';
  const enRequiresLocalRadio = 'Connect a local Meshtastic radio to use remote administration.';
  const enRemoteAdminSetupHint =
    'Copy this key and add it as an Admin Key on remote nodes you want to configure. See Meshtastic remote admin docs.';
  const enOfflineGate =
    'Wait a few minutes after reconnecting before auto-fetch runs; use Catch up manually.';

  it('flags untranslated Catch up in offline_gate', () => {
    const issues = localeStringQualityIssues({
      locale: 'es',
      flatKey: 'chatPanel.fetchStoreForwardHistoryError.offline_gate',
      val: 'Espere unos minutos; use Catch up manualmente.',
      enVal: enOfflineGate,
    });
    expectIssue(
      issues,
      'translate "Catch up" using the locale fetchStoreForwardHistory button label',
    );
  });

  it('passes offline_gate when Catch up is localized', () => {
    expect(
      localeStringQualityIssues({
        locale: 'es',
        flatKey: 'chatPanel.fetchStoreForwardHistoryError.offline_gate',
        val: 'Espere unos minutos; utilice Póngase al día manualmente.',
        enVal: enOfflineGate,
      }),
    ).toEqual([]);
  });

  it('flags CAT __ PH __ placeholders in remoteBanner', () => {
    const issues = localeStringQualityIssues({
      locale: 'ja',
      flatKey: 'configureNode.remoteBanner',
      val: 'リモートノードの設定： __ PH0 __ (__ PH1 __)',
      enVal: enRemoteBanner,
    });
    expectIssue(issues, 'CAT/XLIFF __ PH __ placeholder residue is not allowed');
  });

  it('flags Cyrillic Meshtastic transliteration without brand token', () => {
    const issues = localeStringQualityIssues({
      locale: 'ru',
      flatKey: 'configureNode.requiresLocalRadio',
      val: 'Подключите местное мештастическое радио, чтобы использовать удаленное администрирование.',
      enVal: enRequiresLocalRadio,
    });
    expectIssue(issues, 'use brand name "Meshtastic", not Cyrillic transliteration');
  });

  it('flags untranslated remote admin docs phrase', () => {
    const issues = localeStringQualityIssues({
      locale: 'cs',
      flatKey: 'securityPanel.remoteAdminSetupHint',
      val: 'Zkopírujte tento klíč. Viz Meshtastic remote admin docs.',
      enVal: enRemoteAdminSetupHint,
    });
    expectIssue(issues, 'translate "remote admin docs"');
  });

  it('flags copyPublicKey identical to English', () => {
    const issues = localeStringQualityIssues({
      locale: 'pt-BR',
      flatKey: 'securityPanel.copyPublicKey',
      val: enCopyPublicKey,
      enVal: enCopyPublicKey,
    });
    expectIssue(issues, 'copyPublicKey" is still identical to English');
  });

  it('flags UTF-8 mojibake', () => {
    const issues = localeStringQualityIssues({
      locale: 'uk',
      flatKey: 'radioPanel.channelUrl.copyFailed',
      val: 'ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑÑ ÑÐºÐ¾Ð¿ÑÑÐ²Ð°ÑÐ¸',
      enVal: enCopyFailed,
    });
    expectIssue(issues, 'mojibake/encoding corruption detected');
  });

  it('flags whitespace inside meshtastic://', () => {
    const issues = localeStringQualityIssues({
      locale: 'id',
      flatKey: 'radioPanel.channelUrl.meshtasticUrlLabel',
      val: 'meshtastic :// link',
      enVal: 'meshtastic:// link',
    });
    expectIssue(issues, 'meshtastic:// scheme must not contain whitespace before "://"');
  });

  it('flags meshtastisch misspelling', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'radioPanel.channelUrl.pasteUrlPlaceholder',
      val: 'https://meshtastic.org/e/#… oder meshtastisch://…',
      enVal: 'https://meshtastic.org/e/#… or meshtastic://…',
    });
    expectIssue(issues, 'use protocol spelling "meshtastic", not "meshtastisch"');
  });

  it('flags Chinese CAT garbage placeholders', () => {
    const issues = localeStringQualityIssues({
      locale: 'zh',
      flatKey: 'radioPanel.channelUrl.copyFailed',
      val: '复制% 1 个文件夹( C)',
      enVal: enCopyFailed,
    });
    expectIssue(issues, 'Chinese CAT/Qt placeholder garbage');
  });

  it('flags French chaînes false friend in channel URL copy', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'radioPanel.channelUrl.addWarning',
      val: 'Les chaînes existantes sont ignorées.',
      enVal: 'Existing channels with the same name are skipped.',
    });
    expectIssue(issues, 'French "chaîne(s)" means broadcast channel');
  });

  it('flags untranslated copyMeshtastic identical to English', () => {
    const issues = localeStringQualityIssues({
      locale: 'es',
      flatKey: 'radioPanel.channelUrl.copyMeshtastic',
      val: enCopyMeshtastic,
      enVal: enCopyMeshtastic,
    });
    expectIssue(issues, 'still identical to English');
  });

  it('flags English Copy meshtastic prefix in non-English locale', () => {
    const issues = localeStringQualityIssues({
      locale: 'tr',
      flatKey: 'radioPanel.channelUrl.copyMeshtastic',
      val: 'Copy meshtastic :// link',
      enVal: enCopyMeshtastic,
    });
    expectIssue(issues, 'still starts with English "Copy meshtastic"');
  });

  it('flags truncated roleSecondary (single Latin letter)', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'radioPanel.channelUrl.roleSecondary',
      val: 'B',
      enVal: enRoleSecondary,
    });
    expectIssue(issues, 'roleSecondary looks truncated');
  });

  it('allows short CJK roleSecondary labels', () => {
    expect(
      localeStringQualityIssues({
        locale: 'zh',
        flatKey: 'radioPanel.channelUrl.roleSecondary',
        val: '二级',
        enVal: enRoleSecondary,
      }),
    ).toEqual([]);
  });

  it('flags ALL CAPS modeAdd in Latin locales', () => {
    const issues = localeStringQualityIssues({
      locale: 'pl',
      flatKey: 'radioPanel.channelUrl.modeAdd',
      val: 'DODAJ KANAŁY',
      enVal: enModeAdd,
    });
    expectIssue(issues, 'modeAdd must not be ALL CAPS');
  });

  it('flags missing {{usePreset}} in previewLora', () => {
    const issues = localeStringQualityIssues({
      locale: 'pl',
      flatKey: 'radioPanel.channelUrl.previewLora',
      val: 'LoRa: region {{region}}, preset {{preset}}, użyj Reset {{preset}}',
      enVal: enPreviewLora,
    });
    expectIssue(issues, 'missing {{usePreset}} interpolation');
  });

  it('passes valid Ukrainian copyFailed', () => {
    expect(
      localeStringQualityIssues({
        locale: 'uk',
        flatKey: 'radioPanel.channelUrl.copyFailed',
        val: 'Не вдалося скопіювати',
        enVal: enCopyFailed,
      }),
    ).toEqual([]);
  });

  it('passes valid meshtastic:// label', () => {
    expect(
      localeStringQualityIssues({
        locale: 'de',
        flatKey: 'radioPanel.channelUrl.copyMeshtastic',
        val: 'meshtastic://-Link kopieren',
        enVal: enCopyMeshtastic,
      }),
    ).toEqual([]);
  });

  it('flags untranslated channelLoading identical to English', () => {
    const issues = localeStringQualityIssues({
      locale: 'cs',
      flatKey: 'radioPanel.channelLoading',
      val: 'Loading…',
      enVal: 'Loading…',
    });
    expectIssue(issues, 'channelLoading" is still identical to English');
  });

  it('flags ASCII ellipsis when English uses Unicode …', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'radioPanel.channelLoading',
      val: 'Chargement....',
      enVal: 'Loading…',
    });
    expectIssue(issues, 'use Unicode ellipsis (…) instead of ASCII dots');
  });

  it('flags retryRemoteChannels loading-channel false friend in Spanish', () => {
    const issues = localeStringQualityIssues({
      locale: 'es',
      flatKey: 'radioPanel.retryRemoteChannels',
      val: 'Reintentar canales de carga',
      enVal: 'Retry loading channels',
    });
    expectIssue(issues, 'retryRemoteChannels false friend');
  });

  it('passes valid retryRemoteChannels in Spanish', () => {
    expect(
      localeStringQualityIssues({
        locale: 'es',
        flatKey: 'radioPanel.retryRemoteChannels',
        val: 'Reintentar cargar los canales',
        enVal: 'Retry loading channels',
      }),
    ).toEqual([]);
  });

  it('flags Dutch mislukte on channelLoadFailed', () => {
    const issues = localeStringQualityIssues({
      locale: 'nl',
      flatKey: 'radioPanel.channelLoadFailed',
      val: 'Laden mislukte',
      enVal: 'Load failed',
    });
    expectIssue(issues, 'use past participle "mislukt"');
  });

  it('flags CAT XLIFF XML tags in roomsPanel cliSend', () => {
    const issues = localeStringQualityIssues({
      locale: 'it',
      flatKey: 'roomsPanel.cliSend',
      val: '<g id="9770">Spedisci</g>:',
      enVal: 'Send',
    });
    expectIssue(issues, 'CAT/XLIFF/Memsource XML residue is not allowed');
  });

  it('flags __ PH0 __ placeholders in roomsPanel postCount', () => {
    const issues = localeStringQualityIssues({
      locale: 'ja',
      flatKey: 'roomsPanel.postCount',
      val: '__ PH0 __件の投稿',
      enVal: '{{count}} posts',
    });
    expectIssue(issues, 'CAT/XLIFF __ PH __ placeholder residue is not allowed');
  });

  it('flags hotel-room false friend in roomsPanel copy', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'roomsPanel.postPlaceholder',
      val: 'Im Zimmer posten…',
      enVal: 'Post to room…',
    });
    expectIssue(issues, 'roomsPanel false friend');
    expectIssue(issues, 'not hotel "Zimmer"');
  });

  it('flags hotel-room false friend on tabs.rooms', () => {
    const issues = localeStringQualityIssues({
      locale: 'pl',
      flatKey: 'tabs.rooms',
      val: 'Pomieszczenia',
      enVal: 'Rooms',
    });
    expectIssue(issues, 'roomsPanel false friend');
    expectIssue(issues, 'pomieszczenie');
  });

  it('flags untranslated English readOnlyBadge in roomsPanel', () => {
    const issues = localeStringQualityIssues({
      locale: 'tr',
      flatKey: 'roomsPanel.readOnlyBadge',
      val: ' (read only)',
      enVal: 'Read-only',
    });
    expectIssue(issues, 'translate readOnlyBadge');
  });

  it('flags MT sentence in guestPasswordPlaceholder', () => {
    const issues = localeStringQualityIssues({
      locale: 'ko',
      flatKey: 'roomsPanel.guestPasswordPlaceholder',
      val: '제 이름은 Azlan입니다.',
      enVal: 'hello',
    });
    expectIssue(issues, 'roomsPanel password placeholder looks like an MT sentence');
  });

  it('flags long garbage guestPasswordPlaceholder', () => {
    const issues = localeStringQualityIssues({
      locale: 'ja',
      flatKey: 'roomsPanel.guestPasswordPlaceholder',
      val: 'baka ja nai yo extra words here',
      enVal: 'hello',
    });
    expectIssue(issues, 'roomsPanel password placeholder must be a short literal');
  });

  it('passes valid roomsPanel admin password placeholders', () => {
    expect(
      localeStringQualityIssues({
        locale: 'fr',
        flatKey: 'roomsPanel.adminPasswordPlaceholder',
        val: 'mot de passe',
        enVal: 'password',
      }),
    ).toEqual([]);
  });

  it('passes valid MeshCore Room terminology in roomsPanel', () => {
    expect(
      localeStringQualityIssues({
        locale: 'de',
        flatKey: 'roomsPanel.postPlaceholder',
        val: 'Im Raum posten…',
        enVal: 'Post to room…',
      }),
    ).toEqual([]);
  });

  it('flags hotel-room false friend on nodesPanel.meshcoreTypeRoom', () => {
    const issues = localeStringQualityIssues({
      locale: 'es',
      flatKey: 'nodesPanel.meshcoreTypeRoom',
      val: 'Habitación',
      enVal: 'Room',
    });
    expectIssue(issues, 'roomsPanel false friend');
    expectIssue(issues, 'habitación');
  });

  it('flags nl advertentie for mesh flood advert copy', () => {
    const issues = localeStringQualityIssues({
      locale: 'nl',
      flatKey: 'appPanel.floodAdvertHelp',
      val: 'Verzendt een overstromingsadvertentie wanneer verbonden.',
      enVal: 'Sends a flood advert when connected.',
    });
    expectIssue(issues, 'nl mesh-advert false friend');
  });

  it('flags de Oberfräse on device role router', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'radioPanel.deviceRoles.2.label',
      val: 'Oberfräse',
      enVal: 'Router',
    });
    expectIssue(issues, 'de device role false friend');
    expectIssue(issues, 'Oberfräse');
  });

  it('flags translated guestPasswordPlaceholder instead of literal hello', () => {
    const issues = localeStringQualityIssues({
      locale: 'es',
      flatKey: 'roomsPanel.guestPasswordPlaceholder',
      val: 'hola',
      enVal: 'hello',
    });
    expectIssue(issues, 'guestPasswordPlaceholder must stay literal wire password "hello"');
  });

  it('flags ja hotel 部屋 on roomsPanel.postPlaceholder', () => {
    const issues = localeStringQualityIssues({
      locale: 'ja',
      flatKey: 'roomsPanel.postPlaceholder',
      val: '部屋に投稿…',
      enVal: 'Post to room…',
    });
    expectIssue(issues, 'roomsPanel false friend');
    expectIssue(issues, 'ルーム');
  });

  it('flags legal false friend on mqttProxyToClientEnabled', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'modulePanel.fields.mqttProxyToClientEnabled',
      val: 'Prokura gegenüber dem Kunden',
      enVal: 'Proxy to client',
    });
    expectIssue(issues, 'mqttProxy false friend');
  });

  it('flags English Proxy to client in mqttProxyRequired', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'modulePanel.errors.mqttProxyRequired',
      val: 'Activez « Proxy to client » pour transférer MQTT.',
      enVal:
        'This radio has no Wi-Fi. Enable “Proxy to client” so the app forwards MQTT, or use LoRa “OK to MQTT” instead of device-side MQTT.',
    });
    expectIssue(issues, 'mqttProxyRequired still quotes English');
  });

  it('flags spaced Wi-Fi from auto-translate', () => {
    const issues = localeStringQualityIssues({
      locale: 'id',
      flatKey: 'modulePanel.errors.mqttProxyRequired',
      val: 'Radio ini tidak memiliki Wi - Fi.',
      enVal:
        'This radio has no Wi-Fi. Enable “Proxy to client” so the app forwards MQTT, or use LoRa “OK to MQTT” instead of device-side MQTT.',
    });
    expectIssue(issues, 'Wi-Fi" without spaces');
  });

  it('flags CJK contamination in Italian', () => {
    const issues = localeStringQualityIssues({
      locale: 'it',
      flatKey: 'roomsPanel.syncInterval120',
      val: '每2小时',
      enVal: 'Every 2 hours',
    });
    expectIssue(issues, 'wrong-script contamination');
  });

  it('flags Dutch gaas for English mesh', () => {
    const issues = localeStringQualityIssues({
      locale: 'nl',
      flatKey: 'diagnosticsPanel.noDiagnosticsHealthy',
      val: 'Het gaas ziet er gezond uit!',
      enVal: 'No diagnostics detected. The mesh looks healthy!',
    });
    expectIssue(issues, 'fabric "gaas"');
  });

  it('flags untranslated aclLevelAdmin in roomsPanel', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'roomsPanel.aclLevelAdmin',
      val: 'Admin',
      enVal: 'Admin',
    });
    expectIssue(issues, 'aclLevelAdmin" is still identical to English');
  });

  it('flags stale roomsPanel loginHelp that only says leave empty', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'roomsPanel.loginHelp',
      val: 'Mot de passe invité. Laissez vide pour lecture seule.',
      enVal:
        'Enter the guest password. Default is often "hello". For servers with no guest password, use Continue read-only (Login sends "hello" when the field is empty).',
    });
    expectIssue(issues, 'leave the field empty');
  });

  it('flags translated hello password in roomsPanel loginAllSavedTooltip', () => {
    const issues = localeStringQualityIssues({
      locale: 'tr',
      flatKey: 'roomsPanel.loginAllSavedTooltip',
      val: 'Varsayılan misafir "merhaba"',
      enVal:
        'Queue login for every room in the list (saved password or default guest "hello"; one at a time)',
    });
    expect(issues).toContain('rooms-hello-false-friend:tr');
  });

  it('flags translated hello password in roomsPanel emptyGuestLoginHint', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'roomsPanel.emptyGuestLoginHint',
      val: 'Leeres Feld: sendet "Hallo" wenn leer.',
      enVal:
        'Empty guest field: use Continue read-only for blank-password servers. Login requires a password and sends "hello" when the field is empty.',
    });
    expect(issues).toContain('rooms-hello-false-friend:de');
  });

  it('flags English Continue read-only in Dutch emptyGuestLoginHint', () => {
    const issues = localeStringQualityIssues({
      locale: 'nl',
      flatKey: 'roomsPanel.emptyGuestLoginHint',
      val: 'Gebruik Continue read-only voor servers.',
      enVal:
        'Empty guest field: use Continue read-only for blank-password servers. Login requires a password and sends "hello" when the field is empty.',
    });
    expectIssue(issues, 'still quotes English "Continue read-only"');
  });

  it('flags Polish Nowość on unreadPosts', () => {
    const issues = localeStringQualityIssues({
      locale: 'pl',
      flatKey: 'roomsPanel.unreadPosts',
      val: '{{count}} Nowość',
      enVal: '{{count}} new',
    });
    expectIssue(issues, 'Nowość');
  });

  it('flags untranslated unreadPosts identical to English', () => {
    const issues = localeStringQualityIssues({
      locale: 'ru',
      flatKey: 'roomsPanel.unreadPosts',
      val: '{{count}} new',
      enVal: '{{count}} new',
    });
    expectIssue(issues, 'unreadPosts" is still identical to English');
  });

  it('allows composeLimit.approaching identical numeric ratio', () => {
    expect(
      localeStringQualityIssues({
        locale: 'de',
        flatKey: 'chatPanel.composeLimit.approaching',
        val: '{{count}} / {{limit}}',
        enVal: '{{count}} / {{limit}}',
      }),
    ).toEqual([]);
  });

  it('flags English replyRequiresPacketId phrases in Italian', () => {
    const issues = localeStringQualityIssues({
      locale: 'it',
      flatKey: 'chatPanel.replyRequiresPacketId',
      val: 'Reply richiede il messaggio RF packet id (attendere invio ack o refresh chat).',
      enVal: 'Reply requires the message RF packet id (wait for send ack or refresh chat).',
    });
    expectIssue(issues, 'still starts with English');
    expectIssue(issues, 'send ack');
  });

  it('flags membersHeading garbage zdarma', () => {
    const issues = localeStringQualityIssues({
      locale: 'cs',
      flatKey: 'roomsPanel.membersHeading',
      val: 'zdarma',
      enVal: 'Members',
    });
    expectIssue(issues, 'membersHeading looks like auto-translate garbage');
  });

  it('flags wall-poster false friend on membersRecognizedHeading', () => {
    const issues = localeStringQualityIssues({
      locale: 'pl',
      flatKey: 'roomsPanel.membersRecognizedHeading',
      val: 'Rozpoznane plakaty',
      enVal: 'Recognized posters',
    });
    expectIssue(issues, 'wall-poster wording');
  });

  it('flags truncated membersAclFetchFailed without ACL', () => {
    const issues = localeStringQualityIssues({
      locale: 'tr',
      flatKey: 'roomsPanel.membersAclFetchFailed',
      val: 'Alınamadı',
      enVal: 'Could not fetch ACL',
    });
    expectIssue(issues, 'must mention ACL');
  });

  it('flags TV remote false friend on membersAclEmpty', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'roomsPanel.membersAclEmpty',
      val: 'La télécommande « get acl » est souvent en série.',
      enVal: 'No ACL entries returned. Remote `get acl` is often serial-only on room firmware.',
    });
    expectIssue(issues, 'TV-remote false friend');
  });

  it('flags upgradeAccess vers Access in French', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'roomsPanel.upgradeAccess',
      val: 'Mise à niveau vers Access',
      enVal: 'Upgrade access',
    });
    expectIssue(issues, 'vers Access');
  });

  it('flags untranslated queueButton in Russian', () => {
    const issues = localeStringQualityIssues({
      locale: 'ru',
      flatKey: 'chatPanel.queueButton',
      val: 'Queue',
      enVal: 'Queue',
    });
    expectIssue(issues, 'queueButton" is still identical to English');
  });
});

describe('interpolationPlaceholderIssues', () => {
  it('flags missing {{count}} when CAT left __ PH0 __ residue', () => {
    const issues = interpolationPlaceholderIssues(
      'Logging in to {{count}} rooms (one at a time)…',
      '__ PH0 __ 개의 객실에 로그인 중…',
    );
    expectIssue(issues, 'placeholder names must match English');
    expectIssue(issues, 'count');
  });

  it('passes when placeholder names match English', () => {
    expect(
      interpolationPlaceholderIssues(
        'Logging in to {{count}} rooms (now: {{name}})…',
        '{{count}} 件のルームにログイン中（現在: {{name}}）…',
      ),
    ).toEqual([]);
  });
});

describe('roomsPanel login-all false friends (recent MeshCore Rooms)', () => {
  it('flags French chambres plural on loginAllInProgress', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'roomsPanel.loginAllInProgress',
      val: 'Connexion à {{count}} chambres (une à la fois)…',
      enVal: 'Logging in to {{count}} rooms (one at a time)…',
    });
    expectIssue(issues, 'roomsPanel false friend');
    expectIssue(issues, 'salle');
  });

  it('flags German Zimmern on loginAllInProgress', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'roomsPanel.loginAllInProgress',
      val: 'Anmeldung in {{count}} Zimmern (eins nach dem anderen)…',
      enVal: 'Logging in to {{count}} rooms (one at a time)…',
    });
    expectIssue(issues, 'Raum');
  });

  it('flags Dutch kamer on roomsPanel.favorite', () => {
    const issues = localeStringQualityIssues({
      locale: 'nl',
      flatKey: 'roomsPanel.favorite',
      val: 'Favoriete kamer',
      enVal: 'Favorite room',
    });
    expectIssue(issues, 'ruimte');
  });

  it('flags Korean hotel 객실 on roomsPanel.favorite', () => {
    const issues = localeStringQualityIssues({
      locale: 'ko',
      flatKey: 'roomsPanel.favorite',
      val: '즐겨찾는 객실',
      enVal: 'Favorite room',
    });
    expectIssue(issues, '룸');
  });

  it('flags Russian hotel номер on roomsPanel.favorite', () => {
    const issues = localeStringQualityIssues({
      locale: 'ru',
      flatKey: 'roomsPanel.favorite',
      val: 'Любимый номер',
      enVal: 'Favorite room',
    });
    expectIssue(issues, 'комната');
  });

  it('flags Indonesian kamar on roomsPanel.loginAllSavedAria', () => {
    const issues = localeStringQualityIssues({
      locale: 'id',
      flatKey: 'roomsPanel.loginAllSavedAria',
      val: 'Masuk ke semua server kamar yang disimpan',
      enVal: 'Log in to all saved room servers',
    });
    expectIssue(issues, 'ruangan');
  });

  it('flags Italian hotel camera on roomsPanel.favorite', () => {
    const issues = localeStringQualityIssues({
      locale: 'it',
      flatKey: 'roomsPanel.favorite',
      val: 'Camera preferita',
      enVal: 'Favorite room',
    });
    expectIssue(issues, 'sala');
    expectIssue(issues, 'camera');
  });

  it('flags spaced CAT __ PH 0 __ on roomsPanel.loggingInQueue', () => {
    const issues = localeStringQualityIssues({
      locale: 'ja',
      flatKey: 'roomsPanel.loggingInQueue',
      val: '__ PH 0 __ ROOMS （現在： __ PH 1 __ ）にログインしています…',
      enVal: 'Logging in to {{count}} rooms (now: {{name}})…',
    });
    expectIssue(issues, 'CAT/XLIFF __ PH __ placeholder residue');
  });

  it('passes valid MeshCore Room login-all strings', () => {
    expect(
      localeStringQualityIssues({
        locale: 'de',
        flatKey: 'roomsPanel.loginAllInProgress',
        val: 'Anmeldung in {{count}} Räumen (eins nach dem anderen)…',
        enVal: 'Logging in to {{count}} rooms (one at a time)…',
      }),
    ).toEqual([]);
    expect(
      localeStringQualityIssues({
        locale: 'ja',
        flatKey: 'roomsPanel.loginAllInProgress',
        val: '{{count}} 件のルームにログイン中（1件ずつ）…',
        enVal: 'Logging in to {{count}} rooms (one at a time)…',
      }),
    ).toEqual([]);
  });
});

describe('nodeListPanelConnectionCrossKeyIssues', () => {
  it('flags Turkish present bağlanır on connectedViaRfAndMqttTooltip', () => {
    const issues = nodeListPanelConnectionCrossKeyIssues('tr', {
      'nodeListPanel.mqttConnectedTooltip': 'MQTT aracılığıyla bağlanıldı',
      'nodeListPanel.connectedViaRfAndMqttTooltip': 'RF ve MQTT ile bağlanır',
    });
    expectIssue(issues, 'bağlanır');
  });

  it('flags German Anbindung on connectedViaRfAndMqttTooltip', () => {
    const issues = nodeListPanelConnectionCrossKeyIssues('de', {
      'nodeListPanel.mqttConnectedTooltip': 'Verbunden über MQTT',
      'nodeListPanel.connectedViaRfAndMqttTooltip': 'Anbindung über RF und MQTT',
    });
    expectIssue(issues, 'Anbindung');
  });

  it('flags Polish Połączony on connectedViaRfAndMqttTooltip', () => {
    const issues = nodeListPanelConnectionCrossKeyIssues('pl', {
      'nodeListPanel.mqttConnectedTooltip': 'Połączono poprzez MQTT',
      'nodeListPanel.connectedViaRfAndMqttTooltip': 'Połączony przez RF i MQTT',
    });
    expectIssue(issues, 'Połączony');
  });

  it('passes when connection tooltips are consistent', () => {
    expect(
      nodeListPanelConnectionCrossKeyIssues('de', {
        'nodeListPanel.mqttConnectedTooltip': 'Verbunden über MQTT',
        'nodeListPanel.connectedViaRfAndMqttTooltip': 'Verbunden über RF und MQTT',
      }),
    ).toEqual([]);
  });
});

describe('roomsSavedPasswordsCrossKeyIssues', () => {
  const enFlat = {
    'roomsPanel.legendNotSaved': 'No saved password',
    'roomsPanel.legendSaved': 'Password saved',
    'roomsPanel.stopAutoLogin': 'Stop auto-login',
    'roomsPanel.badgeAutoLogin': 'Auto-login',
  };

  it('flags legendNotSaved identical to legendSaved', () => {
    const issues = roomsSavedPasswordsCrossKeyIssues(
      {
        'roomsPanel.legendNotSaved': 'Wachtwoord opgeslagen',
        'roomsPanel.legendSaved': 'Wachtwoord opgeslagen',
      },
      enFlat,
    );
    expectIssue(issues, 'legendNotSaved must differ');
  });

  it('flags legendNotSaved reusing English legendSaved wording', () => {
    const issues = roomsSavedPasswordsCrossKeyIssues(
      { 'roomsPanel.legendNotSaved': 'Password saved' },
      enFlat,
    );
    expectIssue(issues, 'must not reuse legendSaved');
  });

  it('flags stopAutoLogin duplicating badgeAutoLogin', () => {
    const issues = roomsSavedPasswordsCrossKeyIssues(
      {
        'roomsPanel.stopAutoLogin': 'Acceso automático',
        'roomsPanel.badgeAutoLogin': 'Acceso automático',
      },
      enFlat,
    );
    expectIssue(issues, 'must not duplicate badgeAutoLogin');
  });
});

describe('roomsSidebarMarkerCrossKeyIssues', () => {
  const enFlat = {
    'roomsPanel.statusLoggedInSession': 'Logged in',
    'roomsPanel.legendLoggedIn': 'Logged in',
  };

  it('flags statusLoggedInSession that differs from legendLoggedIn', () => {
    const issues = roomsSidebarMarkerCrossKeyIssues(
      {
        'roomsPanel.statusLoggedInSession': 'Přihlášení',
        'roomsPanel.legendLoggedIn': 'Přihlášen',
      },
      enFlat,
    );
    expectIssue(issues, 'must match legendLoggedIn');
  });
});

describe('roomsPanel saved passwords per-key quality', () => {
  it('flags Polish autofill false friend on savedPasswordsHeading', () => {
    const issues = localeStringQualityIssues({
      locale: 'pl',
      flatKey: 'roomsPanel.savedPasswordsHeading',
      val: 'Automatyczne wypełnianie pola z hasłem',
      enVal: 'Saved passwords',
    });
    expectIssue(issues, 'browser autofill');
  });

  it('flags Czech noun Přihlášení on legendLoggedIn', () => {
    const issues = localeStringQualityIssues({
      locale: 'cs',
      flatKey: 'roomsPanel.legendLoggedIn',
      val: 'Přihlášení',
      enVal: 'Logged in',
    });
    expectIssue(issues, 'Přihlášen');
  });

  it('flags Czech noun Přihlášení on statusLoggedInSession', () => {
    const issues = localeStringQualityIssues({
      locale: 'cs',
      flatKey: 'roomsPanel.statusLoggedInSession',
      val: 'Přihlášení',
      enVal: 'Logged in',
    });
    expectIssue(issues, 'Přihlášen');
  });

  it('flags untranslated Sky half-circle on legendSavedTooltip', () => {
    const issues = localeStringQualityIssues({
      locale: 'nl',
      flatKey: 'roomsPanel.legendSavedTooltip',
      val: 'Sky half-circle — wachtwoord opgeslagen',
      enVal: 'Sky half-circle — password stored; log in to open a session',
    });
    expectIssue(issues, 'Sky half-circle');
  });

  it('flags leave-space false friend on legendLoggedInTooltip', () => {
    const issues = localeStringQualityIssues({
      locale: 'es',
      flatKey: 'roomsPanel.legendLoggedInTooltip',
      val: 'Punto verde (dejar espacio si el servidor está offline)',
      enVal: 'Green dot — active client session (leave room if the server is offline)',
    });
    expectIssue(issues, 'leave space');
  });

  it('flags French pièce on roomsPanel sidebar tooltip', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'roomsPanel.legendNotSavedTooltip',
      val: 'Cercle vide — aucun mot de passe pour cette pièce',
      enVal: 'Empty circle — no password stored for this room',
    });
    expectIssue(issues, 'pièce');
  });

  it('flags Turkish danışan on statusLoggedInSessionTooltip', () => {
    const issues = localeStringQualityIssues({
      locale: 'tr',
      flatKey: 'roomsPanel.statusLoggedInSessionTooltip',
      val: 'Aktif danışan oturumu.',
      enVal:
        'Active client session. It persists until you leave the room or disconnect. If the room server is unreachable, leave and log in again when it is back.',
    });
    expectIssue(issues, 'danışan');
  });

  it('flags statusPasswordSaved missing sky marker parenthetical', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'roomsPanel.statusPasswordSaved',
      val: 'Passwort für diesen Raum gespeichert.',
      enVal: 'Password saved for this room (sky marker when not logged in).',
    });
    expectIssue(issues, 'sky-blue sidebar marker');
  });

  it('flags sidebarLegendTitle without marker wording', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'roomsPanel.sidebarLegendTitle',
      val: 'Raumstatus',
      enVal: 'Room status markers',
    });
    expectIssue(issues, 'sidebar markers');
  });

  it('flags simplified Chinese 登陆 on badgeAutoLogin', () => {
    const issues = localeStringQualityIssues({
      locale: 'zh',
      flatKey: 'roomsPanel.badgeAutoLogin',
      val: '自动登陆',
      enVal: 'Auto-login',
    });
    expectIssue(issues, '登录');
  });

  const enReduceMotion = 'Reduce motion';
  const enReduceMotionDesc =
    'Disables animated icons and decorative effects. Loading spinners and connection status indicators still animate.';

  it('flags Spanish girador de carga on reduceMotionDesc', () => {
    const issues = localeStringQualityIssues({
      locale: 'es',
      flatKey: 'appPanel.reduceMotionDesc',
      val: 'Los giradores de carga siguen animados.',
      enVal: enReduceMotionDesc,
    });
    expectIssue(issues, 'girador de carga');
  });

  it('flags Dutch still active on reduceMotionDesc', () => {
    const issues = localeStringQualityIssues({
      locale: 'nl',
      flatKey: 'appPanel.reduceMotionDesc',
      val: 'Spinners blijft actief.',
      enVal: enReduceMotionDesc,
    });
    expectIssue(issues, 'blijft actief');
  });

  it('flags pt-BR plural imperative on reduceMotion', () => {
    const issues = localeStringQualityIssues({
      locale: 'pt-BR',
      flatKey: 'appPanel.reduceMotion',
      val: 'Reduzam o movimento',
      enVal: enReduceMotion,
    });
    expectIssue(issues, 'Reduzam');
  });

  it('flags Chinese 运动 on reduceMotion', () => {
    const issues = localeStringQualityIssues({
      locale: 'zh',
      flatKey: 'appPanel.reduceMotion',
      val: '减少运动',
      enVal: enReduceMotion,
    });
    expectIssue(issues, '运动');
  });

  it('passes fixed reduceMotionDesc in Spanish', () => {
    expect(
      localeStringQualityIssues({
        locale: 'es',
        flatKey: 'appPanel.reduceMotionDesc',
        val: 'Los indicadores de carga siguen animándose.',
        enVal: enReduceMotionDesc,
      }),
    ).toEqual([]);
  });

  it('flags pl dayYesterday left in English', () => {
    const issues = localeStringQualityIssues({
      locale: 'pl',
      flatKey: 'chatPanel.dayYesterday',
      val: 'Yesterday',
      enVal: 'Yesterday',
    });
    expectIssue(issues, 'dayYesterday must be "Wczoraj"');
  });

  it('flags uk outboxStatusSending bookmark false friend', () => {
    const issues = localeStringQualityIssues({
      locale: 'uk',
      flatKey: 'chatPanel.outboxStatusSending',
      val: 'Заклад,',
      enVal: 'Sending…',
    });
    expectIssue(issues, 'bookmark "Заклад"');
  });

  it('flags zh retryOutbox challenge false friend', () => {
    const issues = localeStringQualityIssues({
      locale: 'zh',
      flatKey: 'chatPanel.retryOutbox',
      val: '再次挑战',
      enVal: 'Retry',
    });
    expectIssue(issues, 'retryOutbox must be "重试"');
  });

  it('passes fixed chatPanel outbox strings', () => {
    expect(
      localeStringQualityIssues({
        locale: 'zh',
        flatKey: 'chatPanel.retryOutbox',
        val: '重试',
        enVal: 'Retry',
      }),
    ).toEqual([]);
  });

  const enMeshcoreDistanceFilterHint =
    'You have {{count}} contacts with GPS on the map. Enable the distance filter in App → Appearance to focus on nearby nodes.';
  const enImportSchemaTooNew =
    'This database file requires a newer Mesh-Client (schema {{dbVersion}}). This build supports schema {{appVersion}} or older. Install the latest release and try again.';

  it('flags untranslated App → Appearance in meshcoreDistanceFilterHint', () => {
    const issues = localeStringQualityIssues({
      locale: 'ja',
      flatKey: 'toasts.meshcoreDistanceFilterHint',
      val: 'App → Appearanceで距離フィルターを有効にしてください。',
      enVal: enMeshcoreDistanceFilterHint,
    });
    expectIssue(issues, 'App → Appearance');
  });

  it('flags App App MT garbage in meshcoreDistanceFilterHint', () => {
    const issues = localeStringQualityIssues({
      locale: 'fr',
      flatKey: 'toasts.meshcoreDistanceFilterHint',
      val: 'Activez le filtre dans App App App → Appearance.',
      enVal: enMeshcoreDistanceFilterHint,
    });
    expectIssue(issues, 'App App');
  });

  it('flags orphan arrow navigation in meshcoreDistanceFilterHint', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'toasts.meshcoreDistanceFilterHint',
      val: 'Aktivieren Sie den Filter in → Erscheinungsbild.',
      enVal: enMeshcoreDistanceFilterHint,
    });
    expectIssue(issues, 'orphan "→" navigation');
  });

  it('flags spaced Mesh-Client in importSchemaTooNew', () => {
    const issues = localeStringQualityIssues({
      locale: 'id',
      flatKey: 'appPanel.importSchemaTooNew',
      val: 'File ini memerlukan Mesh - Client yang lebih baru (skema {{dbVersion}}).',
      enVal: enImportSchemaTooNew,
    });
    expectIssue(issues, 'Mesh-Client');
  });

  it('passes fixed meshcoreDistanceFilterHint in Japanese', () => {
    expect(
      localeStringQualityIssues({
        locale: 'ja',
        flatKey: 'toasts.meshcoreDistanceFilterHint',
        val: '地図上にGPS付きの連絡先が{{count}}件あります。アプリ → 外観で距離フィルターを有効にしてください。',
        enVal: enMeshcoreDistanceFilterHint,
      }),
    ).toEqual([]);
  });
});

describe('protectedBrandIssues', () => {
  it('flags missing Meshtastic brand when English has one', () => {
    const issues = protectedBrandIssues(
      'Connect a local Meshtastic radio to use remote administration.',
      'Подключите местное мештастическое радио.',
    );
    expectIssue(issues, 'Brand "Meshtastic" missing');
  });

  it('passes when Meshtastic brand is preserved', () => {
    expect(
      protectedBrandIssues(
        'Connect a local Meshtastic radio to use remote administration.',
        'Подключите локальное Meshtastic-радио для удалённого администрирования.',
      ),
    ).toEqual([]);
  });

  it('flags missing GPIO brand when English has one', () => {
    const issues = protectedBrandIssues('GPIO pin — encoder A', 'Pin de codificador A');
    expectIssue(issues, 'Brand "GPIO" missing');
  });
});
