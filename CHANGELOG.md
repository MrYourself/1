# Änderungen

Alle Versionen mit Download stehen unter [Releases](https://github.com/MrYourself/1/releases).

## Version 0.2.2

- **Stream-Untertitel nur als Übersetzer:** Neuer Schalter „Nur Übersetzungen anzeigen“, standardmäßig an. Was schon in der Untertitel-Sprache gesprochen wird (z. B. Englisch), erscheint nicht mehr als Untertitel; eingeblendet wird nur, was vollständig übersetzt wurde. Sätze, in denen beide Sprachen gemischt sind, erzeugen keinen Untertitel. Schalter aus zeigt wie bisher alles Gesprochene.

## Version 0.2.1

- **Twitch-Anmeldung:** Ist die Twitch-Anwendung mit dem Client-Typ „Vertraulich“ (Confidential) angelegt, meldet das Overlay das jetzt sofort bei der Anmeldung. Solche Anwendungen können die Anmeldung nicht ohne Client-Secret erneuern, was bisher nach einigen Stunden zu einer kommentarlosen Abmeldung führte. Benötigt wird der Client-Typ **„Öffentlich“ (Public)**.
- Untertitel als **Browserquelle** für OBS („Browser“) und TikTok LIVE Studio („Link“): transparenter Hintergrund, kein Mauszeiger, frei wählbare Größe.
- Einstellbare **Textfarbe** der Untertitel, dunkler Kasten hinter dem Text ein- und ausschaltbar.
- Das Aufnahmefenster ist optional und standardmäßig aus. Es erscheint nur, wenn „Zusätzliches Aufnahmefenster“ eingeschaltet wird.
- **Updates:** Auswahl, wann Updates installiert werden (sofort beim Start, beim Beenden, nur auf Knopfdruck). Die portable Version aktualisiert sich jetzt selbst.
- **Chat-Übersetzung:** Nachrichten, die schon in der Zielsprache geschrieben sind, werden auch mit langgezogenen Wörtern erkannt („hellooo I'm backkkkk“) und nicht mehr an DeepL geschickt. Liefert DeepL nur dieselbe Nachricht in sauberer Schreibweise zurück („Grr flames“ → „Grr, flames“), wird sie nicht angezeigt. TikTok-Emotes wie `[wow]` bleiben unübersetzt.
- **Stream-Untertitel:** Englisch wird nicht mehr „ins Englische übersetzt“. Ordnet die Spracherkennung gesprochenes Englisch fälschlich einer anderen Sprache zu, bleibt der Text so stehen, wie er gesprochen wurde.
- **TikTok:** Ein Verbindungsversuch, der abgebrochen oder überholt wurde, bleibt nicht mehr unbemerkt im Hintergrund offen und belegt keinen Euler-Platz mehr. Verbindungsversuche, Fehler und Trennungen stehen in `tiktok-events.log` (Knopf „TikTok-Protokoll öffnen“).
- **Stream-Untertitel:** Wird das Mikrofon getrennt oder ist es beim Start noch nicht bereit, startet die Aufnahme von selbst neu. Ein angefangener Satz bleibt nach einem Verbindungsabbruch nicht mehr im Bild stehen.
- Der Chat-Verlauf wird höchstens alle fünf Sekunden auf die Festplatte geschrieben statt nach fast jeder Nachricht.
- Einstellungen, die vom Tray-Menü kommen, überschreiben keinen Text mehr, der gerade eingetippt wird.
- **Vorabversionen:** Unter **Einstellungen → Updates** lässt sich „Vorabversionen (Beta) erhalten“ einschalten. Ohne diesen Schalter bekommen Installationen nur stabile Versionen.

## Version 0.1.17 und 0.2.0

- Version 0.2.0 liegt bewusst über den älteren Versionen 0.1.18 bis 0.1.20 mit dem früheren eigenen Update-Server. Updates laufen nur noch über GitHub Releases.
- Lehnt Twitch das Erneuern der Anmeldung ab, übernimmt die App zuerst eine neuere gespeicherte Anmeldung, statt abzumelden. Gründe für verlorene Anmeldungen werden ohne Tokens in `auth-events.log` festgehalten.
- Die Entwicklerversion (`npm start`) nutzt einen eigenen Datenordner und kommt der installierten App nicht mehr in die Quere.
- Einzelne Wörter (Namen, Emote-Wörter, Ausrufe wie „aniimooooo“) werden nicht mehr übersetzt. DeepL hat bei ihnen Sprache und Bedeutung geraten.
- Langgezogene Buchstaben („sooooo“) werden vor der Übersetzung gekürzt.
- Erkennt DeepL bei kurzen Nachrichten eine unwahrscheinliche Sprache („ti amo“ als Guaraní), bleibt die Übersetzung erhalten, aber statt eines falschen Sprachkürzels wird nur die Zielsprache angezeigt.

## Version 0.1.15

- **Chat-Übersetzung mit DeepL:** Fremdsprachige Twitch- und TikTok-Nachrichten werden automatisch übersetzt.
- **Stream-Untertitel:** Gesprochenes wird erkannt und für die Zuschauer übersetzt eingeblendet.
- **Automatische Updates** über GitHub Releases.
- Neuer Knopf **✕** in der Kopfzeile beendet das Overlay. **—** blendet es weiterhin nur aus.
- Alte TikTok-Nachrichten erscheinen nicht mehr: TikTok liefert beim Verbinden keine Kommentare von vorher mehr nach, und gespeicherter Verlauf wird erst angezeigt, wenn der zugehörige Stream nachweislich noch läuft. Verlauf eines Streams, dessen Ende die App nicht mitbekommen hat, verfällt nach 12 Stunden.
- Der Sperrmodus wurde entfernt: Das Overlay ist nicht mehr klickdurchlässig; der Knopf **Fertig**, der Sperr-Hinweis, der Tray-Eintrag und das Tastenkürzel `Strg` + `Umschalt` + `O` entfallen. Einstellungen und Bedienknöpfe sind immer erreichbar.
- Bereits ausgeblendete Nachrichten erscheinen bei Reconnects nicht mehr erneut. Wiederhergestellter Verlauf blendet sich relativ zum ursprünglichen Zeitpunkt aus, und Reconnects bauen den sichtbaren Chat nicht mehr komplett neu auf.
- Scheitert nach erfolgreicher Twitch-Anmeldung der Verbindungsaufbau, erscheint das nicht mehr als Anmeldefehler.
- Nach einem TikTok-Stream-Ende wird nicht mehr nach 5 Sekunden neu verbunden und kein Fehlerstatus angezeigt.
- Ist der TikTok-Account offline, steigen die Verbindungsversuche von 30 Sekunden auf maximal 2 Minuten an. Manuelles Neuverbinden oder ein geänderter Name bzw. API-Key startet sofort.
- Eine zweite gestartete Instanz initialisiert nichts mehr und kann weder den Twitch-Refresh-Token verbrauchen noch den Verlauf überschreiben.
- Die App lässt sich auch über Windows-Herunterfahren oder `app.quit()` sauber beenden.
- Kleinere Korrekturen: fehlende Token-Laufzeit, 429-Erkennung, Spamfilter getrennt nach Plattform, schnellere Duplikat-Bereinigung.

## Version 0.1.14

- TikTok-Anfangsnachrichten verwenden beim Freigeben des Verbindungspuffers ihre ursprünglichen Zeitstempel für den Spamfilter.
- Twitch-Moderationsereignisse löschen ausschließlich Twitch-Nachrichten; der lokale Knopf **Chat leeren** leert weiterhin beide Plattformen.
- Vorübergehende Fehler bei Token-Erneuerung und Kanalauflösung lösen weitere Twitch-Verbindungsversuche mit begrenztem Backoff aus. Abmeldung und veraltete Versuche stoppen diese Wiederholungen.
- Beim EventSub-Verbindungswechsel werden Ereignisse der alten Verbindung bis zur Begrüßung der neuen Verbindung weiter verarbeitet; doppelte Zustellungen werden erkannt.
- Das Twitch-Zeitlimit umfasst jetzt auch das vollständige Einlesen der HTTP-Antwort.
- 14 zusätzliche Ablauf-Tests sichern die korrigierten Fälle ab. Mit `npm run check` werden insgesamt 56 Tests ausgeführt.

## Version 0.1.13

- getrennte Zuschaueranzeigen für Twitch und TikTok direkt im Overlay
- laufende Streamdauer: bei Twitch ab dem echten Streamstart, bei TikTok mit Verbindungszeit als zuverlässigem Rückfallwert
- lokale Uhrzeit und sekundengenaue Dauer in einer kompakten, dauerhaft sichtbaren Statistikleiste
- Statistikleiste in den Einstellungen ein- und ausblendbar
- beim TikTok-Verbindungsstart eintreffende Nachrichten werden erst nach der Verlaufsauswahl freigegeben und nicht mehr überschrieben
- wiederhergestellte Nachrichten verwenden ihre echten Zeitstempel für den Spamfilter; aktive Vielschreiber verlieren dadurch keine Nachrichten mehr

## Ältere Versionen

- der optionale Abruf erweiterter Geschenkdetails kann den TikTok-Chat nicht mehr blockieren
- erkennt auch den vom Connector gelieferten `SignatureMissingTokensError` als Geschenklisten-Fehler
- blendet einen Fehler des ersten, optionalen Versuchs nicht mehr kurzzeitig als endgültigen Verbindungsfehler ein
- TikTok-Geschenke behalten Name, Bild, Serienstatus und Diamantwert aus dem eigentlichen Live-Ereignis
- lädt einen neu gespeicherten oder ersetzten Euler-Key garantiert in den Signatur-Client
- erkennt und repariert eine gecachte keylose Signaturinstanz
- unterscheidet Euler-Limit, abgelehnten Key, fehlende Tarifberechtigung und Dienstausfall
- längere, angepasste Neuverbindungsintervalle bei Limit- und Berechtigungsfehlern
- Netzwerk-Timeouts für alle Twitch-API- und Anmeldeanfragen
- kollisionsfreie Twitch-Neuverbindungen: veraltete Kanal- und Socket-Versuche werden verworfen
- begrenzter exponentieller Backoff für IRC und EventSub
- gespeicherte Twitch-Anmeldung bleibt bei kurzen Twitch-/Netzwerkausfällen erhalten
- Chat startet auch dann weiter, wenn einzelne Badge-Bilder nicht geladen werden können
- gehärtete IPC-Aufrufe, freigegebene externe Ziele und validierte gespeicherte Einstellungen
- begrenzter TikTok-Ereignispuffer und stärker isolierter versteckter Room-ID-Browser
- korrekte Twitch-Emote-Positionen bei vorangestellten Emojis
- reparierte Moderations-, Ausblend- und Fehlerzustände im Overlay
- Twitch-Anmeldung im Browser per offiziellem Device-Code-Flow
- EventSub-WebSocket plus Twitch-IRC-Rückfallebene für zuverlässigen Chat-Empfang
- Deduplizierung, falls dieselbe Nachricht über beide Twitch-Verbindungen eintrifft
- lokaler Twitch-Verlauf, automatisch an die aktuelle Stream-ID gebunden
- TikTok-LIVE-Chat anhand des öffentlichen TikTok-Benutzernamens
- eigener Room-ID-Fallback für die aktuelle TikTok-`SIGI_STATE`-Struktur
- zusätzlicher unsichtbarer, stummgeschalteter Chromium-Fallback für von TikTok blockierte Hintergrundabrufe
- tolerante Room-ID-Erkennung aus Roh-HTML, escaped Streamdaten und geladenen Ressourcen-URLs
- TikTok-Profilbilder, Emotes, Geschenke, Geschenkserien und Diamantwerte
- optional einblendbare TikTok-Follows und Shares
- gemeinsame, chronologisch sortierte Darstellung beider Plattformen
- sichtbare Diagnose für EventSub, IRC, TikTok und empfangene Ereignisse
- verständliche TikTok-Fehleranzeige, 25-Sekunden-Timeout und automatische Neuverbindung
- optionaler, verschlüsselt gespeicherter Euler-Stream-API-Key für eine zuverlässigere TikTok-Verbindung
- automatischer Chat-Fallback, falls TikTok nur den Abruf erweiterter Geschenkdetails blockiert
- fest eingebettetes Windows-Icon für Tray und App-Fenster
- Twitch-Emotes, animierte Emotes, GIF-Fragmente und Kanal-/Global-Badges
- eigene Hervorhebungen für Mentions, Bits und Abos
- grüne Echtzeit-Highlights für neue Twitch-Follows
- konfigurierbare Bot-, Nutzer-, Wort- und Spamfilter
- transparentes, rahmenloses Always-on-top-Fenster
- standardmäßig aktiver Stream-Safe-Modus, der das Overlay vor unterstützten Bildschirmaufnahmen verbirgt
- frei anpassbare Schriftgröße, Deckkraft, Nachrichtenanzahl und Ausblendzeit
- Tray-Menü, automatische Wiederverbindung und verschlüsselte Token-Speicherung über Windows
- Schutz vor mehreren gleichzeitig laufenden App-Instanzen
