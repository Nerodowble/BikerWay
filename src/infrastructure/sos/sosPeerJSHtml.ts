/**
 * F29.2b — HTML inline da WebView do SOS Comunitario via PeerJS.
 *
 * Modelo broker estilo "PubSub leve":
 *  - O primeiro usuario que entrar numa celula de geohash4 (~40x19km no BR
 *    sudeste) tenta registrar-se com ID deterministico
 *    `bw-sos-broker-<geohash>`. Se conseguir, vira o broker da celula.
 *  - Os demais usuarios tentam o mesmo ID, recebem `ID_TAKEN` do servidor
 *    PeerJS publico e fazem fallback pra ID aleatorio com prefixo
 *    `bw-sos-sub-<geohash>-<rand>`. Em seguida abrem uma DataConnection
 *    contra o broker.
 *  - Broker mantem `subs: Map<peerId, conn>` e re-broadcasta qualquer
 *    mensagem recebida de um sub pra TODOS os outros subs (rede em
 *    estrela; nao mesh).
 *  - Quando o broker some, os subs detectam via conn.on('close') e
 *    fazem um retry com backoff aleatorio pra registrar-se como broker.
 *    O primeiro vencedor da corrida assume.
 *
 * Audio plane NAO existe aqui — diferentemente da WebView de comboio
 * (jitsiHtml.ts), o SOS so usa DataConnection. Mais leve, sem
 * permissoes de microfone, sem getUserMedia.
 *
 * Bridge contract (RN <-> WebView):
 *  Inbound (RN -> WebView via injectJavaScript):
 *    - window.bwSosInit(geohash)
 *    - window.bwSosBroadcast(jsonString)
 *    - window.bwSosTeardown()
 *  Outbound (WebView -> RN via postMessage):
 *    - sosBridgeReady
 *    - sosBridgeError { reason, message }
 *    - sosMessage    { payload }   // payload e o JSON do remetente
 *    - sosPeerStatus { role: 'broker' | 'subscriber', subCount? }
 *
 * Versionamento via SOS_BRIDGE_VERSION exposto pra RN poder validar a
 * pagina antes de injetar comandos.
 */

export interface BuildSosPeerJSHtmlInput {
  geohash: string;
}

export const SOS_BRIDGE_VERSION = 1 as const;

function sanitizeGeohash(geohash: string): string {
  // Geohash base32: 0-9 + b-z (sem a, i, l, o). Tudo dentro de [A-Za-z0-9].
  // Sanitizamos defensivamente pra evitar injecao se o caller mandar
  // string fora do padrao.
  return geohash.replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toLowerCase();
}

export function buildSosPeerJSHtml(input: BuildSosPeerJSHtmlInput): string {
  const safeGeohash = sanitizeGeohash(input.geohash);
  // Single-string HTML — passado direto pra <WebView source={{ html, baseUrl }}>.
  // baseUrl https://localhost garante secure context (PeerJS so funciona
  // sob origem segura no Chromium).
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no" />
<title>BikerWay SOS</title>
<style>
  html, body { margin: 0; padding: 0; background: #000; color: #ddd; font-family: -apple-system, system-ui, sans-serif; font-size: 11px; }
  #log { padding: 6px 8px; line-height: 14px; white-space: pre-wrap; opacity: 0.6; }
</style>
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
</head>
<body>
<div id="log">BikerWay SOS booting...</div>
<script>
(function () {
  'use strict';

  var GEOHASH = '${safeGeohash}';
  var BROKER_ID = 'bw-sos-broker-' + GEOHASH;
  var BRIDGE_VERSION = ${SOS_BRIDGE_VERSION};

  function post(type, payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: type,
          payload: payload || null
        }));
      }
    } catch (e) { /* swallow */ }
  }
  function logLine(s) {
    try {
      var el = document.getElementById('log');
      if (el) el.textContent = String(s);
    } catch (e) {}
  }
  function err(reason, message) {
    post('sosBridgeError', { reason: String(reason || 'unknown'), message: String(message || '') });
  }

  function randomSuffix() {
    var arr = new Uint8Array(3);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    var hex = '';
    for (var i = 0; i < arr.length; i++) {
      hex += ('0' + arr[i].toString(16)).slice(-2);
    }
    return hex;
  }
  function subscriberId() { return 'bw-sos-sub-' + GEOHASH + '-' + randomSuffix(); }

  // ----- Runtime state ------------------------------------------------------
  var peer = null;
  var role = null; // 'broker' | 'subscriber'
  var subs = {};   // role=broker: peerId -> DataConnection (incoming subs)
  var brokerConn = null; // role=subscriber: outgoing DataConnection to broker
  var torn = false;
  var becomeBrokerAttempted = false;

  function notifyStatus() {
    if (!role) return;
    var payload = { role: role };
    if (role === 'broker') {
      payload.subCount = Object.keys(subs).length;
    }
    post('sosPeerStatus', payload);
  }

  // ----- Broker path --------------------------------------------------------
  function becomeBroker() {
    if (torn) return;
    if (becomeBrokerAttempted) return;
    becomeBrokerAttempted = true;
    if (peer) {
      try { peer.destroy(); } catch (e) {}
      peer = null;
    }
    role = 'broker';
    logLine('Tentando virar broker: ' + BROKER_ID);
    peer = new Peer(BROKER_ID, { debug: 0 });
    peer.on('open', function () {
      logLine('BROKER pronto (' + BROKER_ID + ')');
      post('sosBridgeReady', { role: 'broker', geohash: GEOHASH });
      notifyStatus();
    });
    peer.on('connection', function (conn) {
      // Sub abrindo conexao. Registra e ouve mensagens.
      subs[conn.peer] = conn;
      conn.on('open', function () { notifyStatus(); });
      conn.on('data', function (data) {
        // Broker recebeu de um sub. Posta no RN E reencaminha pros OUTROS
        // subs (rebroadcast). Nao manda de volta pro originador.
        deliverInbound(data);
        rebroadcast(conn.peer, data);
      });
      conn.on('close', function () {
        delete subs[conn.peer];
        notifyStatus();
      });
      conn.on('error', function () {
        delete subs[conn.peer];
        notifyStatus();
      });
    });
    peer.on('error', function (e) {
      var t = e && e.type ? e.type : 'unknown';
      if (t === 'unavailable-id') {
        // Broker ja existe — vira sub.
        logLine('Broker ID tomado. Caindo pra subscriber.');
        becomeBrokerAttempted = false;
        becomeSubscriber();
      } else {
        err(t, e && e.message ? e.message : '');
      }
    });
    peer.on('disconnected', function () {
      // Servidor PeerJS soltou a conexao. Tenta reconectar silencioso.
      try { if (peer && !peer.destroyed) peer.reconnect(); } catch (e) {}
    });
  }

  function rebroadcast(originatorId, data) {
    var ids = Object.keys(subs);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (id === originatorId) continue;
      try { subs[id].send(data); } catch (e) {}
    }
  }

  // ----- Subscriber path ----------------------------------------------------
  function becomeSubscriber() {
    if (torn) return;
    if (peer) {
      try { peer.destroy(); } catch (e) {}
      peer = null;
    }
    role = 'subscriber';
    var myId = subscriberId();
    logLine('Tentando virar subscriber (' + myId + ')');
    peer = new Peer(myId, { debug: 0 });
    peer.on('open', function () {
      logLine('SUB pronto. Conectando ao broker ' + BROKER_ID);
      openConnectionToBroker();
      post('sosBridgeReady', { role: 'subscriber', geohash: GEOHASH });
      notifyStatus();
    });
    peer.on('error', function (e) {
      var t = e && e.type ? e.type : 'unknown';
      if (t === 'peer-unavailable') {
        // Broker desapareceu enquanto a gente vivia como sub. Tenta virar broker.
        logLine('Broker sumiu — tentando reassumir como broker.');
        scheduleBrokerRetry();
      } else {
        err(t, e && e.message ? e.message : '');
      }
    });
    peer.on('disconnected', function () {
      try { if (peer && !peer.destroyed) peer.reconnect(); } catch (e) {}
    });
  }

  function openConnectionToBroker() {
    try {
      brokerConn = peer.connect(BROKER_ID, { reliable: true });
      brokerConn.on('open', function () {
        logLine('Conectado ao broker.');
        notifyStatus();
      });
      brokerConn.on('data', function (data) {
        // Mensagem rebroadcastada pelo broker. Entrega ao RN.
        deliverInbound(data);
      });
      brokerConn.on('close', function () {
        brokerConn = null;
        scheduleBrokerRetry();
      });
      brokerConn.on('error', function () {
        brokerConn = null;
        scheduleBrokerRetry();
      });
    } catch (e) {
      err('connect-failed', String(e));
      scheduleBrokerRetry();
    }
  }

  // Backoff aleatorio antes de tentar virar broker quando o atual cai.
  // Aleatorio evita "thundering herd" quando todos os subs detectam ao
  // mesmo tempo o close. Entre 500ms e 3500ms.
  function scheduleBrokerRetry() {
    if (torn) return;
    var delay = 500 + Math.floor(Math.random() * 3000);
    setTimeout(function () {
      if (torn) return;
      becomeBroker();
    }, delay);
  }

  // ----- Inbound + outbound utilities ---------------------------------------
  function deliverInbound(raw) {
    // 'raw' veio do PeerJS DataConnection — pode ser string ou objeto
    // (PeerJS faz JSON.parse automatico se reliable: true). Normalizamos
    // pra string e re-parseamos no RN via parseWireMessage.
    var payload;
    if (typeof raw === 'string') {
      try { payload = JSON.parse(raw); } catch (e) { return; }
    } else if (typeof raw === 'object' && raw !== null) {
      payload = raw;
    } else {
      return;
    }
    post('sosMessage', { payload: payload });
  }

  function sendOutbound(jsonString) {
    if (torn) return;
    var data;
    try { data = JSON.parse(jsonString); } catch (e) { return; }
    if (role === 'broker') {
      // Broker tambem entrega localmente (pra simular que ele mesmo
      // recebeu o broadcast) E manda pra todos os subs.
      deliverInbound(data);
      rebroadcast(null, data); // null = ninguem originou; manda pra todos
    } else if (role === 'subscriber') {
      if (brokerConn && brokerConn.open) {
        try { brokerConn.send(data); } catch (e) { /* swallow */ }
      }
      // Tambem entrega localmente pq o broker NAO retransmite pro
      // originador (deliveImpl filtra). Sem esse local-deliver, mensagens
      // do proprio sub nao seriam visiveis em logs/test loopback. Em
      // contrapartida, o filtro de "ownAlertIds" no RN garante que o
      // proprio piloto nao receba modal do seu proprio SOS.
      deliverInbound(data);
    }
  }

  // ----- Bridge API exposta pra RN ------------------------------------------
  window.bwSosInit = function (overrideGeohash) {
    if (typeof overrideGeohash === 'string' && overrideGeohash.length > 0) {
      var s = overrideGeohash.replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toLowerCase();
      if (s) {
        // Suporte futuro pra trocar de sala em runtime sem remontar a
        // WebView. v1 nao usa — RN faz remount via React key change.
        // Mantido como no-op pra evitar troca acidental.
        logLine('override geohash ignorado em v1 — use remount.');
      }
    }
    if (becomeBrokerAttempted) return;
    becomeBroker();
    return BRIDGE_VERSION;
  };

  window.bwSosBroadcast = function (jsonString) {
    sendOutbound(jsonString);
    return true;
  };

  window.bwSosTeardown = function () {
    torn = true;
    try { if (brokerConn) brokerConn.close(); } catch (e) {}
    brokerConn = null;
    var ids = Object.keys(subs);
    for (var i = 0; i < ids.length; i++) {
      try { subs[ids[i]].close(); } catch (e) {}
    }
    subs = {};
    if (peer) {
      try { peer.destroy(); } catch (e) {}
      peer = null;
    }
    role = null;
    return true;
  };

  // Auto-init: assim que a pagina sobe, tenta virar broker. RN nao
  // precisa chamar nada — apenas escuta os eventos.
  if (typeof Peer === 'undefined') {
    err('peerjs-missing', 'PeerJS lib failed to load');
  } else {
    becomeBroker();
  }
})();
</script>
</body>
</html>`;
}
