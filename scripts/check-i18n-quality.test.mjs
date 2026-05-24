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
