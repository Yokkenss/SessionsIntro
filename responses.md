# session-authentifizierung

start: `npm install`, dann `npm start`. `.env` enthält `PORT=3000` und einen langen zufälligen `SESSION_SECRET`. sie bleibt außerhalb von git. `npm run check` lief ohne fehler.

## 1. sessions und zähler

mit einer neuen cookie-datei getestet:

```powershell
curl.exe -i http://localhost:3000/visits
curl.exe -i -c cookies.txt -b cookies.txt http://localhost:3000/visits
curl.exe -i -c cookies.txt -b cookies.txt http://localhost:3000/visits
```

ohne cookie → 200
{"sessionId":"fDmUta0gBfKPcREOEEXRYz77P25ABLUe","visits":1}

cookie-datei zuerst leer → 200
{"sessionId":"H46no95zw8kMT1O2v7h80XCPdnDsDVqL","visits":1}

gespeichertes cookie → 200
{"sessionId":"H46no95zw8kMT1O2v7h80XCPdnDsDVqL","visits":2}


beim ersten und zweiten aufruf entsteht jeweils eine neue session. beim dritten erkennt der server die session am cookie und zählt weiter.

![connect.sid in chrome devtools](screenshots/cookie-devtools.png)

im browser: `httpOnly: true`, `secure: false`, `sameSite: lax`. ablauf: 2026-11-16 um 19:03:47 utc, also 30 minuten nach dem setzen. express-session setzt dafür `Expires`. der browser hat eine eigene session, getrennt von curl.

`MemoryStore` speichert sessions im node-prozess. neustarts löschen sie, viele sessions brauchen viel speicher und mehrere server teilen die daten nicht. alternativen: redis mit `connect-redis` oder mongodb mit `connect-mongo`. [quelle: express-session](https://expressjs.com/en/resources/middleware/session/)

## 2. registrierung und login

getestet mit `anna@example.com`, name `anna`, passwort `geheim123`:

registrieren → 201
{"id":1,"email":"anna@example.com","name":"anna"}

login mit falschem passwort → 401
{"error":"ungültige zugangsdaten"}

richtiger login → 200
{"message":"login erfolgreich","name":"anna"}


zusätzlich geprüft: doppelte email → `409`; fehlende felder, falsche datentypen oder zu kurzes passwort → `400`. zwei gleichzeitige registrierungen derselben email ergaben `201` und `409`. der hash wird nie zurückgegeben.

bcrypt ist absichtlich langsam und erschwert das raten von passwörtern. sha-256 wäre dafür zu schnell. ein salt ist ein zufallswert pro hash: gleiche passwörter bekommen verschiedene hashes. der cost factor bestimmt den aufwand, hier 10. ein schritt mehr verdoppelt ungefähr die arbeit. wegen der bcrypt-grenze lehnt der code passwörter über 72 bytes ab. [quelle: owasp](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

unbekannte email und falsches passwort liefern dieselbe `401`-antwort. so verrät die fehlermeldung keine vorhandenen konten.

session-id vor dem login: `H46no95zw8kMT1O2v7h80XCPdnDsDVqL`, danach: `we13n1ri7pQjjgTCXlSH4HU2WtFflS1X`. `req.session.regenerate()` ersetzt die alte session. danach werden `userId` gesetzt und die session gespeichert.

## 3. geschützte routen und logout

der server lief zwischen registrierung und gesamttest weiter:

/me ohne cookie → 401: nicht angemeldet
{"error":"nicht angemeldet"}

login → 200: passwort stimmt
{"message":"login erfolgreich","name":"anna"}

/me mit cookie → 200: gültige session
{"id":1,"email":"anna@example.com","name":"anna"}

logout → 200: session zerstört, cookie gelöscht
{"message":"logout erfolgreich"}

/me danach → 401: anmeldung beendet
{"error":"nicht angemeldet"}


auch eine vor dem logout kopierte cookie-version bekam danach `401`. die session fehlt auf dem server; die alte id ist damit wertlos.

- `httpOnly`: javascript kann das cookie nicht lesen. das erschwert cookie-diebstahl durch xss, verhindert aber nicht xss selbst.
- `sameSite: "lax"`: beschränkt cookies bei anfragen von fremden websites und hilft gegen csrf.
- `secure: isProduction`: in produktion nur https, damit das cookie nicht unverschlüsselt übertragen wird. bei unserem lokalen http würde express-session mit `secure: true` kein cookie setzen.
- `maxAge`: cookie-laufzeit von 30 minuten.

[quellen: cookie-attribute](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), [express-session](https://expressjs.com/en/resources/middleware/session/)

## 4. verständnisfragen

**1. warum ist http zustandslos?** jede anfrage steht für sich. das cookie liefert eine session-id, über die der server die passende session wiederfindet. das zeigt der zähler-test.

**2. was steht wo?** im cookie stehen id und signatur. zähler und `userId` liegen in der server-session, benutzerdaten und hashes im array `users`. interne daten bleiben so beim server. ein gestohlenes gültiges cookie bleibt trotzdem gefährlich.

**3. wozu dient der schlüssel?** `SESSION_SECRET` signiert cookies, verschlüsselt sie aber nicht. wer ihn kennt, kann gültige signaturen erzeugen. für den zugriff auf ein fremdes konto braucht er trotzdem eine passende aktive session-id; der schlüssel allein erstellt keine angemeldete server-session.

**4. resave und saveuninitialized?** `resave: false` speichert unveränderte sessions nicht komplett neu. `saveUninitialized: false` speichert neue, unveränderte sessions nicht und setzt kein cookie. das spart speicher und vermeidet unnötige cookies. es hilft beim datenschutz, entscheidet aber allein nicht über ein cookie-banner. `/` setzt bei uns kein cookie, `/visits` schon.

**5. session fixation?** ein angreifer gibt dem opfer eine bekannte session-id vor. `regenerate()` ersetzt sie beim login. im test änderte sich die id; das alte cookie erhielt bei `/me` keinen zugriff.

**6. csrf?** eine fremde website löst eine unerwünschte aktion mit der anmeldung des opfers aus. `sameSite` blockiert viele solche anfragen, aber etwa get-navigationen bleiben möglich. deshalb keine wichtigen änderungen per get; zusätzlich csrf-tokens oder origin-prüfungen verwenden.

**7. sessions oder jwt?** bei sessions verweist die id auf server-daten. ein signiertes jwt enthält selbst daten, die der server anhand der signatur prüft. sein inhalt ist normalerweise lesbar.

- session: sofort sperrbar und zustand zentral aktuell. nachteile: braucht speicher im store und einen gemeinsamen store bei mehreren servern.
- jwt ohne sperrliste: keine session-abfrage nötig und von mehreren diensten prüfbar. nachteile: sofortiges sperren ist aufwendig und enthaltene rechte können veralten.

**8. mehrere server?** jeder `MemoryStore` kennt nur seine eigenen sessions. nach einem serverwechsel kann die anmeldung fehlen. lösung: gemeinsamer store wie redis und gleiche signaturschlüssel.

**9. produktivbetrieb?** https schützt die übertragung, rate limiting bremst passwortversuche und session-timeouts begrenzen die nutzungsdauer gestohlener cookies. außerdem braucht man dauerhafte benutzerdaten und einen geeigneten session-store.
