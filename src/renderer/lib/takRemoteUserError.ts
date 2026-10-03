/**
 * User-facing TAK remote relay errors are thrown in main as English sentences.
 * Map those sentences (and the few parameterized forms) to i18n keys at display time.
 * Wire text that is not one of these authored sentences is shown unchanged.
 */

export interface TakRemoteUserErrorSpec {
  /** `takServerPanel.remoteErrors.*` */
  key: string;
  /** English locale value. May sentence-case a lowercase wire fragment. */
  en: string;
  /** Exact main-process sentences. `{{name}}`, `{{reason}}`, and `{{max}}` are captures. */
  wire: readonly string[];
}

export const TAK_REMOTE_USER_ERROR_SPECS: readonly TakRemoteUserErrorSpec[] = [
  {
    key: 'takServerPanel.remoteErrors.connRefused',
    en: 'Connection refused; check the server address and port',
    wire: ['Connection refused; check the server address and port'],
  },
  {
    key: 'takServerPanel.remoteErrors.hostNotFound',
    en: 'Server address not found',
    wire: ['Server address not found'],
  },
  {
    key: 'takServerPanel.remoteErrors.dnsFailed',
    en: 'Server address could not be resolved',
    wire: ['Server address could not be resolved'],
  },
  {
    key: 'takServerPanel.remoteErrors.timedOut',
    en: 'Connection timed out',
    wire: ['Connection timed out', 'connection timed out'],
  },
  {
    key: 'takServerPanel.remoteErrors.hostUnreachable',
    en: 'Server unreachable',
    wire: ['Server unreachable'],
  },
  {
    key: 'takServerPanel.remoteErrors.netUnreachable',
    en: 'Network unreachable',
    wire: ['Network unreachable'],
  },
  {
    key: 'takServerPanel.remoteErrors.connReset',
    en: 'Connection reset by the server',
    wire: ['Connection reset by the server'],
  },
  {
    key: 'takServerPanel.remoteErrors.untrustedCert',
    en: "The server certificate is not trusted; import the server's CA",
    wire: ["The server certificate is not trusted; import the server's CA"],
  },
  {
    key: 'takServerPanel.remoteErrors.certExpired',
    en: 'The server certificate has expired',
    wire: ['The server certificate has expired'],
  },
  {
    key: 'takServerPanel.remoteErrors.notTls',
    en: 'The server is not using TLS; turn off TLS to connect over plain TCP',
    wire: ['The server is not using TLS; turn off TLS to connect over plain TCP'],
  },
  {
    key: 'takServerPanel.remoteErrors.nameMismatch',
    en: 'The server certificate is for a different name; allow a name mismatch if this TAK server is set up that way',
    wire: [
      'The server certificate is for a different name; allow a name mismatch if this TAK server is set up that way',
    ],
  },
  {
    key: 'takServerPanel.remoteErrors.clientCertRequired',
    en: 'The server requires a client certificate; import one',
    wire: ['The server requires a client certificate; import one'],
  },
  {
    key: 'takServerPanel.remoteErrors.clientCertRejected',
    en: 'The server rejected the client certificate ({{reason}})',
    wire: ['The server rejected the client certificate ({{reason}})'],
  },
  {
    key: 'takServerPanel.remoteErrors.closedAfterHandshake',
    en: 'The server closed the connection right after the TLS handshake; it may not accept the client certificate',
    wire: [
      'The server closed the connection right after the TLS handshake; it may not accept the client certificate',
    ],
  },
  {
    key: 'takServerPanel.remoteErrors.connectionClosed',
    en: 'Connection closed',
    wire: ['connection closed'],
  },
  {
    key: 'takServerPanel.remoteErrors.keyDecryptFailed',
    en: 'Could not decrypt the private key; check the password',
    wire: ['Could not decrypt the private key; check the password'],
  },
  {
    key: 'takServerPanel.remoteErrors.keyEncrypted',
    en: 'The private key is encrypted; enter its password and import again',
    wire: ['The private key is encrypted; enter its password and import again'],
  },
  {
    key: 'takServerPanel.remoteErrors.pkcs12WrongPassword',
    en: '{{name}}: Wrong password for the PKCS#12 file',
    wire: ['{{name}}: Wrong password for the PKCS#12 file'],
  },
  {
    key: 'takServerPanel.remoteErrors.notACredential',
    en: '{{name}}: Not a PEM, DER certificate, or PKCS#12 file',
    wire: ['{{name}}: Not a PEM, DER certificate, or PKCS#12 file'],
  },
  {
    key: 'takServerPanel.remoteErrors.oneKey',
    en: 'Import one client private key at a time',
    wire: ['Import one client private key at a time'],
  },
  {
    key: 'takServerPanel.remoteErrors.noCerts',
    en: 'No certificates found in the selected files',
    wire: ['No certificates found in the selected files'],
  },
  {
    key: 'takServerPanel.remoteErrors.keyMismatch',
    en: 'The private key does not match any certificate in the selected files',
    wire: ['The private key does not match any certificate in the selected files'],
  },
  {
    key: 'takServerPanel.remoteErrors.savedKeyDecryptFailed',
    en: 'The saved client key could not be decrypted; import the client certificate again',
    wire: ['The saved client key could not be decrypted; import the client certificate again'],
  },
  {
    key: 'takServerPanel.remoteErrors.notAFile',
    en: '{{name}} is not a regular file',
    wire: ['{{name}} is not a regular file'],
  },
  {
    key: 'takServerPanel.remoteErrors.fileTooLarge',
    en: '{{name}} is too large to be a certificate file',
    wire: ['{{name}} is too large to be a certificate file'],
  },
  {
    key: 'takServerPanel.remoteErrors.tooManyFiles',
    en: 'Select at most {{max}} certificate files',
    wire: ['Select at most {{max}} certificate files'],
  },
  {
    key: 'takServerPanel.remoteErrors.chooserOpen',
    en: 'Certificate chooser is already open',
    wire: ['Certificate chooser is already open'],
  },
  {
    key: 'takServerPanel.remoteErrors.enrollBadLogin',
    en: 'The server rejected the username or password',
    wire: ['The server rejected the username or password'],
  },
  {
    key: 'takServerPanel.remoteErrors.enrollNotOffered',
    en: 'This server does not offer certificate enrollment on this port',
    wire: ['This server does not offer certificate enrollment on this port'],
  },
  {
    key: 'takServerPanel.remoteErrors.enrollHttpError',
    en: 'Certificate enrollment failed (HTTP {{status}})',
    wire: ['Certificate enrollment failed (HTTP {{status}})'],
  },
  {
    key: 'takServerPanel.remoteErrors.enrollNoCert',
    en: 'The enrollment response has no certificate',
    wire: ['The enrollment response has no certificate'],
  },
  {
    key: 'takServerPanel.remoteErrors.enrollTooLarge',
    en: 'The enrollment response is too large',
    wire: ['The enrollment response is too large'],
  },
  {
    key: 'takServerPanel.remoteErrors.enrollKeyMismatch',
    en: 'The server returned a certificate for a different key',
    wire: ['The server returned a certificate for a different key'],
  },
  {
    key: 'takServerPanel.remoteErrors.enrollBusy',
    en: 'Wait for the current certificate import to finish',
    wire: ['Wait for the current certificate import to finish'],
  },
  {
    key: 'takServerPanel.remoteErrors.importInProgress',
    en: 'Wait for the certificate import to finish before removing certificates',
    wire: ['Wait for the certificate import to finish before removing certificates'],
  },
];

interface CompiledWire {
  key: string;
  /** Text before the single placeholder, or the whole sentence when there is none. */
  prefix: string;
  /** Text after the placeholder. Empty when the template has no placeholder. */
  suffix: string;
  name?: string;
}

/** Each authored sentence has at most one `{{placeholder}}`. */
function compileTemplate(template: string): Omit<CompiledWire, 'key'> {
  const placeholder = /\{\{(\w+)\}\}/.exec(template);
  const name = placeholder?.[1];
  if (!placeholder || !name) return { prefix: template, suffix: '' };
  return {
    prefix: template.slice(0, placeholder.index),
    suffix: template.slice(placeholder.index + placeholder[0].length),
    name,
  };
}

const COMPILED: CompiledWire[] = TAK_REMOTE_USER_ERROR_SPECS.flatMap((spec) =>
  spec.wire.map((template) => ({ key: spec.key, ...compileTemplate(template) })),
);

export interface TakRemoteUserErrorMatch {
  key: string;
  vars: Record<string, string>;
}

function matchCompiled(wire: CompiledWire, message: string): Record<string, string> | null {
  if (!wire.name) return wire.prefix === message ? {} : null;
  if (!message.startsWith(wire.prefix) || !message.endsWith(wire.suffix)) return null;
  const value = message.slice(wire.prefix.length, message.length - wire.suffix.length);
  if (value.length === 0) return null;
  return { [wire.name]: value };
}

/** Match a main-process remote TAK error, or null when it is not an authored sentence. */
export function matchTakRemoteUserError(message: string): TakRemoteUserErrorMatch | null {
  const trimmed = message.trim();
  for (const wire of COMPILED) {
    const vars = matchCompiled(wire, trimmed);
    if (vars) return { key: wire.key, vars };
  }
  return null;
}

/** Locale text for a remote TAK error. Unknown messages (OS or OpenSSL leftovers) pass through. */
export function localizeTakRemoteUserError(
  message: string,
  t: (key: string, options?: Record<string, string>) => string,
): string {
  const match = matchTakRemoteUserError(message);
  if (!match) return message;
  const translated = t(match.key, match.vars);
  return translated === match.key ? message : translated;
}

/** Literal pieces of a wire template that must still exist in main. */
export function takRemoteWireSnippets(template: string): string[] {
  return template
    .split(/\{\{\w+\}\}/)
    .map((part) => part.replace(/^:\s*/, '').trim())
    .filter((part) => part.length >= 12);
}
