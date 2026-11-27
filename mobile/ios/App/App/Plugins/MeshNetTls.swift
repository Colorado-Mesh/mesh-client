import CryptoKit
import Foundation
import Network
import Security

/// Outcome of our own certificate evaluation, so `tcpConnect` can report `authorized` /
/// `authorizationError` (Node `TLSSocket` fields) and a Node-style reason when we refuse a peer.
final class MeshTlsVerification {
    var authorized = false
    var error: String?
}

/// TLS for `MeshNet` sockets (Network.framework). Certificate checks run in our own verify block so
/// the plugin can honour Node's `ca` (replaces the system roots), `rejectUnauthorized: false`
/// (evaluate, report, accept) and give Node error codes (`CERT_HAS_EXPIRED`, …).
enum MeshTls {
    /// Node-style message for a TLS `OSStatus` reported by Network.framework (SecureTransport codes).
    static func message(forStatus status: OSStatus) -> String {
        switch status {
        case -9806: // errSSLClosedAbort
            return "ECONNRESET socket hang up (TLS connection closed by peer)"
        case -9814: // errSSLCertExpired
            return "CERT_HAS_EXPIRED certificate has expired"
        case -9812, -9813: // errSSLUnknownRootCert, errSSLNoRootCert
            return "SELF_SIGNED_CERT_IN_CHAIN self-signed certificate in certificate chain"
        case -9843: // errSSLHostNameMismatch
            return "ERR_TLS_CERT_ALTNAME_INVALID Hostname/IP does not match certificate's altnames"
        case -9807, -9808: // errSSLXCertChainInvalid, errSSLBadCert
            return "UNABLE_TO_VERIFY_LEAF_SIGNATURE unable to verify the first certificate"
        case -9825, -9829: // errSSLPeerBadCert, errSSLPeerCertUnknown
            return "EPROTO the peer rejected our certificate (OSStatus \(status))"
        default:
            return "EPROTO TLS handshake failed (OSStatus \(status))"
        }
    }

    static func isSelfSigned(_ certificate: SecCertificate) -> Bool {
        guard let subject = SecCertificateCopyNormalizedSubjectSequence(certificate),
              let issuer = SecCertificateCopyNormalizedIssuerSequence(certificate) else { return false }
        return (subject as Data) == (issuer as Data)
    }

    /// Node (OpenSSL) verification error for a failed `SecTrust` evaluation.
    static func trustFailure(_ trust: SecTrust, _ error: CFError?) -> String {
        switch error.map({ CFErrorGetCode($0) }) ?? 0 {
        case -67818: // errSecCertificateExpired
            return "CERT_HAS_EXPIRED certificate has expired"
        case -67819: // errSecCertificateNotValidYet
            return "CERT_NOT_YET_VALID certificate is not yet valid"
        case -67602: // errSecHostNameMismatch
            return "ERR_TLS_CERT_ALTNAME_INVALID Hostname/IP does not match certificate's altnames"
        default:
            break
        }
        let chain = (SecTrustCopyCertificateChain(trust) as? [SecCertificate]) ?? []
        if chain.count <= 1 {
            if let leaf = chain.first, isSelfSigned(leaf) {
                return "DEPTH_ZERO_SELF_SIGNED_CERT self-signed certificate"
            }
            return "UNABLE_TO_VERIFY_LEAF_SIGNATURE unable to verify the first certificate"
        }
        if let root = chain.last, isSelfSigned(root) {
            return "SELF_SIGNED_CERT_IN_CHAIN self-signed certificate in certificate chain"
        }
        return "UNABLE_TO_GET_ISSUER_CERT_LOCALLY unable to get local issuer certificate"
    }

    /// Replaces Network.framework's default evaluation with ours: SSL policy (with the host name
    /// when verifying a server), optional anchors (Node `ca` semantics: only these roots), and
    /// `rejectUnauthorized` deciding whether a failed evaluation aborts the handshake.
    static func installVerifyBlock(
        _ options: sec_protocol_options_t,
        queue: DispatchQueue,
        verifyingServer: Bool,
        hostName: String?,
        anchors: [SecCertificate],
        rejectUnauthorized: Bool,
        record: MeshTlsVerification?
    ) {
        sec_protocol_options_set_verify_block(options, { _, secTrust, complete in
            let trust = sec_trust_copy_ref(secTrust).takeRetainedValue()
            let policyName: CFString? = verifyingServer ? hostName.map { $0 as CFString } : nil
            let policy = SecPolicyCreateSSL(verifyingServer, policyName)
            SecTrustSetPolicies(trust, policy)
            if !anchors.isEmpty {
                SecTrustSetAnchorCertificates(trust, anchors as CFArray)
                SecTrustSetAnchorCertificatesOnly(trust, true)
            }
            SecTrustEvaluateAsyncWithError(trust, queue) { evaluated, ok, error in
                record?.authorized = ok
                record?.error = ok ? nil : MeshTls.trustFailure(evaluated, error)
                complete(ok || !rejectUnauthorized)
            }
        }, queue)
    }

    static func clientOptions(
        host: String,
        servername: String?,
        rejectUnauthorized: Bool,
        anchors: [SecCertificate],
        identity: SecIdentity?,
        alpn: [String],
        queue: DispatchQueue,
        record: MeshTlsVerification
    ) -> NWProtocolTLS.Options {
        let tls = NWProtocolTLS.Options()
        let options = tls.securityProtocolOptions
        sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
        let name = (servername?.isEmpty == false ? servername : nil) ?? host
        // SNI only for host names (Node never sends an IP literal as SNI); the verify block still
        // checks IP SANs through the SSL policy.
        if !MeshAddress.isIPLiteral(name) {
            sec_protocol_options_set_tls_server_name(options, name)
        }
        for proto in alpn where !proto.isEmpty {
            sec_protocol_options_add_tls_application_protocol(options, proto)
        }
        if let identity, let secIdentity = sec_identity_create(identity) {
            sec_protocol_options_set_local_identity(options, secIdentity)
        }
        installVerifyBlock(
            options,
            queue: queue,
            verifyingServer: true,
            hostName: name,
            anchors: anchors,
            rejectUnauthorized: rejectUnauthorized,
            record: record
        )
        return tls
    }

    /// Server-side TLS (`tcpListen` with `tls`). `requestCert` + `rejectUnauthorized` requires a
    /// client certificate that chains to `ca`; `requestCert` alone is not supported by
    /// Network.framework (it cannot request without requiring) and is treated as "do not request".
    static func serverOptions(
        identity: SecIdentity,
        requestCert: Bool,
        rejectUnauthorized: Bool,
        anchors: [SecCertificate],
        queue: DispatchQueue
    ) throws -> NWProtocolTLS.Options {
        guard let secIdentity = sec_identity_create(identity) else {
            throw MeshNetError("ERR_OSSL_X509_KEY_VALUES_MISMATCH could not use the server certificate")
        }
        let tls = NWProtocolTLS.Options()
        let options = tls.securityProtocolOptions
        sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
        sec_protocol_options_set_local_identity(options, secIdentity)
        if requestCert && rejectUnauthorized {
            sec_protocol_options_set_peer_authentication_required(options, true)
            installVerifyBlock(
                options,
                queue: queue,
                verifyingServer: false,
                hostName: nil,
                anchors: anchors,
                rejectUnauthorized: true,
                record: nil
            )
        }
        return tls
    }
}

// MARK: - Credentials (PEM / DER / PKCS#12)

enum MeshTlsCredentials {
    struct PemBlock {
        let label: String
        let der: Data
        let encrypted: Bool
    }

    static func decode(_ base64: String, what: String) throws -> Data {
        guard let data = Data(base64Encoded: base64) else {
            throw MeshNetError("ERR_INVALID_ARG_VALUE \(what) is not valid base64")
        }
        return data
    }

    static func pemBlocks(_ text: String) throws -> [PemBlock] {
        var blocks: [PemBlock] = []
        var label: String?
        var body = ""
        var encrypted = false
        let lines = text.split(omittingEmptySubsequences: true, whereSeparator: { $0 == "\n" || $0 == "\r" })
        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("-----BEGIN "), line.hasSuffix("-----") {
                label = String(line.dropFirst("-----BEGIN ".count).dropLast("-----".count))
                body = ""
                encrypted = false
            } else if line.hasPrefix("-----END ") {
                if let current = label {
                    guard let der = Data(base64Encoded: body) else {
                        throw MeshNetError("ERR_OSSL_PEM_BAD_BASE64_DECODE invalid PEM block \(current)")
                    }
                    blocks.append(PemBlock(label: current, der: der, encrypted: encrypted))
                }
                label = nil
            } else if label != nil {
                if line.contains(":") {
                    // RFC 1421 headers (Proc-Type / DEK-Info) only appear on encrypted keys.
                    if line.hasPrefix("Proc-Type:") && line.contains("ENCRYPTED") { encrypted = true }
                    continue
                }
                body += line
            }
        }
        return blocks
    }

    private static func pemText(_ bytes: Data) -> String? {
        guard let text = String(data: bytes, encoding: .utf8), text.contains("-----BEGIN ") else { return nil }
        return text
    }

    /// Certificates from file bytes: PEM bundle (every CERTIFICATE block) or one DER certificate.
    static func certificates(fromFile bytes: Data) throws -> [SecCertificate] {
        if let text = pemText(bytes) {
            return try pemBlocks(text).filter { $0.label == "CERTIFICATE" }.map { block -> SecCertificate in
                guard let certificate = SecCertificateCreateWithData(nil, block.der as CFData) else {
                    throw MeshNetError("ERR_OSSL_PEM_BAD_CERTIFICATE could not parse a PEM certificate")
                }
                return certificate
            }
        }
        guard let certificate = SecCertificateCreateWithData(nil, bytes as CFData) else {
            throw MeshNetError("ERR_OSSL_PEM_NO_START_LINE no certificate found")
        }
        return [certificate]
    }

    /// Node `ca`: `string | string[]`, each one a PEM bundle or a DER certificate.
    static func certificates(fromBase64 values: [String]) throws -> [SecCertificate] {
        try values.flatMap { try certificates(fromFile: decode($0, what: "ca")) }
    }

    // MARK: Private keys

    private static let rsaOID = Data([0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01])
    private static let ecOID = Data([0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01])

    static func privateKey(fromFile bytes: Data) throws -> SecKey {
        if let text = pemText(bytes) {
            for block in try pemBlocks(text) {
                if block.encrypted || block.label == "ENCRYPTED PRIVATE KEY" {
                    throw MeshNetError(
                        "ERR_OSSL_BAD_DECRYPT encrypted private keys are not supported on iOS; "
                            + "import the key unencrypted or as a PKCS#12 bundle"
                    )
                }
                switch block.label {
                case "RSA PRIVATE KEY": return try rsaKey(pkcs1: block.der)
                case "EC PRIVATE KEY": return try ecKey(der: block.der)
                case "PRIVATE KEY": return try pkcs8Key(block.der)
                default: continue
                }
            }
            throw MeshNetError("ERR_OSSL_PEM_NO_START_LINE no private key found")
        }
        if let key = try? pkcs8Key(bytes) { return key }
        if let key = try? rsaKey(pkcs1: bytes) { return key }
        return try ecKey(der: bytes)
    }

    private static func pkcs8Key(_ der: Data) throws -> SecKey {
        let invalid = MeshNetError("ERR_OSSL_ASN1_WRONG_TAG invalid PKCS#8 private key")
        let top = try MeshDER.children(der)
        guard top.count == 1, top[0].tag == 0x30 else { throw invalid }
        let fields = try MeshDER.children(top[0].content)
        guard fields.count >= 3, fields[1].tag == 0x30, fields[2].tag == 0x04 else { throw invalid }
        let algorithm = try MeshDER.children(fields[1].content)
        guard let oid = algorithm.first, oid.tag == 0x06 else { throw invalid }
        if oid.content == rsaOID { return try rsaKey(pkcs1: fields[2].content) }
        if oid.content == ecOID { return try ecKey(der: der) }
        throw MeshNetError(
            "ERR_OSSL_UNSUPPORTED unsupported private key type (iOS TLS accepts RSA and EC P-256/P-384/P-521 keys)"
        )
    }

    private static func createKey(_ data: Data, type: CFString, bits: Int?) throws -> SecKey {
        var attributes: [String: Any] = [
            kSecAttrKeyType as String: type,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        ]
        if let bits { attributes[kSecAttrKeySizeInBits as String] = bits }
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(data as CFData, attributes as CFDictionary, &error) else {
            let detail = error.map { ($0.takeRetainedValue() as Error).localizedDescription } ?? "invalid key"
            throw MeshNetError("ERR_OSSL_UNSUPPORTED could not read the private key: \(detail)")
        }
        return key
    }

    private static func rsaKey(pkcs1: Data) throws -> SecKey {
        try createKey(pkcs1, type: kSecAttrKeyTypeRSA, bits: nil)
    }

    /// SEC1 or PKCS#8 EC key → ANSI X9.63 (04‖X‖Y‖K), the format `SecKeyCreateWithData` takes.
    private static func ecKey(der: Data) throws -> SecKey {
        if let key = try? P256.Signing.PrivateKey(derRepresentation: der) {
            return try createKey(key.x963Representation, type: kSecAttrKeyTypeECSECPrimeRandom, bits: 256)
        }
        if let key = try? P384.Signing.PrivateKey(derRepresentation: der) {
            return try createKey(key.x963Representation, type: kSecAttrKeyTypeECSECPrimeRandom, bits: 384)
        }
        if let key = try? P521.Signing.PrivateKey(derRepresentation: der) {
            return try createKey(key.x963Representation, type: kSecAttrKeyTypeECSECPrimeRandom, bits: 521)
        }
        throw MeshNetError("ERR_OSSL_UNSUPPORTED unsupported EC private key (P-256, P-384 and P-521 only)")
    }

    // MARK: Identities

    static func identity(pkcs12 data: Data, passphrase: String?) throws -> SecIdentity {
        var items: CFArray?
        let options = [kSecImportExportPassphrase as String: passphrase ?? ""] as CFDictionary
        let status = SecPKCS12Import(data as CFData, options, &items)
        if status == errSecAuthFailed {
            throw MeshNetError("ERR_CRYPTO_INVALID_PASSPHRASE mac verify failure (wrong PKCS#12 password)")
        }
        guard status == errSecSuccess,
              let list = items as? [[String: Any]],
              let raw = list.first?[kSecImportItemIdentity as String] else {
            throw MeshNetError("ERR_OSSL_PKCS12 could not import the PKCS#12 bundle (OSStatus \(status))")
        }
        let object = raw as AnyObject
        guard CFGetTypeID(object) == SecIdentityGetTypeID() else {
            throw MeshNetError("ERR_OSSL_PKCS12 the PKCS#12 bundle has no identity")
        }
        return object as! SecIdentity // swiftlint:disable:this force_cast
    }

    /// Identities built from PEM/DER cert + key, keyed by certificate DER. Only touched on the
    /// MeshNet queue.
    private static var identityCache: [Data: SecIdentity] = [:]

    /// iOS cannot pair a raw `SecKey` and `SecCertificate` into a `SecIdentity` in memory: both go
    /// into the app's Keychain (this device only) and the identity is read back from there.
    static func identity(certificateFile: Data, keyFile: Data) throws -> SecIdentity {
        guard let leaf = try certificates(fromFile: certificateFile).first else {
            throw MeshNetError("ERR_OSSL_PEM_NO_START_LINE no certificate found")
        }
        let certificateDER = SecCertificateCopyData(leaf) as Data
        if let cached = identityCache[certificateDER] { return cached }
        let key = try privateKey(fromFile: keyFile)
        let digest = SHA256.hash(data: certificateDER).prefix(12).map { String(format: "%02x", $0) }.joined()
        let label = "org.coloradomesh.meshclient.tls.\(digest)"

        let keyAttributes: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecValueRef as String: key,
            kSecAttrLabel as String: label,
            kSecAttrApplicationTag as String: Data(label.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let keyStatus = SecItemAdd(keyAttributes as CFDictionary, nil)
        guard keyStatus == errSecSuccess || keyStatus == errSecDuplicateItem else {
            throw MeshNetError("ERR_TLS_CERT_KEYCHAIN could not store the client key in the Keychain (OSStatus \(keyStatus))")
        }
        let certificateAttributes: [String: Any] = [
            kSecClass as String: kSecClassCertificate,
            kSecValueRef as String: leaf,
            kSecAttrLabel as String: label,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let certificateStatus = SecItemAdd(certificateAttributes as CFDictionary, nil)
        guard certificateStatus == errSecSuccess || certificateStatus == errSecDuplicateItem else {
            throw MeshNetError(
                "ERR_TLS_CERT_KEYCHAIN could not store the certificate in the Keychain (OSStatus \(certificateStatus))"
            )
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassIdentity,
            kSecReturnRef as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let candidates = result as? [AnyObject] else {
            throw MeshNetError("ERR_TLS_CERT_KEYCHAIN could not read the identity back (OSStatus \(status))")
        }
        for candidate in candidates where CFGetTypeID(candidate) == SecIdentityGetTypeID() {
            let identity = candidate as! SecIdentity // swiftlint:disable:this force_cast
            var certificate: SecCertificate?
            guard SecIdentityCopyCertificate(identity, &certificate) == errSecSuccess,
                  let certificate,
                  (SecCertificateCopyData(certificate) as Data) == certificateDER else { continue }
            identityCache[certificateDER] = identity
            return identity
        }
        throw MeshNetError("ERR_OSSL_X509_KEY_VALUES_MISMATCH the private key does not match the certificate")
    }

    /// Identity from the `pfxB64`/`passphrase` or `certB64`/`keyB64` socket options (a combined
    /// PEM with both blocks in `certB64` also works). Returns nil when none were given.
    static func identity(pfxB64: String?, passphrase: String?, certB64: String?, keyB64: String?) throws -> SecIdentity? {
        if let pfxB64 {
            return try identity(pkcs12: decode(pfxB64, what: "pfx"), passphrase: passphrase)
        }
        guard let certB64 else { return nil }
        let certificate = try decode(certB64, what: "cert")
        let key = try keyB64.map { try decode($0, what: "key") } ?? certificate
        return try identity(certificateFile: certificate, keyFile: key)
    }
}

/// Minimal DER reader (enough to unwrap PKCS#8).
enum MeshDER {
    struct Node {
        let tag: UInt8
        let content: Data
    }

    static func children(_ data: Data) throws -> [Node] {
        let invalid = MeshNetError("ERR_OSSL_ASN1_TOO_LONG malformed DER")
        let bytes = [UInt8](data)
        var nodes: [Node] = []
        var index = 0
        while index < bytes.count {
            let tag = bytes[index]
            index += 1
            guard index < bytes.count else { throw invalid }
            var length = Int(bytes[index])
            index += 1
            if length & 0x80 != 0 {
                let count = length & 0x7F
                guard count > 0, count <= 4, index + count <= bytes.count else { throw invalid }
                length = 0
                for _ in 0 ..< count {
                    length = (length << 8) | Int(bytes[index])
                    index += 1
                }
            }
            guard length >= 0, index + length <= bytes.count else { throw invalid }
            nodes.append(Node(tag: tag, content: Data(bytes[index ..< (index + length)])))
            index += length
        }
        return nodes
    }
}
