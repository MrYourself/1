# Stream Chat Overlay

Ein transparentes Windows-Overlay, das Twitch- und TikTok-LIVE-Chats gemeinsam über einem Spiel anzeigt. Das Fenster bleibt immer im Vordergrund und jederzeit bedienbar.

## Neu in Version 0.2.1

- **Twitch-Anmeldung:** Ist die Twitch-Anwendung mit dem Client-Typ „Vertraulich“ (Confidential) angelegt, meldet das Overlay das jetzt sofort bei der Anmeldung. Solche Anwendungen können die Anmeldung nicht ohne Client-Secret erneuern, was bisher nach einigen Stunden zu einer kommentarlosen Abmeldung führte. Benötigt wird der Client-Typ **„Öffentlich“ (Public)**.
- Untertitel als **Browserquelle** für OBS („Browser“) und TikTok LIVE Studio („Link“): transparenter Hintergrund, kein Mauszeiger, frei wählbare Größe.
- Einstellbare **Textfarbe** der Untertitel, dunkler Kasten hinter dem Text ein- und ausschaltbar.
- Das Aufnahmefenster ist optional und standardmäßig aus. Es erscheint nur, wenn „Zusätzliches Aufnahmefenster“ eingeschaltet wird.
- **Updates:** Auswahl, wann Updates installiert werden (sofort beim Start, beim Beenden, nur auf Knopfdruck). Die portable Version aktualisiert sich jetzt selbst.
- **Chat-Übersetzung:** Nachrichten, die schon in der Zielsprache geschrieben sind, werden auch mit langgezogenen Wörtern erkannt („hellooo I'm backkkkk“) und nicht mehr an DeepL geschickt. Liefert DeepL nur dieselbe Nachricht in sauberer Schreibweise zurück („Grr flames“ → „Grr, flames“), wird sie nicht angezeigt. TikTok-Emotes wie `[wow]` bleiben unübersetzt.
- **Stream-Untertitel:** Englisch wird nicht mehr „ins Englische übersetzt“. Ordnet die Spracherkennung gesprochenes Englisch fälschlich einer anderen Sprache zu, bleibt der Text so stehen, wie er gesprochen wurde.
- **Vorabversionen:** Unter **Einstellungen → Updates** lässt sich „Vorabversionen (Beta) erhalten“ einschalten. Ohne diesen Schalter bekommen Installationen nur stabile Versionen.

## Korrekturen in Version 0.1.17 und 0.2.0

- Version 0.2.0 liegt bewusst über den älteren Versionen 0.1.18 bis 0.1.20 mit dem früheren eigenen Update-Server. Updates laufen nur noch über GitHub Releases.
- Lehnt Twitch das Erneuern der Anmeldung ab, übernimmt die App zuerst eine neuere gespeicherte Anmeldung, statt abzumelden. Gründe für verlorene Anmeldungen werden ohne Tokens in `auth-events.log` festgehalten.
- Die Entwicklerversion (`npm start`) nutzt einen eigenen Datenordner und kommt der installierten App nicht mehr in die Quere.
- Einzelne Wörter (Namen, Emote-Wörter, Ausrufe wie „aniimooooo“) werden nicht mehr übersetzt. DeepL hat bei ihnen Sprache und Bedeutung geraten.
- Langgezogene Buchstaben („sooooo“) werden vor der Übersetzung gekürzt.
- Erkennt DeepL bei kurzen Nachrichten eine unwahrscheinliche Sprache („ti amo“ als Guaraní), bleibt die Übersetzung erhalten, aber statt eines falschen Sprachkürzels wird nur die Zielsprache angezeigt.

## Neu in Version 0.1.15: Chat-Übersetzung mit DeepL

Fremdsprachige Twitch- und TikTok-Nachrichten lassen sich automatisch übersetzen. Die Übersetzung erscheint klein unter der Originalnachricht.

1. Unter [deepl.com/pro-api](https://www.deepl.com/pro-api) ein kostenloses **DeepL API Free**-Konto anlegen (500.000 Zeichen pro Monat) und den API-Key kopieren.
2. Im Overlay unter **Einstellungen → Chat-Übersetzung** den Key speichern. Er wird wie die anderen Zugangsdaten mit der Windows-Anmeldeinformationsspeicherung verschlüsselt.
3. **Fremdsprachige Nachrichten mit DeepL übersetzen** aktivieren und die Zielsprache wählen.

So wird das Kontingent geschont:

- Übersetzt werden nur Nachrichten, die tatsächlich angezeigt werden. Ausgeblendete Bots, Spam und Chatbefehle kosten keine Zeichen.
- Sprachen unter **Nicht übersetzen aus** (Standard: `EN`) und die Zielsprache selbst werden nicht übersetzt. Eindeutig englische oder deutsche Nachrichten erkennt das Overlay schon lokal und schickt sie gar nicht erst an DeepL.
- Sehr kurze Nachrichten (unter 4 Buchstaben), reine Emote-Nachrichten und wiederholte Texte werden nicht erneut übersetzt.
- Emotes, Erwähnungen und Links bleiben unverändert.
- **Kontingent prüfen** zeigt den Verbrauch des laufenden Monats. Ist das Kontingent aufgebraucht, pausiert die Übersetzung und der Chat läuft normal weiter.

## Neu in Version 0.1.15: Stream-Untertitel (Beta)

Das Overlay kann Gesprochenes als Untertitel für die Zuschauer anzeigen. Englisch erscheint direkt, Deutsch wird ins Englische übersetzt. Das funktioniert auch, wenn beide Sprachen im selben Satz gemischt werden. Die Untertitel stehen in einem eigenen Fenster „Stream-Untertitel“, das anders als das Chat-Overlay für Aufnahmen sichtbar ist. So lässt es sich in **OBS und TikTok LIVE Studio** gleichermaßen einbinden.

Diese Beta-Version erfasst das **Mikrofon**. Der Ton des Spiels (Voice-Chat) folgt in einer späteren Version.

### Einrichtung

1. Unter [console.deepgram.com](https://console.deepgram.com/) ein Konto anlegen und einen API-Key erstellen. Neue Konten erhalten ein Startguthaben.
2. Im Overlay unter **Einstellungen → Stream-Untertitel** den Deepgram-Key speichern und **Untertitel-Fenster für den Stream** einschalten. Für die Übersetzung wird zusätzlich der DeepL-Key aus der Chat-Übersetzung verwendet; ohne ihn erscheint Deutsch unübersetzt.
3. Mikrofon auswählen und die **Sprach-Schwelle** einstellen: Beim Sprechen muss der Pegelbalken über die weiße Markierung gehen, in Ruhe darunter bleiben.
4. Das Fenster an eine passende Stelle ziehen und in der Größe anpassen. Es hat bewusst keine Titelleiste, damit im Stream nichts davon zu sehen ist. Schließen lässt es sich über den Schalter in den Einstellungen oder im Tray-Menü.

### In OBS und TikTok LIVE Studio einbinden

**Empfohlen: Browserquelle.** Sobald die Untertitel eingeschaltet sind, zeigt **Einstellungen → Stream-Untertitel → Browserquelle** eine Adresse wie `http://127.0.0.1:17873/captions`. Mit **Kopieren** landet sie in der Zwischenablage.

- **OBS:** Quelle **Browser** hinzufügen, Adresse einfügen, Breite und Höhe frei wählen (z. B. 1600 × 220).
- **TikTok LIVE Studio:** Quelle **Link** hinzufügen und die Adresse einfügen.

Die Browserquelle hat einen echten transparenten Hintergrund, zeigt keinen Mauszeiger, und der Text bricht passend zur gewählten Breite um. Die Adresse ist nur auf dem eigenen Rechner erreichbar.

**Alternative: Fensteraufnahme.** Erst mit dem Schalter **Zusätzliches Aufnahmefenster** erscheint das Fenster „Stream-Untertitel“; ohne ihn bleibt es unsichtbar. Es wird als Fensteraufnahme eingebunden, dort **Mauszeiger aufnehmen** ausschalten. Das Fenster hat einen deckenden Hintergrund (dunkel oder Grün für einen Chroma-Key) und darf verdeckt, aber nicht minimiert sein. Wer nur die Browserquelle nutzt, kann das Fenster ausschalten; das Mikrofon läuft im Hintergrund weiter.

### Aussehen

**Textfarbe**, **Schriftgröße** und **Dunkler Kasten hinter dem Text** gelten für Browserquelle und Fenster gleichermaßen und ändern sich sofort. Ohne Kasten bekommt der Text eine dunkle Kontur, damit er auf jedem Spielbild lesbar bleibt.

### Kosten und Datenschutz

- Übertragen wird nur Audio, während gesprochen wird. Stille kostet nichts. Rechne grob mit 0,50 € pro Stunde reiner Sprechzeit (Deepgram Nova-3, mehrsprachig).
- Nur deutsche Passagen gehen an DeepL; englische Sätze verbrauchen kein DeepL-Kontingent.
- Der Mikrofonzugriff ist auf das Untertitel-Fenster beschränkt. Das Chat-Overlay selbst hat weiterhin keinen Zugriff.

## Neu in Version 0.1.15: Automatische Updates

Die App sucht beim Start und danach alle vier Stunden auf GitHub Releases nach einer neuen Version, lädt sie im Hintergrund und kontrolliert ihre Prüfsumme. Wann sie installiert wird, legt **Einstellungen → Updates → „Updates installieren“** fest (ab 0.2.1):

- **Sofort beim Start** (Standard): Ist das Update in den ersten drei Minuten nach dem Start fertig geladen, installiert die App es und startet einmal neu. Später gefundene Updates warten bis zum Beenden, ein laufender Stream wird also nicht unterbrochen. Schlägt die Installation fehl, versucht die App dieselbe Version nicht noch einmal von selbst.
- **Beim Beenden:** Die App startet nie von selbst neu.
- **Nur auf Knopfdruck:** Das Update liegt bereit, bis es unter **Einstellungen → Updates** oder im Tray-Menü installiert wird.

Die **portable EXE** lädt die neue Datei ab 0.2.1 selbst herunter und ersetzt sich. Der Dateiname bleibt dabei gleich, Verknüpfungen funktionieren weiter. Die vorherige Version liegt bis zum nächsten Start als `.old` daneben. Ist der Ordner schreibgeschützt, bleibt es beim Hinweis mit Link zur Download-Seite.

In der Entwicklerversion (`npm start`) und in Builds ohne GitHub-Ziel sind Updates abgeschaltet.

### Neue Version veröffentlichen

Releases laufen automatisch über GitHub Actions (`.github/workflows/release.yml`):

1. `RELEASE-GITHUB.bat` starten. Es prüft den Code, sichert offene Änderungen, erhöht die Versionsnummer (z. B. 0.1.16 → 0.1.17) und lädt Code und Versions-Tag zu GitHub hoch.
2. GitHub testet, baut Setup und portable EXE und veröffentlicht das Release selbstständig. Den Fortschritt zeigt [github.com/MrYourself/1/actions](https://github.com/MrYourself/1/actions).
3. Installierte Apps finden das Update innerhalb von vier Stunden, laden es im Hintergrund und installieren es beim Beenden.

**Vorabversion:** Ein Tag mit Zusatz, z. B. `v0.2.1-beta.1`, wird auf GitHub als *Pre-release* veröffentlicht. Stabile Installationen ignorieren es; nur wer „Vorabversionen (Beta) erhalten“ eingeschaltet oder bereits eine Beta installiert hat, bekommt es automatisch.

Ein persönlicher GitHub-Token ist dafür nicht mehr nötig. GitHub verwendet für den Build seinen eigenen, auf dieses Repository beschränkten Token.

Ohne Code-Signatur zeigt Windows SmartScreen bei der ersten Installation „Unbekannter Herausgeber“. Die Updates selbst funktionieren trotzdem.

## Korrekturen in Version 0.1.15

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

## Korrekturen in Version 0.1.14

- TikTok-Anfangsnachrichten verwenden beim Freigeben des Verbindungspuffers ihre ursprünglichen Zeitstempel für den Spamfilter.
- Twitch-Moderationsereignisse löschen ausschließlich Twitch-Nachrichten; der lokale Knopf **Chat leeren** leert weiterhin beide Plattformen.
- Vorübergehende Fehler bei Token-Erneuerung und Kanalauflösung lösen weitere Twitch-Verbindungsversuche mit begrenztem Backoff aus. Abmeldung und veraltete Versuche stoppen diese Wiederholungen.
- Beim EventSub-Verbindungswechsel werden Ereignisse der alten Verbindung bis zur Begrüßung der neuen Verbindung weiter verarbeitet; doppelte Zustellungen werden erkannt.
- Das Twitch-Zeitlimit umfasst jetzt auch das vollständige Einlesen der HTTP-Antwort.
- 14 zusätzliche Ablauf-Tests sichern die korrigierten Fälle ab. Mit `npm run check` werden insgesamt 56 Tests ausgeführt.

Der Quellcode wurde mit simulierten Verbindungen geprüft. Ein Windows-Build und der Betrieb mit echten Twitch-/TikTok-Kanälen wurden für diese Korrekturfassung nicht getestet.

## Funktionen aus Version 0.1.13 (Live-Statistiken und vollständiger Chat)

- getrennte Zuschaueranzeigen für Twitch und TikTok direkt im Overlay
- laufende Streamdauer: bei Twitch ab dem echten Streamstart, bei TikTok mit Verbindungszeit als zuverlässigem Rückfallwert
- lokale Uhrzeit und sekundengenaue Dauer in einer kompakten, dauerhaft sichtbaren Statistikleiste
- Statistikleiste in den Einstellungen ein- und ausblendbar
- beim TikTok-Verbindungsstart eintreffende Nachrichten werden erst nach der Verlaufsauswahl freigegeben und nicht mehr überschrieben
- wiederhergestellte Nachrichten verwenden ihre echten Zeitstempel für den Spamfilter; aktive Vielschreiber verlieren dadurch keine Nachrichten mehr

## Weitere Funktionen

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

## Erster Start

1. Installiere [Node.js LTS](https://nodejs.org/), falls es noch nicht vorhanden ist.
2. Starte `STARTEN.bat`. Beim ersten Mal werden die benötigten Pakete installiert.
3. Öffne in der App die Twitch Developer Console und registriere eine neue Anwendung.
4. Verwende beispielsweise `Twitch Chat Overlay Jonas` als eindeutigen Namen. Als OAuth-Redirect-URL kann `http://localhost` eingetragen werden. Wähle, sofern angezeigt, den Client-Typ **Public**. Ein Client-Secret wird nicht benötigt.
5. Kopiere ausschließlich die öffentliche **Client-ID** in das Overlay und klicke auf **Mit Twitch anmelden**.
6. Twitch öffnet sich im Browser. Bestätige dort den angezeigten Gerätecode.

Die App fragt `user:read:chat` für EventSub, `chat:read` für die IRC-Rückfallebene und `moderator:read:followers` für neue Follows an. Für Follow-Ereignisse muss das angemeldete Twitch-Konto der Zielkanal selbst oder dort Moderator sein. Das Twitch-Passwort wird niemals an die App übergeben. Access- und Refresh-Token werden auf Windows mit der systemeigenen sicheren Speicherung verschlüsselt.

Enthält eine ältere Anmeldung noch nicht die zusätzliche Follow-Berechtigung, ist einmalig eine erneute Twitch-Anmeldung erforderlich. Neue Follows werden ab dem erfolgreichen Verbindungsaufbau angezeigt; Twitch stellt über EventSub keine rückwirkenden Follow-Ereignisse bereit. Falls nur die Follow-Berechtigung fehlt, läuft der normale Twitch-Chat weiter und die Diagnose zeigt den Grund separat an.

## TikTok einrichten

1. Öffne über das Zahnrad die Einstellungen.
2. Trage unter **TikTok-LIVE-Name** den öffentlichen Benutzernamen ohne `@` ein.
3. Sobald der Account live ist, verbindet sich das Overlay automatisch. Ist er offline, versucht die App es regelmäßig erneut.
4. Über die beiden Schalter lassen sich Geschenke sowie Follows und Shares getrennt aktivieren.

Bleibt die kostenlose Verbindung begrenzt oder meldet einen Signaturfehler, kann optional ein Euler-Stream-API-Key hinterlegt werden. Der Key wird wie die Twitch-Tokens mit der sicheren Windows-Speicherung verschlüsselt und nicht im Klartext in den Einstellungen abgelegt.

Für das reine Lesen ist kein TikTok-Login nötig. Der Zugriff verwendet den inoffiziellen `tiktok-live-connector`, weil TikTok keine öffentliche LIVE-Chat-API anbietet. Änderungen bei TikTok können diese Verbindung vorübergehend beeinträchtigen.

## Verlauf des aktuellen Streams

Twitch-Nachrichten, die das Overlay während eines laufenden Streams empfängt, werden lokal gespeichert. Beim Neustart erkennt die App über Twitchs Stream-ID, ob derselbe Stream noch läuft, und stellt nur dessen Verlauf wieder her. Beginnt ein neuer Stream oder endet der aktuelle, wird der alte Twitch-Verlauf verworfen.

Twitch stellt keinen offiziellen Endpunkt bereit, mit dem Nachrichten aus der Zeit vor dem ersten Verbindungsaufbau nachgeladen werden können. TikTok kann beim Verbinden einen kleinen aktuellen Nachrichtenpuffer liefern; dessen Umfang wird von TikTok bestimmt.

## Live-Statistiken

Die kompakte Leiste zeigt Twitch-Zuschauer, TikTok-Zuschauer, Streamdauer und die lokale Uhrzeit. Die Twitch-Zahl und der echte Twitch-Startzeitpunkt werden mit der bereits vorhandenen Streamstatus-Abfrage aktualisiert. TikTok aktualisiert seine Zuschauerzahl über die Live-Ereignisse des Chats; bis TikTok einen Wert sendet, erscheint ein Gedankenstrich. Liefert TikTok einen gültigen Startzeitpunkt, wird er verwendet; andernfalls zählt die TikTok-Dauer ab dem erfolgreichen Verbindungsaufbau. Ist Twitch live, hat dessen echte Streamdauer Vorrang.

## Bedienung

| Tastenkürzel | Funktion |
| --- | --- |
| `Strg` + `Umschalt` + `H` | Overlay anzeigen/ausblenden |
| `Strg` + `Umschalt` + `C` | Chat leeren |

Das Overlay lässt sich jederzeit an der oberen Leiste verschieben und an den Fensterkanten skalieren.

**Stream-Safe** ist standardmäßig aktiv. Das Overlay bleibt auf dem eigenen Bildschirm sichtbar, wird aber von unterstützten Bildschirmaufnahme-APIs verborgen. Die Einstellung gilt systemweit für entsprechende Aufnahmeprogramme, nicht ausschließlich für TikTok LIVE Studio. Da Aufnahmeprogramme unterschiedliche Verfahren verwenden können, sollte die Wirkung einmal in deren Vorschau kontrolliert werden.

## Windows-Build erstellen

Starte `BUILD-WINDOWS.bat`. Danach liegen im Ordner `dist` sowohl eine portable EXE als auch ein normaler Windows-Installer.

## Wichtiger Hinweis zu Spielen

Ein normales Desktop-Overlay kann über randlosem Vollbild und Fenstermodus angezeigt werden. Echtes exklusives Vollbild übernimmt die Anzeige vollständig; dort können normale Windows-Fenster nicht darüberliegen. In diesem Fall das Spiel auf **Randloses Fenster / Borderless** stellen.

## Datenschutz und Lizenzen

- Direkte Twitch-Verbindung vom PC zu Twitch
- TikTok-Verbindungsaufbau über die vom Connector verwendeten TikTok-/Signaturdienste
- Keine Speicherung des Twitch-Passworts
- Client-ID ist öffentlich und kein Geheimnis
- Token liegen verschlüsselt im Windows-Benutzerprofil
- Ein optionaler Euler-Stream-API-Key liegt ebenfalls verschlüsselt im Windows-Benutzerprofil
- Chatverläufe und Einstellungen liegen ausschließlich im lokalen Windows-Benutzerprofil

Durch die TikTok-Komponente steht Version 0.2.0 unter der GNU Affero General Public License 3.0. Der vollständige Quellcode wird zusammen mit jeder EXE bereitgestellt.
