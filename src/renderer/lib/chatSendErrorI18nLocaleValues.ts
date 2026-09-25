/** Reverse-map persisted i18n.t() outbox text from every locale bundle. */
export const CHAT_SEND_ERROR_LOCALE_TEXT_TO_KEY: Record<string, string> = {
  'A mensagem foi enviada, mas a remoção da caixa de saída falhou. Cancele a cópia na fila.':
    'chatPanel.outboxRemoveFailed',
  'A mensagem para reagir não foi encontrada.': 'chatPanel.sendErrors.reactionTargetMissing',
  'A resposta requer o ID do pacote RF da mensagem (aguarde a confirmação de envio ou atualize o chat).':
    'chatPanel.replyRequiresPacketId',
  'A sessão da sala expirou — inicie sessão novamente para publicar.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Antwoorden vereist het RF-pakket-ID van het bericht (wacht op verzendbevestiging of ververs de chat).':
    'chatPanel.replyRequiresPacketId',
  'Antwort erfordert die RF-Paket-ID der Nachricht (warten Sie auf Sendebestätigung oder Chat-Aktualisierung).':
    'chatPanel.replyRequiresPacketId',
  "Aucun mot de passe de chambre enregistré. Connectez-vous d'abord à la pièce.":
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Bağlı değil — radyoyu bağlayın ve tekrar deneyin.': 'chatPanel.sendErrors.notConnected',
  'Balasan memerlukan ID paket RF pesan (tunggu konfirmasi kirim atau segarkan obrolan).':
    'chatPanel.replyRequiresPacketId',
  'Bericht is verzonden, maar het verwijderen uit het postvak uit is mislukt. Annuleer de kopie in de wachtrij.':
    'chatPanel.outboxRemoveFailed',
  'Berichttekst is vereist': 'chatPanel.sendErrors.emptyPayload',
  'Bluetooth belum siap. Sambungkan kembali dan coba lagi.': 'chatPanel.sendErrors.bleUnavailable',
  'Bluetooth hazır değil. Yeniden bağlanın ve tekrar deneyin.':
    'chatPanel.sendErrors.bleUnavailable',
  'Bluetooth is niet gereed. Maak opnieuw verbinding en probeer het opnieuw.':
    'chatPanel.sendErrors.bleUnavailable',
  'Bluetooth is not ready. Reconnect and try again.': 'chatPanel.sendErrors.bleUnavailable',
  'Bluetooth ist nicht bereit. Verbinden Sie sich erneut und versuchen Sie es erneut.':
    'chatPanel.sendErrors.bleUnavailable',
  "Bluetooth n'est pas prêt. Reconnectez-vous et réessayez.": 'chatPanel.sendErrors.bleUnavailable',
  'Bluetooth není připraven. Připojte se znovu a zkuste to znovu.':
    'chatPanel.sendErrors.bleUnavailable',
  'Bluetooth nie jest gotowy. Połącz się ponownie i spróbuj ponownie.':
    'chatPanel.sendErrors.bleUnavailable',
  'Bluetooth не готов. Подключитесь заново и повторите попытку.':
    'chatPanel.sendErrors.bleUnavailable',
  'Bluetooth не готовий. Повторно підключіться та повторіть спробу.':
    'chatPanel.sendErrors.bleUnavailable',
  'Bluetoothの準備ができていません。再接続してもう一度お試しください。':
    'chatPanel.sendErrors.bleUnavailable',
  'Brak połączenia z urządzeniem': 'meshcore.errors.notConnected',
  'Brak zapisanego hasła do pokoju. Najpierw zaloguj się do pokoju.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Bu doğrudan mesaj gönderilemiyor — alıcı şifreleme anahtarı eksik. Kişi senkronizasyonunu bekleyin veya yeniden bağlanın.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Bu sıraya alınmış mesaj, artık gönderilmeyen çok parçalı MeshCore bölmeyi kullandı. İptal edin ve daha kısa bir mesaj (veya birkaç ayrı kısa mesaj) gönderin.':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Bu tepki geçerli değildir.': 'chatPanel.sendErrors.invalidReaction',
  'Cannot send — encryption key is missing.': 'chatPanel.sendErrors.encryptionBlocked',
  'Cannot send this direct message — the recipient encryption key is missing. Wait for contact sync or reconnect.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Čas odeslání vypršel. Zkuste to znovu.': 'chatPanel.sendErrors.timeout',
  "Ce message en file d'attente utilisait le fractionnement MeshCore en plusieurs parties, qui n'est plus envoyé. Annulez-le et envoyez un message plus court (ou plusieurs messages plus courts distincts).":
    'chatPanel.outboxLegacyMultipartBlocked',
  "Cette réaction n'est pas valide.": 'chatPanel.sendErrors.invalidReaction',
  'Cihaza bağlı değil': 'meshcore.errors.notConnected',
  'Die Nachricht, auf die reagiert werden soll, wurde nicht gefunden.':
    'chatPanel.sendErrors.reactionTargetMissing',
  'Die Raumsitzung ist abgelaufen - melden Sie sich erneut an, um zu posten.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Die reactie is niet geldig.': 'chatPanel.sendErrors.invalidReaction',
  'Diese Direktnachricht kann nicht gesendet werden — der Verschlüsselungsschlüssel des Empfängers fehlt. Warten Sie, bis der Kontakt synchronisiert oder erneut verbunden ist.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Diese in der Warteschlange befindliche Nachricht verwendete eine mehrteilige MeshCore-Aufteilung, die nicht mehr gesendet wird. Brechen Sie es ab und senden Sie eine kürzere Nachricht (oder mehrere separate kürzere Nachrichten).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Diese Reaktion ist nicht gültig.': 'chatPanel.sendErrors.invalidReaction',
  'Dit bericht in de wachtrij maakte gebruik van meerdelige MeshCore-splitsing, die niet langer wordt verzonden. Annuleer het en stuur een korter bericht (of meerdere afzonderlijke kortere berichten).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Düğüm bulunamadı (şifreleme anahtarı yok)': 'meshcore.errors.nodeNotFound',
  "Échec d'envoi": 'chatPanel.reticulumSendFailed',
  "Échec de l'envoi": 'chatPanel.sendFailed',
  'Échec de la publication dans la salle': 'roomsPanel.postFailed',
  'El Bluetooth no está listo. Vuelve a conectarte e inténtalo de nuevo.':
    'chatPanel.sendErrors.bleUnavailable',
  'El envío ha caducado. Inténtalo de nuevo.': 'chatPanel.sendErrors.timeout',
  'El envío ha caducado. La pila Reticulum puede estar iniciándose o ocupada; inténtelo de nuevo.':
    'chatPanel.reticulumSendTimeout',
  'Envío Fallido': 'chatPanel.sendFailed',
  'Envoi expiré. La pile Reticulum est peut-être en cours de démarrage ou occupée — réessayez.':
    'chatPanel.reticulumSendTimeout',
  'Envoi expiré. Réessayez.': 'chatPanel.sendErrors.timeout',
  'Error al enviar': 'chatPanel.reticulumSendFailed',
  'Esa reacción no es válida.': 'chatPanel.sendErrors.invalidReaction',
  'Essa reação não é válida.': 'chatPanel.sendErrors.invalidReaction',
  'Esta mensagem na fila usava divisão MeshCore em várias partes, que não é mais enviada. Cancele e envie uma mensagem mais curta (ou várias mensagens mais curtas separadas).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Este mensaje en cola utilizó la división MeshCore de varias partes, que ya no se envía. Cancélelo y envíe un mensaje más corto (o varios mensajes más cortos por separado).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Failed to post to room': 'roomsPanel.postFailed',
  'Failed to send': 'chatPanel.reticulumSendFailed',
  'Falha ao enviar': 'chatPanel.reticulumSendFailed',
  'Falha ao publicar na sala': 'roomsPanel.postFailed',
  'Falha no envio': 'chatPanel.sendFailed',
  'Fehler beim Posten im Raum': 'roomsPanel.postFailed',
  'Gagal mengeposkan ke ruangan': 'roomsPanel.postFailed',
  'Gagal mengirim': 'chatPanel.reticulumSendFailed',
  'Geen opgeslagen kamerwachtwoord. Log eerst in op de kamer.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  Gönderilemedi: 'chatPanel.sendFailed',
  'Gönderilemiyor — şifreleme anahtarı eksik.': 'chatPanel.sendErrors.encryptionBlocked',
  'Gönderim zaman aşımına uğradı. Reticulum yığını başlıyor veya meşgul olabilir — tekrar deneyin.':
    'chatPanel.reticulumSendTimeout',
  'Gönderme zaman aşımına uğradı. Tekrar deneyin.': 'chatPanel.sendErrors.timeout',
  'Het bericht om op te reageren is niet gevonden.': 'chatPanel.sendErrors.reactionTargetMissing',
  'Il Bluetooth non è pronto. Riconnettiti e riprova.': 'chatPanel.sendErrors.bleUnavailable',
  'Il messaggio a cui reagire non è stato trovato.': 'chatPanel.sendErrors.reactionTargetMissing',
  'Il messaggio è stato inviato, ma la rimozione dalla posta in uscita non è riuscita. Annullare la copia in coda.':
    'chatPanel.outboxRemoveFailed',
  'Il testo del messaggio è obbligatorio': 'chatPanel.sendErrors.emptyPayload',
  'Impossibile inviare': 'chatPanel.reticulumSendFailed',
  'Impossibile inviare — chiave di crittografia mancante.':
    'chatPanel.sendErrors.encryptionBlocked',
  'Impossibile inviare questo messaggio diretto: manca la chiave di crittografia del destinatario. Attendere la sincronizzazione o la riconnessione del contatto.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Impossibile pubblicare nella stanza': 'roomsPanel.postFailed',
  "Impossible d'envoyer — la clé de chiffrement est manquante.":
    'chatPanel.sendErrors.encryptionBlocked',
  "Impossible d'envoyer ce message direct — la clé de chiffrement du destinataire est manquante. Attendez la synchronisation des contacts ou reconnectez-vous.":
    'chatPanel.sendErrors.missingDestinationKey',
  'Invio non riuscito': 'chatPanel.sendFailed',
  'Invio scaduto. Riprova.': 'chatPanel.sendErrors.timeout',
  'Kan dit directe bericht niet verzenden — de versleutelingssleutel van de ontvanger ontbreekt. Wacht op contact synchronisatie of maak opnieuw verbinding.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Kan niet verzenden — versleutelingssleutel ontbreekt.': 'chatPanel.sendErrors.encryptionBlocked',
  'Kann nicht gesendet werden — Verschlüsselungsschlüssel fehlt.':
    'chatPanel.sendErrors.encryptionBlocked',
  'Kaydedilmiş oda şifresi yok. Önce odaya giriş yapın.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Kein gespeichertes Raumpasswort. Logge dich zuerst in den Raum ein.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Knooppunt niet gevonden (geen coderingssleutel)': 'meshcore.errors.nodeNotFound',
  'Knoten nicht gefunden (kein Verschlüsselungsschlüssel)': 'meshcore.errors.nodeNotFound',
  'Konum kullanılamıyor — GPS ayarlarını kontrol edin': 'chatPanel.shareLocationUnavailable',
  "La réponse nécessite l'identifiant du paquet RF du message (attendez l'envoi de l'ack ou l'actualisation du chat).":
    'chatPanel.replyRequiresPacketId',
  'La respuesta requiere el ID del paquete de RF del mensaje (esperar a que se envíe el acuse de recibo o se actualice el chat).':
    'chatPanel.replyRequiresPacketId',
  "La risposta richiede l'ID del pacchetto RF del messaggio (attendere la conferma di invio o aggiornare la chat).":
    'chatPanel.replyRequiresPacketId',
  'La sesión de la sala ha caducado. Vuelve a iniciar sesión para publicar.':
    'chatPanel.sendErrors.roomSessionExpired',
  'La session de la salle a expiré — reconnectez-vous pour publier.':
    'chatPanel.sendErrors.roomSessionExpired',
  "Le message a été envoyé, mais sa suppression de la boîte d'envoi a échoué. Annulez la copie en file d'attente.":
    'chatPanel.outboxRemoveFailed',
  'Le message auquel réagir est introuvable.': 'chatPanel.sendErrors.reactionTargetMissing',
  'Localisation indisponible : vérifiez les paramètres GPS': 'chatPanel.shareLocationUnavailable',
  'Localização indisponível – verifique as configurações de GPS':
    'chatPanel.shareLocationUnavailable',
  'Locatie niet beschikbaar: controleer de GPS-instellingen': 'chatPanel.shareLocationUnavailable',
  'Location unavailable — check GPS settings': 'chatPanel.shareLocationUnavailable',
  'Lokalizacja niedostępna — sprawdź ustawienia GPS': 'chatPanel.shareLocationUnavailable',
  'Lokasi tidak tersedia — periksa pengaturan GPS': 'chatPanel.shareLocationUnavailable',
  'Lütfen mesajınızı yazın.': 'chatPanel.sendErrors.emptyPayload',
  'Mesaj gönderildi, ancak giden kutusundan kaldırılamadı. Kuyruktaki kopyayı iptal edin.':
    'chatPanel.outboxRemoveFailed',
  'Message text is required.': 'chatPanel.sendErrors.emptyPayload',
  'Message was sent, but removing it from the outbox failed. Cancel the queued copy.':
    'chatPanel.outboxRemoveFailed',
  'Nachricht wurde gesendet, aber das Entfernen aus dem Postausgang ist fehlgeschlagen. Die in der Warteschlange stehende Kopie abbrechen.':
    'chatPanel.outboxRemoveFailed',
  'Nachrichtentext ist erforderlich': 'chatPanel.sendErrors.emptyPayload',
  'Não conectado — conecte o rádio e tente novamente.': 'chatPanel.sendErrors.notConnected',
  'Não conectado ao dispositivo': 'meshcore.errors.notConnected',
  'Não é possível enviar — a chave de criptografia está faltando.':
    'chatPanel.sendErrors.encryptionBlocked',
  'Não é possível enviar esta mensagem direta — a chave de criptografia do destinatário está ausente. Aguarde a sincronização do contato ou reconecte-se.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Nelze odeslat — chybí šifrovací klíč.': 'chatPanel.sendErrors.encryptionBlocked',
  'Nenhuma senha de quarto salva. Faça login no quarto primeiro.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Není připojeno k zařízení': 'meshcore.errors.notConnected',
  'Nepřipojeno — připojte rádio a zkuste to znovu.': 'chatPanel.sendErrors.notConnected',
  'Nessuna password della stanza salvata. Accedi prima alla stanza.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Nicht mit dem Gerät verbunden': 'meshcore.errors.notConnected',
  'Nicht verbunden — schließen Sie das Radio an und versuchen Sie es erneut.':
    'chatPanel.sendErrors.notConnected',
  'Nie można wysłać — brakuje klucza szyfrowania.': 'chatPanel.sendErrors.encryptionBlocked',
  'Nie można wysłać tej wiadomości bezpośredniej — brakuje klucza szyfrowania odbiorcy. Poczekaj na synchronizację kontaktu lub ponowne połączenie.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Nie podłączony — podłącz radio i spróbuj ponownie.': 'chatPanel.sendErrors.notConnected',
  'Nie udało się opublikować w pokoju': 'roomsPanel.postFailed',
  'Nie udało się wysłać': 'chatPanel.reticulumSendFailed',
  'Nie znaleziono węzła (brak klucza szyfrowania)': 'meshcore.errors.nodeNotFound',
  'Nie znaleziono wiadomości, na którą należy zareagować.':
    'chatPanel.sendErrors.reactionTargetMissing',
  'Niet verbonden — sluit de radio aan en probeer het opnieuw.':
    'chatPanel.sendErrors.notConnected',
  'Niet verbonden met apparaat': 'meshcore.errors.notConnected',
  'No conectado al dispositivo': 'meshcore.errors.notConnected',
  'Nó não encontrado (sem chave de criptografia)': 'meshcore.errors.nodeNotFound',
  'No saved room password. Log in to the room first.': 'chatPanel.sendErrors.noSavedRoomCredential',
  'No se ha encontrado el mensaje para reaccionar.': 'chatPanel.sendErrors.reactionTargetMissing',
  'No se ha guardado la contraseña de la habitación. Inicie sesión en la habitación primero.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'No se ha podido publicar en la sala': 'roomsPanel.postFailed',
  'No se puede enviar este mensaje directo: falta la clave de cifrado del destinatario. Espere a que se sincronice el contacto o vuelva a conectarse.':
    'chatPanel.sendErrors.missingDestinationKey',
  'No se puede enviar: falta la clave de cifrado.': 'chatPanel.sendErrors.encryptionBlocked',
  'Node not found (no encryption key)': 'meshcore.errors.nodeNotFound',
  'Node tidak ditemukan (tidak ada kunci enkripsi)': 'meshcore.errors.nodeNotFound',
  'Nodo no encontrado (sin clave de cifrado)': 'meshcore.errors.nodeNotFound',
  'Nodo non trovato (nessuna chiave di crittografia)': 'meshcore.errors.nodeNotFound',
  'Nœud introuvable (pas de clé de chiffrement)': 'meshcore.errors.nodeNotFound',
  'Non connecté — connectez la radio et réessayez.': 'chatPanel.sendErrors.notConnected',
  "Non connecté à l'appareil": 'meshcore.errors.notConnected',
  'Non connesso al dispositivo': 'meshcore.errors.notConnected',
  'Non connesso: collega la radio e riprova.': 'chatPanel.sendErrors.notConnected',
  'Not connected — connect the radio and try again.': 'chatPanel.sendErrors.notConnected',
  'Not connected to device': 'meshcore.errors.notConnected',
  'O Bluetooth não está pronto. Reconecte-se e tente novamente.':
    'chatPanel.sendErrors.bleUnavailable',
  'O envio expirou. A pilha Reticulum pode estar iniciando ou ocupada — tente novamente.':
    'chatPanel.reticulumSendTimeout',
  'O envio expirou. Tente novamente.': 'chatPanel.sendErrors.timeout',
  'O texto da mensagem é obrigatório.': 'chatPanel.sendErrors.emptyPayload',
  'Oda oturumunun süresi doldu — yayınlamak için tekrar giriş yapın.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Odaya gönderilemedi': 'roomsPanel.postFailed',
  'Odeslání se nezdařilo': 'chatPanel.sendFailed',
  'Odeslání vypršelo. Zásobník Reticulum se možná spouští nebo je zaneprázdněný — zkuste to znovu.':
    'chatPanel.reticulumSendTimeout',
  'Odpověď vyžaduje ID RF paketu zprávy (počkejte na odeslání ack nebo obnovení chatu).':
    'chatPanel.replyRequiresPacketId',
  'Odpowiedź wymaga identyfikatora pakietu RF wiadomości (poczekaj na potwierdzenie wysłania lub odśwież czat).':
    'chatPanel.replyRequiresPacketId',
  'Pengiriman gagal': 'chatPanel.sendFailed',
  'Pesan antrean ini menggunakan pemisahan MeshCore multi-bagian, yang tidak lagi terkirim. Batalkan dan kirim pesan singkat (atau beberapa pesan singkat terpisah).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Pesan terkirim, tetapi tidak berhasil menghapusnya dari kotak keluar. Batalkan salinan yang diantrekan.':
    'chatPanel.outboxRemoveFailed',
  'Pesan untuk bereaksi tidak ditemukan.': 'chatPanel.sendErrors.reactionTargetMissing',
  'Poloha není k dispozici – zkontrolujte nastavení GPS': 'chatPanel.shareLocationUnavailable',
  'Posizione non disponibile: controlla le impostazioni GPS': 'chatPanel.shareLocationUnavailable',
  'Posten naar ruimte mislukt': 'roomsPanel.postFailed',
  'Przekroczono limit czasu wysyłania. Spróbuj ponownie.': 'chatPanel.sendErrors.timeout',
  'Przekroczono limit czasu wysyłania. Stos Reticulum może się uruchamiać lub być zajęty — spróbuj ponownie.':
    'chatPanel.reticulumSendTimeout',
  'Questa reazione non è valida.': 'chatPanel.sendErrors.invalidReaction',
  'Questo messaggio in coda utilizzava la suddivisione MeshCore in più parti, che non viene più inviata. Annullalo e invia un messaggio più breve (o più messaggi brevi separati).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Reaksi itu tidak valid.': 'chatPanel.sendErrors.invalidReaction',
  'Relace místnosti vypršela — pro zveřejnění se znovu přihlaste.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Reply requires the message RF packet id (wait for send ack or refresh chat).':
    'chatPanel.replyRequiresPacketId',
  'Room session expired — log in again to post.': 'chatPanel.sendErrors.roomSessionExpired',
  'Roomsessie verlopen — log opnieuw in om te posten.': 'chatPanel.sendErrors.roomSessionExpired',
  'Se ha enviado el mensaje, pero se ha producido un error al eliminarlo de la bandeja de salida. Cancelar la copia en cola.':
    'chatPanel.outboxRemoveFailed',
  'Se requiere un texto de mensaje.': 'chatPanel.sendErrors.emptyPayload',
  'Send failed': 'chatPanel.sendFailed',
  'Send timed out. The Reticulum stack may be starting or busy — try again.':
    'chatPanel.reticulumSendTimeout',
  'Send timed out. Try again.': 'chatPanel.sendErrors.timeout',
  'Senden abgelaufen. Der Reticulum-Stack startet möglicherweise oder ist beschäftigt — bitte erneut versuchen.':
    'chatPanel.reticulumSendTimeout',
  'Senden fehlgeschlagen': 'chatPanel.reticulumSendFailed',
  'Senden fehlgeschlagen.': 'chatPanel.sendFailed',
  'Sendezeit abgelaufen. Versuchen Sie es erneut.': 'chatPanel.sendErrors.timeout',
  'Sesi kamar kedaluwarsa — masuk lagi untuk memposting.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Sesja w pokoju wygasła — zaloguj się ponownie, aby opublikować.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Sessione room scaduta — accedi di nuovo per pubblicare.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Sin conexión: conecte la radio e inténtelo de nuevo.': 'chatPanel.sendErrors.notConnected',
  'Standort nicht verfügbar – überprüfen Sie die GPS-Einstellungen':
    'chatPanel.shareLocationUnavailable',
  'Ta reakcja jest nieważna.': 'chatPanel.sendErrors.invalidReaction',
  'Ta wiadomość umieszczona w kolejce korzystała z wieloczęściowego podziału MeshCore, który nie jest już wysyłany. Anuluj i wyślij krótszą wiadomość (lub kilka oddzielnych krótszych wiadomości).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Tato reakce není platná.': 'chatPanel.sendErrors.invalidReaction',
  'Tato zpráva ve frontě používala vícedílné rozdělení MeshCore, které se již neodesílá. Zrušte jej a odešlete kratší zprávu (nebo několik samostatných kratších zpráv).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Teks pesan wajib diisi.': 'chatPanel.sendErrors.emptyPayload',
  'Tepki verilecek mesaj bulunamadı.': 'chatPanel.sendErrors.reactionTargetMissing',
  'Text zprávy je vyžadován.': 'chatPanel.sendErrors.emptyPayload',
  'That reaction is not valid.': 'chatPanel.sendErrors.invalidReaction',
  'The message to react to was not found.': 'chatPanel.sendErrors.reactionTargetMissing',
  'This queued message used multi-part MeshCore splitting, which is no longer sent. Cancel it and send a shorter message (or several separate shorter messages).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Tidak ada kata sandi kamar yang disimpan. Masuk ke kamar terlebih dahulu.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Tidak dapat mengirim — kunci enkripsi hilang.': 'chatPanel.sendErrors.encryptionBlocked',
  'Tidak dapat mengirim pesan langsung ini — kunci enkripsi penerima hilang. Tunggu sinkronisasi kontak atau sambungkan kembali.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Tidak terhubung ke perangkat': 'meshcore.errors.notConnected',
  'Tidak tersambung — hubungkan radio dan coba lagi.': 'chatPanel.sendErrors.notConnected',
  'Time-out bij verzenden. Probeer het opnieuw.': 'chatPanel.sendErrors.timeout',
  'Time-out voor verzenden. De Reticulum-stack is mogelijk aan het starten of bezet — probeer het opnieuw.':
    'chatPanel.reticulumSendTimeout',
  "Timeout dell'invio. Lo stack Reticulum potrebbe essere in avvio o occupato. Riprova.":
    'chatPanel.reticulumSendTimeout',
  'Tuto přímou zprávu nelze odeslat — chybí šifrovací klíč příjemce. Počkejte na synchronizaci nebo opětovné připojení kontaktu.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Ubicación no disponible: verifique la configuración del GPS':
    'chatPanel.shareLocationUnavailable',
  'Un texte pour le message est requis': 'chatPanel.sendErrors.emptyPayload',
  'Uzel nenalezen (žádný šifrovací klíč)': 'meshcore.errors.nodeNotFound',
  'Versturen mislukt': 'chatPanel.reticulumSendFailed',
  'Verzenden mislukt': 'chatPanel.sendFailed',
  'Waktu pengiriman habis. Coba lagi.': 'chatPanel.sendErrors.timeout',
  'Waktu pengiriman habis. Stack Reticulum mungkin sedang mulai atau sibuk — coba lagi.':
    'chatPanel.reticulumSendTimeout',
  'Wiadomość została wysłana, ale usunięcie jej ze skrzynki nadawczej nie powiodło się. Anuluj kopię w kolejce.':
    'chatPanel.outboxRemoveFailed',
  'Wymagany jest tekst wiadomości': 'chatPanel.sendErrors.emptyPayload',
  'Wysyłanie nieudane': 'chatPanel.sendFailed',
  'Yanıt, RF paket kimliği mesajını gerektirir (mesajın gönderilmesini bekleyin veya sohbeti yenileyin).':
    'chatPanel.replyRequiresPacketId',
  'Žádné uložené heslo místnosti. Nejprve se přihlaste do místnosti.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Zpráva byla odeslána, ale odebrání ze schránky se nezdařilo. Zrušte kopii ve frontě.':
    'chatPanel.outboxRemoveFailed',
  'Zpráva, na kterou chcete reagovat, nebyla nalezena.':
    'chatPanel.sendErrors.reactionTargetMissing',
  'Zveřejnění příspěvku na pokoj se nezdařilo': 'roomsPanel.postFailed',
  'В этом сообщении в очереди использовалось разделение MeshCore на несколько частей, которое больше не отправляется. Отмените его и отправьте более короткое сообщение (или несколько отдельных более коротких сообщений).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Время ожидания отправки истекло. Повторите попытку.': 'chatPanel.sendErrors.timeout',
  'Время ожидания отправки истекло. Стек Reticulum, возможно, запускается или занят — повторите попытку.':
    'chatPanel.reticulumSendTimeout',
  'Вузол не знайдено (немає ключа шифрування)': 'meshcore.errors.nodeNotFound',
  'Для відповіді потрібен ідентифікатор радіочастотного пакета повідомлення (дочекайтеся надсилання або оновлення чату).':
    'chatPanel.replyRequiresPacketId',
  'Для ответа требуется идентификатор радиочастотного пакета сообщения (дождитесь отправки ack или обновления чата).':
    'chatPanel.replyRequiresPacketId',
  'Местоположение недоступно — проверьте настройки GPS.': 'chatPanel.shareLocationUnavailable',
  'Місцезнаходження недоступне — перевірте налаштування GPS': 'chatPanel.shareLocationUnavailable',
  'Не вдалося надіслати': 'chatPanel.sendFailed',
  'Не вдалося надіслати.': 'chatPanel.reticulumSendFailed',
  'Не вдалося опублікувати до кімнати': 'roomsPanel.postFailed',
  'Не підключено — підключіть радіоприймач і повторіть спробу.':
    'chatPanel.sendErrors.notConnected',
  'Не підключено до пристрою': 'meshcore.errors.notConnected',
  'Не подключен к устройству': 'meshcore.errors.notConnected',
  'Не подключено — подключите радио и повторите попытку.': 'chatPanel.sendErrors.notConnected',
  'Не удалось опубликовать в комнате': 'roomsPanel.postFailed',
  'Не удалось отправить': 'chatPanel.reticulumSendFailed',
  'Невозможно отправить — отсутствует ключ шифрования.': 'chatPanel.sendErrors.encryptionBlocked',
  'Невозможно отправить это прямое сообщение — отсутствует ключ шифрования получателя. Дождитесь синхронизации контактов или повторного подключения.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Немає збереженого пароля кімнати. Спочатку увійдіть в кімнату.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Неможливо надіслати — відсутній ключ шифрування.': 'chatPanel.sendErrors.encryptionBlocked',
  'Неможливо надіслати це пряме повідомлення — відсутній ключ шифрування одержувача. Дочекайтеся синхронізації контактів або повторного підключення.':
    'chatPanel.sendErrors.missingDestinationKey',
  'Нет сохраненного пароля комнаты. Сначала войдите в комнату.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  'Повідомлення надіслано, але не вдалося видалити його з папки "Вихідні". Скасувати поставлену в чергу копію.':
    'chatPanel.outboxRemoveFailed',
  'Повідомлення, на яке потрібно відреагувати, не знайдено.':
    'chatPanel.sendErrors.reactionTargetMissing',
  "Поле Повідомлення / Запит - обов'язкове до заповнення.": 'chatPanel.sendErrors.emptyPayload',
  'Потрібен текст повідомлення.': 'chatPanel.sendErrors.emptyPayload',
  'Сбой отправки': 'chatPanel.sendFailed',
  'Сесія в кімнаті закінчилася — увійдіть знову, щоб опублікувати допис.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Сессия комнаты истекла — войдите снова, чтобы опубликовать.':
    'chatPanel.sendErrors.roomSessionExpired',
  'Сообщение отправлено, но удалить его из папки «Исходящие» не удалось. Отмените копию в очереди.':
    'chatPanel.outboxRemoveFailed',
  'Сообщение, на которое нужно отреагировать, не найдено.':
    'chatPanel.sendErrors.reactionTargetMissing',
  'Тайм-аут надсилання. Стек Reticulum може запускатися або бути зайнятий — спробуйте ще раз.':
    'chatPanel.reticulumSendTimeout',
  'Узел не найден (нет ключа шифрования)': 'meshcore.errors.nodeNotFound',
  'Це повідомлення в черзі використовувало розділення MeshCore на кілька частин, яке більше не надсилається. Скасуйте його та надішліть коротше повідомлення (або кілька окремих коротших повідомлень).':
    'chatPanel.outboxLegacyMultipartBlocked',
  'Ця реакція недійсна.': 'chatPanel.sendErrors.invalidReaction',
  'Час очікування надсилання закінчився. Спробуйте ще раз.': 'chatPanel.sendErrors.timeout',
  'Эта реакция недействительна.': 'chatPanel.sendErrors.invalidReaction',
  '기기에 연결되지 않음': 'meshcore.errors.notConnected',
  '노드를 찾을 수 없음(암호화 키 없음)': 'meshcore.errors.nodeNotFound',
  '대기 중인 이 메시지는 더 이상 전송되지 않는 다중 부분 MeshCore 분할을 사용했습니다. 취소하고 더 ​​짧은 메시지(또는 여러 개의 개별 짧은 메시지)를 보내십시오.':
    'chatPanel.outboxLegacyMultipartBlocked',
  '룸에 게시하지 못했습니다.': 'roomsPanel.postFailed',
  '메시지가 전송되었지만 보낸 편지함에서 제거하지 못했습니다. 대기 중인 사본을 취소합니다.':
    'chatPanel.outboxRemoveFailed',
  '메시지는 필수 입력 사항입니다': 'chatPanel.sendErrors.emptyPayload',
  '보내지 못했습니다': 'chatPanel.reticulumSendFailed',
  '보낼 수 없음 — 암호화 키가 없습니다.': 'chatPanel.sendErrors.encryptionBlocked',
  '블루투스가 준비되지 않았습니다. 다시 연결하고 다시 시도하세요.':
    'chatPanel.sendErrors.bleUnavailable',
  '연결되지 않음 — 라디오를 연결하고 다시 시도하십시오.': 'chatPanel.sendErrors.notConnected',
  '위치를 확인할 수 없음 - GPS 설정을 확인하세요': 'chatPanel.shareLocationUnavailable',
  '응답할 메시지를 찾을 수 없습니다.': 'chatPanel.sendErrors.reactionTargetMissing',
  '이 다이렉트 메시지를 보낼 수 없습니다 — 수신자 암호화 키가 없습니다. 연락처가 동기화되거나 다시 연결될 때까지 기다리세요.':
    'chatPanel.sendErrors.missingDestinationKey',
  '저장된 객실 비밀번호가 없습니다. 먼저 방에 로그인하세요.':
    'chatPanel.sendErrors.noSavedRoomCredential',
  '전송 시간이 초과되었습니다. Reticulum 스택이 시작 중이거나 사용 중일 수 있습니다 — 다시 시도하세요.':
    'chatPanel.reticulumSendTimeout',
  '전송 시간이 초과되었습니다. 다시 시도하세요.': 'chatPanel.sendErrors.timeout',
  '전송 실패': 'chatPanel.sendFailed',
  '해당 반응은 유효하지 않습니다.': 'chatPanel.sendErrors.invalidReaction',
  '회신하려면 메시지 RF 패킷 ID가 필요합니다 (ACK 전송 또는 채팅 새로 고침을 기다림).':
    'chatPanel.replyRequiresPacketId',
  '회의실 세션이 만료되었습니다. 다시 로그인하여 게시하세요.':
    'chatPanel.sendErrors.roomSessionExpired',
  'このキューに入れられたメッセージでは、マルチパート MeshCore 分割が使用されていましたが、現在は送信されません。それをキャンセルして、より短いメッセージ (または複数の別個の短いメッセージ) を送信します。':
    'chatPanel.outboxLegacyMultipartBlocked',
  'このダイレクトメッセージを送信できません—受信者の暗号化キーがありません。連絡先の同期または再接続を待ちます。':
    'chatPanel.sendErrors.missingDestinationKey',
  'その反応は有効ではありません。': 'chatPanel.sendErrors.invalidReaction',
  デバイスに接続されていません: 'meshcore.errors.notConnected',
  'ノードが見つかりません (暗号化キーがありません)': 'meshcore.errors.nodeNotFound',
  'メッセージが送信されましたが、送信トレイから削除できませんでした。キューに入っているコピーをキャンセルします。':
    'chatPanel.outboxRemoveFailed',
  'メッセージは必須です。': 'chatPanel.sendErrors.emptyPayload',
  'ルームセッションの有効期限が切れました。再度ログインして投稿してください。':
    'chatPanel.sendErrors.roomSessionExpired',
  ルームへの投稿に失敗しました: 'roomsPanel.postFailed',
  '位置不可用 — 检查 GPS 设置': 'chatPanel.shareLocationUnavailable',
  '位置情報が利用できません - GPS 設定を確認してください': 'chatPanel.shareLocationUnavailable',
  '保存された部屋のパスワードはありません。まず部屋にログインします。':
    'chatPanel.sendErrors.noSavedRoomCredential',
  发布到聊天室失败: 'roomsPanel.postFailed',
  发送失败: 'chatPanel.sendFailed',
  '发送超时。Reticulum 堆栈可能正在启动或忙碌—请重试。': 'chatPanel.reticulumSendTimeout',
  '发送超时。请重试。': 'chatPanel.sendErrors.timeout',
  '回复需要消息RF数据包ID （等待发送确认或刷新聊天）。': 'chatPanel.replyRequiresPacketId',
  必须填写消息文本: 'chatPanel.sendErrors.emptyPayload',
  '応答するメッセージが見つかりませんでした。': 'chatPanel.sendErrors.reactionTargetMissing',
  '応答には、メッセージRFパケットIDが必要です（送信確認またはチャットの更新を待ちます）。':
    'chatPanel.replyRequiresPacketId',
  '接続されていません。ラジオを接続して、もう一度お試しください。':
    'chatPanel.sendErrors.notConnected',
  '无法发送—缺少加密密钥。': 'chatPanel.sendErrors.encryptionBlocked',
  '无法发送此直接消息—缺少收件人加密密钥。等待联系人同步或重新连接。':
    'chatPanel.sendErrors.missingDestinationKey',
  '未保存房间密码。请先登录房间。': 'chatPanel.sendErrors.noSavedRoomCredential',
  '未找到节点（无加密密钥）': 'meshcore.errors.nodeNotFound',
  '未找到要响应的消息。': 'chatPanel.sendErrors.reactionTargetMissing',
  '未连接—请连接收音机并重试。': 'chatPanel.sendErrors.notConnected',
  未连接到设备: 'meshcore.errors.notConnected',
  '消息已发送，但将其从发件箱中删除失败。取消排队的副本。': 'chatPanel.outboxRemoveFailed',
  '聊天室会话已过期—请重新登录以发布。': 'chatPanel.sendErrors.roomSessionExpired',
  '蓝牙尚未准备就绪。请重新连接并重试。': 'chatPanel.sendErrors.bleUnavailable',
  '该反应无效。': 'chatPanel.sendErrors.invalidReaction',
  '该排队消息使用了多部分MeshCore分裂，不再发送。取消它并发送一条较短的消息（或多个单独的较短消息）。':
    'chatPanel.outboxLegacyMultipartBlocked',
  '送信がタイムアウトしました。Reticulum スタックが起動中またはビジーの可能性があります — 再試行してください。':
    'chatPanel.reticulumSendTimeout',
  '送信がタイムアウトしました。もう一度お試しください。': 'chatPanel.sendErrors.timeout',
  '送信できません—暗号化キーがありません。': 'chatPanel.sendErrors.encryptionBlocked',
  送信に失敗しました: 'chatPanel.sendFailed',
  '送信に失敗しました。': 'chatPanel.reticulumSendFailed',
};
