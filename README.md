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

## Nächste Ausbaustufe

Der Raumcode und die Spieleransicht sind bereits als eigene UI-Flächen angelegt. Für echtes Beitreten per Handy kann als nächster Schritt ein kleines Backend (z. B. WebSocket/Socket.IO) ergänzt werden; der Raumzustand sollte dann serverseitig verwaltet und an alle Clients verteilt werden.
