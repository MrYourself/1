# Twitch Chat Overlay

Ein transparentes Windows-Overlay, das den Twitch- und den TikTok-LIVE-Chat gemeinsam über dem Spiel anzeigt. Es übersetzt auf Wunsch fremdsprachige Chatnachrichten und blendet Gesprochenes als übersetzte Untertitel in den Stream ein.

**[Aktuelle Version herunterladen](https://github.com/MrYourself/1/releases/latest)** · [Änderungen je Version](CHANGELOG.md)

## Was es kann

- **Beide Chats in einem Fenster:** Twitch und TikTok LIVE, chronologisch gemischt, mit Emotes, Badges, Profilbildern, Bits, Abos, Follows und TikTok-Geschenken.
- **Immer im Vordergrund:** rahmenlos und transparent über dem Spiel; Schriftgröße, Deckkraft, Nachrichtenanzahl und Ausblendzeit sind einstellbar.
- **Stream-Safe:** Das Overlay ist nur auf dem eigenen Bildschirm sichtbar und wird vor Bildschirmaufnahmen verborgen.
- **Chat-Übersetzung:** Fremdsprachige Nachrichten werden mit DeepL übersetzt und klein unter dem Original angezeigt.
- **Stream-Untertitel:** Gesprochenes Deutsch erscheint als englischer Untertitel im Stream (oder in einer anderen Zielsprache), eingebunden als Browserquelle in OBS oder TikTok LIVE Studio.
- **Live-Statistiken:** Zuschauerzahlen beider Plattformen, Streamdauer und Uhrzeit.
- **Filter:** bekannte Bots, Chatbefehle, einzelne Nutzer, blockierte Begriffe und Spam.
- **Automatische Updates** über GitHub Releases.

## Installation

1. Auf der [Download-Seite](https://github.com/MrYourself/1/releases/latest) die Datei `Twitch-Chat-Overlay-Setup-x.y.z.exe` herunterladen und ausführen.
2. Windows zeigt beim ersten Mal „Unbekannter Herausgeber“, weil die App nicht signiert ist. Über **Weitere Informationen → Trotzdem ausführen** geht es weiter.

Die Datei ohne „Setup“ im Namen ist die portable Version: Sie läuft ohne Installation aus jedem Ordner.

## Einrichtung

### Twitch

1. Im Overlay die Twitch Developer Console öffnen und dort eine neue Anwendung registrieren.
2. Name frei wählen, als OAuth-Redirect-URL `http://localhost` eintragen und als Client-Typ **Öffentlich (Public)** wählen. Mit „Vertraulich“ läuft die Anmeldung nach wenigen Stunden ab.
3. Die **Client-ID** ins Overlay kopieren und auf **Mit Twitch anmelden** klicken.
4. Im Browser den angezeigten Gerätecode bestätigen.

Ein Client-Secret wird nicht benötigt, und das Twitch-Passwort erreicht die App nie. Jede Person braucht ihre eigene Twitch-Anwendung. Für die Anzeige neuer Follows muss das angemeldete Konto der Kanal selbst oder dort Moderator sein.

### TikTok

1. Über das Zahnrad die Einstellungen öffnen.
2. Unter **TikTok-LIVE-Name** den öffentlichen Benutzernamen ohne `@` eintragen.
3. Sobald der Account live ist, verbindet sich das Overlay von selbst.

TikTok bietet keine offizielle Chat-Schnittstelle. Das Overlay nutzt den inoffiziellen `tiktok-live-connector`; Änderungen bei TikTok können die Verbindung deshalb vorübergehend stören. Für eine zuverlässigere Verbindung lässt sich ein API-Key von [Euler Stream](https://www.eulerstream.com/) hinterlegen. Kommen keine Kommentare an, zeigt **TikTok-Protokoll öffnen** die Verbindungsversuche und Fehler.

### Chat-Übersetzung

1. Unter [deepl.com/pro-api](https://www.deepl.com/pro-api) ein kostenloses **DeepL API Free**-Konto anlegen (500.000 Zeichen pro Monat) und den API-Key kopieren.
2. Im Overlay unter **Einstellungen → Chat-Übersetzung** den Key speichern, die Übersetzung einschalten und die Zielsprache wählen.

Übersetzt wird nur, was nötig ist: Nachrichten in der Zielsprache, in den Sprachen unter **Nicht übersetzen aus**, einzelne Wörter, reine Emote-Nachrichten, ausgeblendete Bots und Spam gehen nicht an DeepL. **Kontingent prüfen** zeigt den Verbrauch des laufenden Monats.

### Stream-Untertitel

Die Untertitel sind ein Übersetzer für die Zuschauer: Wird Deutsch gesprochen, erscheint die englische Übersetzung im Stream. Was ohnehin in der Untertitel-Sprache gesprochen wird, erzeugt keinen Untertitel. Erfasst wird das Mikrofon.

1. Unter [console.deepgram.com](https://console.deepgram.com/) ein Konto anlegen und einen API-Key erstellen. Neue Konten erhalten ein Startguthaben.
2. Im Overlay unter **Einstellungen → Stream-Untertitel** den Deepgram-Key speichern und die Untertitel einschalten. Für die Übersetzung wird der DeepL-Key aus der Chat-Übersetzung verwendet.
3. Mikrofon wählen und die **Sprach-Schwelle** einstellen: Beim Sprechen geht der Pegelbalken über die weiße Markierung, in Ruhe bleibt er darunter.
4. Die Adresse unter **Browserquelle** kopieren (z. B. `http://127.0.0.1:17873/captions`) und einbinden:
   - **OBS (empfohlen):** Im Overlay auf **Lokale Datei für OBS anzeigen** klicken. In OBS eine Quelle **Browser** hinzufügen, **Lokale Datei** anhaken, die Datei `Untertitel-Quelle.html` wählen und die Größe festlegen (z. B. 1600 × 220). So erscheinen die Untertitel auch, wenn OBS vor dem Overlay gestartet oder das Overlay zwischendurch neu gestartet wurde.
   - **OBS mit Adresse:** Quelle **Browser** hinzufügen und die Adresse einfügen. Wurde OBS vor dem Overlay gestartet, muss die Quelle einmal aktualisiert werden.
   - **TikTok LIVE Studio:** Quelle **Link** hinzufügen und die Adresse einfügen.
5. Mit **Testzeile senden** prüfen, ob der Untertitel im Stream ankommt.

Weitere Optionen:

- **Nur Übersetzungen anzeigen** (Standard: an). Ausgeschaltet wird alles Gesprochene eingeblendet, auch in der Untertitel-Sprache.
- **Textfarbe**, **Schriftgröße** und **Dunkler Kasten hinter dem Text**.
- **Zusätzliches Aufnahmefenster** für Programme ohne Browserquelle; dort in der Quelle „Mauszeiger aufnehmen“ ausschalten.

Kosten: Übertragen wird nur, während gesprochen wird. Grob 0,50 € pro Stunde reiner Sprechzeit bei Deepgram; an DeepL gehen nur die zu übersetzenden Sätze. Die Browserquelle ist nur auf dem eigenen Rechner erreichbar.

## Bedienung

| Tastenkürzel | Funktion |
| --- | --- |
| `Strg` + `Umschalt` + `H` | Overlay anzeigen/ausblenden |
| `Strg` + `Umschalt` + `C` | Chat leeren |

- Das Fenster lässt sich an der oberen Leiste verschieben und an den Kanten in der Größe ändern.
- **—** blendet das Overlay aus, **✕** beendet es. Über das Symbol im Infobereich (Tray) ist es jederzeit erreichbar.
- **Spiele im exklusiven Vollbild** verdecken jedes normale Fenster. Das Spiel dafür auf **Randloses Fenster (Borderless)** stellen.
- **Stream-Safe** wirkt bei den üblichen Aufnahmeprogrammen. Die Wirkung einmal in der Vorschau von OBS oder TikTok LIVE Studio kontrollieren.

## Updates

Die App sucht beim Start und danach alle vier Stunden nach einer neuen Version, lädt sie im Hintergrund und prüft ihre Prüfsumme. Wann sie installiert wird, legt **Einstellungen → Updates → Updates installieren** fest:

- **Sofort beim Start** (Standard): Ist das Update in den ersten drei Minuten nach dem Start geladen, installiert die App es und startet einmal neu. Später gefundene Updates warten bis zum Beenden.
- **Beim Beenden:** Die App startet nie von selbst neu.
- **Nur auf Knopfdruck.**

Mit **Vorabversionen (Beta) erhalten** kommen auch Testversionen an. Die portable Version ersetzt ihre eigene Datei; der Dateiname bleibt gleich.

## Datenschutz

- Twitch wird direkt vom eigenen PC aus verbunden. Die TikTok-Verbindung läuft über TikTok und den Signaturdienst des Connectors.
- Anmeldung und alle API-Keys liegen mit der Windows-eigenen Verschlüsselung im Benutzerprofil, getrennt je PC und Windows-Konto.
- Chatverlauf und Einstellungen bleiben auf dem eigenen Rechner.
- Chat-Übersetzung sendet die zu übersetzenden Nachrichten an DeepL, die Untertitel senden Mikrofonton an Deepgram und die zu übersetzenden Sätze an DeepL. Beides ist ausgeschaltet, bis ein Key gespeichert und die Funktion aktiviert wird.

## Für Entwickler

Voraussetzung ist [Node.js LTS](https://nodejs.org/).

| Befehl | Zweck |
| --- | --- |
| `npm install` | Abhängigkeiten installieren |
| `npm start` | Entwicklerversion starten (eigener Datenordner, Updates abgeschaltet); `STARTEN.bat` erledigt beides |
| `npm run check` | Syntaxprüfung und Tests |

Releases baut GitHub Actions (`.github/workflows/release.yml`), sobald ein Versions-Tag hochgeladen wird: `v0.2.2` wird eine stabile Version, ein Tag mit Zusatz wie `v0.2.3-beta.1` eine Vorabversion. `RELEASE-GITHUB.bat` prüft den Code, erhöht die Versionsnummer und lädt Code und Tag hoch.

## Lizenz

GNU Affero General Public License 3.0, bedingt durch die TikTok-Komponente. Der vollständige Quellcode liegt in diesem Repository.
