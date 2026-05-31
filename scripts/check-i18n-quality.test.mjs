// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { localeStringQualityIssues, protectedBrandIssues } from './check-i18n-quality.mjs';

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

  it('passes valid roomsPanel password placeholders', () => {
    expect(
      localeStringQualityIssues({
        locale: 'de',
        flatKey: 'roomsPanel.guestPasswordPlaceholder',
        val: 'hallo',
        enVal: 'hello',
      }),
    ).toEqual([]);
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

  it('flags translated hello password in roomsPanel emptyGuestLoginHint', () => {
    const issues = localeStringQualityIssues({
      locale: 'de',
      flatKey: 'roomsPanel.emptyGuestLoginHint',
      val: 'Leeres Feld: sendet "Hallo" wenn leer.',
      enVal:
        'Empty guest field: use Continue read-only for blank-password servers. Login requires a password and sends "hello" when the field is empty.',
    });
    expectIssue(issues, 'wire password "hello"');
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
});
