# ShitHad

Lokaler React-Prototyp für das Kartenspiel ShitHad. Die aktuelle Version zeigt einen Spielraum mit Demo-Spielern, Kartenstapeln, Handkarten sowie offenen und verdeckten Karten.

## Lokal starten

Voraussetzung: Node.js 18 oder neuer.

```bash
npm install
npm run dev
```

Danach die angezeigte lokale URL (standardmäßig `http://localhost:5173`) im Browser öffnen. Mit `npm run build` wird ein deploybares Produktions-Bundle in `dist/` erzeugt.

## Im gleichen WLAN beitreten

Starte auf dem Computer, der den Raum hostet:

```bash
npm run dev
```

Ermittle die lokale IP-Adresse des Computers:

```bash
ipconfig getifaddr en0
```

Falls das nichts ausgibt, probiere `en1`. Teile diese Adresse mit Port `5173`, zum Beispiel:

```text
http://192.168.1.42:5173
```

Alle Mitspieler müssen im selben WLAN sein. Sie öffnen die Adresse auf dem Handy, tragen ihren Namen und denselben Raumcode ein und wählen **Raum beitreten**. Die Teilnehmerliste wird über den lokalen WebSocket-Server auf Port `3001` live synchronisiert. Falls macOS nach einer Firewall-Freigabe fragt, muss Node den Zugriff erlauben.

## Auf Vercel veröffentlichen

Das Frontend kann direkt aus diesem GitHub-Repository auf Vercel importiert werden:

1. Auf [vercel.com/new](https://vercel.com/new) anmelden.
2. `tim2024git/ShitHad` importieren.
3. Framework **Vite** auswählen und deployen.

Vercel hostet damit die Oberfläche. Der aktuelle WebSocket-Server in `server.js` braucht weiterhin einen laufenden Node-Host (zum Beispiel Railway, Render oder einen eigenen Server). Nach dem Deployment muss in Vercel die Umgebungsvariable `VITE_WS_URL` auf die sichere WebSocket-Adresse dieses Servers gesetzt werden, zum Beispiel `wss://shithad-server.example.com`. Danach neu deployen.

Ohne `VITE_WS_URL` zeigt die Startseite auf einer Vercel-Domain bewusst eine klare Konfigurationsmeldung statt eines irreführenden „Server nicht erreichbar“. Lokal verbindet sich die Anwendung automatisch mit Port `3001`. Räume können über **Raum erstellen** neu erzeugt oder über **Raum betreten** per Code geöffnet werden.

## Nächste Ausbaustufe

Der Raumcode und die Spieleransicht sind bereits als eigene UI-Flächen angelegt. Für echtes Beitreten per Handy kann als nächster Schritt ein kleines Backend (z. B. WebSocket/Socket.IO) ergänzt werden; der Raumzustand sollte dann serverseitig verwaltet und an alle Clients verteilt werden.
