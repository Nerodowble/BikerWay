export interface BuildJitsiHtmlInput {
  roomName: string;
  displayName: string;
  startMuted?: boolean;
}

/**
 * PeerJS-based replacement for the previous Jitsi-direct-URL strategy.
 *
 * Exports keep their Jitsi-era names because call sites (JitsiWebView,
 * shared/components/voice/index.ts, ...) still import them by those names.
 *
 * Strategy: WebView loads `source={{ html, baseUrl: 'https://localhost' }}`.
 * The baseUrl is REQUIRED — Chromium WebViews only expose `getUserMedia`
 * under a secure-context origin and `https://localhost` qualifies.
 *
 * `buildJitsiUrl()` returns `'about:blank'` purely for back-compat.
 * `buildJitsiInjectedJs()` returns a no-op (all logic lives in the HTML).
 * Bridge wire format (postMessage payloads) is unchanged so JitsiWebView's
 * BridgeMessage union and onMessage handler keep working unmodified.
 *
 * Signaling is isolated behind the `transport` object inside the HTML;
 * see the comment block at the top of the HTML for its 4-function
 * contract and how to swap PeerJS for Supabase Realtime / WS / Firebase.
 */

export function buildJitsiUrl(_input: BuildJitsiHtmlInput): string {
  // Kept for API back-compat with older import sites. The actual WebView
  // source is now the inline HTML returned by buildJitsiHtml.
  return 'about:blank';
}

/**
 * Returns a tiny no-op script. The full bridge logic now lives inline in the
 * HTML returned by buildJitsiHtml, because the HTML needs to start running
 * BEFORE we have a useful place to inject from. Kept as an export so
 * JitsiWebView's `injectedJavaScript` prop wiring stays untouched.
 */
export function buildJitsiInjectedJs(): string {
  return '(function(){return true;})();true;';
}

function jsonEscape(value: string): string {
  // Embed a user-supplied string safely into a single-quoted JS literal
  // generated inside an HTML <script>. We escape `\` and `'` and also
  // forward-slash-then-script termination.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/\r?\n/g, '\\n');
}

function sanitizeRoom(roomName: string): string {
  // PeerJS ids must match [A-Za-z0-9_-]. Our internal room names already
  // do, but be defensive — anything outside that set could later break
  // when used as a substring of a Peer id.
  return roomName.replace(/[^A-Za-z0-9_-]/g, '');
}

export function buildJitsiHtml(input: BuildJitsiHtmlInput): string {
  const safeRoom = sanitizeRoom(input.roomName);
  const safeDisplay = jsonEscape(input.displayName);
  const startMuted = input.startMuted === true ? 'true' : 'false';

  // Single-string HTML so it can be passed directly to `source={{ html }}`.
  // PeerJS is loaded from unpkg; if the device is offline the page emits a
  // `bridgeError` and the React Native layer surfaces it via onError.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no" />
<title>BikerWay Voice</title>
<style>
  html, body { margin: 0; padding: 0; background: #000; color: #ddd; font-family: -apple-system, system-ui, sans-serif; }
  #log { position: fixed; left: 0; right: 0; top: 0; padding: 6px 8px; font-size: 11px; line-height: 14px; white-space: pre-wrap; opacity: 0.7; }
  audio { display: none; }
</style>
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
</head>
<body>
<!--
  TRANSPORT CONTRACT — re-implement these 4 functions on top of Supabase
  Realtime / a custom WS / Firebase RTDB to swap signaling without
  touching the rest of this page:
    1. transport.init(opts)            bootstrap signaling; call opts.onReady(myId, isHost) once ready
    2. transport.announce()            tell peers we exist (PeerJS handles this implicitly; no-op here)
    3. transport.onPeerListChanged(cb) register listener fired with current peer-id array
    4. transport.dispose()             tear down all sockets/peer/listeners
  The audio plane (getUserMedia + RTCPeerConnection) is OWNED by the
  surrounding script — the transport only does discovery.
-->
<div id="log">BikerWay voice booting...</div>
<script>
(function () {
  'use strict';

  // ----- React Native bridge --------------------------------------------------
  function post(type, payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: type, payload: payload || null })
        );
      }
    } catch (e) { /* swallow */ }
  }
  function logLine(s) {
    try {
      var el = document.getElementById('log');
      if (el) el.textContent = String(s);
    } catch (e) { /* swallow */ }
  }
  function err(reason, message) {
    post('bridgeError', { reason: String(reason || 'unknown'), message: String(message || '') });
  }

  // ----- Constants ------------------------------------------------------------
  var ROOM = '${safeRoom}';
  var DISPLAY_NAME = '${safeDisplay}';
  var START_MUTED = ${startMuted};
  var HOST_ID = 'bw-' + ROOM + '-host';

  function randomSuffix() {
    // 6 hex chars is enough for a small mesh, and matches PeerJS id grammar.
    var arr = new Uint8Array(3);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    var hex = '';
    for (var i = 0; i < arr.length; i++) {
      hex += ('0' + arr[i].toString(16)).slice(-2);
    }
    return hex;
  }
  function guestId() { return 'bw-' + ROOM + '-' + randomSuffix(); }

  // ----- Runtime state --------------------------------------------------------
  var localStream = null;
  var peer = null;             // PeerJS Peer instance
  var myId = null;
  var isHost = false;
  var muted = !!START_MUTED;

  // peerId -> { call?: MediaConnection, conn?: DataConnection, audioEl?: HTMLAudioElement }
  var remotes = {};
  var peerListListeners = [];
  var notifiedJoin = false;

  // ----- Silent reconnect state ----------------------------------------------
  // We never surface a transient network drop as a user-visible banner.
  // Instead we post 'voice-status' messages ('reconnecting' / 'connected')
  // so the RN store can flip the badge to yellow and back, and we drive a
  // capped exponential backoff (2s, 4s, 8s, 16s, 30s, 30s, ...) from inside
  // the WebView. PeerJS' own auto-reconnect cannot survive a long offline
  // window so we keep retrying explicitly until the server accepts us back.
  var reconnectAttempt = 0;
  var reconnectTimer = null;
  var lastPostedStatus = null;
  var BACKOFF_STEPS_MS = [2000, 4000, 8000, 16000, 30000];

  function postStatus(status) {
    if (lastPostedStatus === status) return;
    lastPostedStatus = status;
    post('voice-status', { status: status });
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      try { clearTimeout(reconnectTimer); } catch (e) { /* swallow */ }
      reconnectTimer = null;
    }
  }

  function backoffDelay(attempt) {
    // attempt is 1-indexed; clamp into BACKOFF_STEPS_MS bounds.
    var idx = attempt - 1;
    if (idx < 0) idx = 0;
    if (idx >= BACKOFF_STEPS_MS.length) idx = BACKOFF_STEPS_MS.length - 1;
    return BACKOFF_STEPS_MS[idx];
  }

  function scheduleReconnect() {
    if (!peer) return;
    if (reconnectTimer !== null) return; // already scheduled
    reconnectAttempt += 1;
    var delay = backoffDelay(reconnectAttempt);
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      tryReconnect();
    }, delay);
  }

  function tryReconnect() {
    if (!peer) return;
    // Peer.disconnected becomes false again once the signaling socket reopens;
    // peer.destroyed means we tore the session down on purpose and should NOT
    // try to revive it.
    if (peer.destroyed) {
      clearReconnectTimer();
      return;
    }
    if (!peer.disconnected) {
      // Already back online — re-establish missing media calls and stop.
      onReconnectSucceeded();
      return;
    }
    try {
      peer.reconnect();
    } catch (e) { /* swallow */ }
    // Whether or not reconnect threw, schedule the next attempt with a
    // longer delay. The 'open' / 'disconnected' handlers below will clear
    // or reschedule as needed once PeerJS surfaces the outcome.
    scheduleReconnect();
  }

  function onReconnectSucceeded() {
    clearReconnectTimer();
    reconnectAttempt = 0;
    // Re-call peers that previously had an audio call attached but lost it
    // during the outage. registerRemote keeps the displayName so the row
    // labels survive across the drop.
    var ids = Object.keys(remotes);
    for (var i = 0; i < ids.length; i++) {
      var pid = ids[i];
      var entry = remotes[pid];
      if (!entry) continue;
      var hadCall = !!entry.call;
      // Drop the dead MediaConnection ref so callPeer() does not short-circuit.
      if (hadCall) {
        try { if (entry.call && entry.call.close) entry.call.close(); } catch (e) {}
        entry.call = null;
      }
      // Guests should re-issue the host call; host waits for incoming calls.
      if (!isHost || hadCall) {
        callPeer(pid);
      }
    }
    // If the guest's data link to the host was torn down during the outage
    // (which fires conn.on(close) -> detachRemote(HOST_ID)), the host is
    // no longer in remotes. Rebuild it the same way we did on boot so the
    // mesh fully recovers and peer-list propagation resumes.
    if (!isHost && !remotes[HOST_ID] && myId) {
      try { connectToHostAsGuest(); } catch (e) { /* swallow */ }
    }
    postStatus('connected');
  }

  function listKnownPeers() {
    return Object.keys(remotes);
  }
  function notifyPeerList() {
    var list = listKnownPeers();
    peerListListeners.forEach(function (cb) {
      try { cb(list.slice()); } catch (e) { /* swallow */ }
    });
  }

  // ----- Audio element wrangling ---------------------------------------------
  function attachRemoteStream(peerId, stream) {
    var entry = remotes[peerId] || (remotes[peerId] = {});
    if (entry.audioEl && entry.audioEl.srcObject === stream) return;
    if (entry.audioEl) {
      try { entry.audioEl.srcObject = null; entry.audioEl.remove(); } catch (e) {}
    }
    var el = document.createElement('audio');
    el.autoplay = true;
    el.playsInline = true;
    el.setAttribute('playsinline', 'true');
    el.dataset.peerId = peerId;
    el.srcObject = stream;
    document.body.appendChild(el);
    entry.audioEl = el;
    // Best-effort play() — some WebViews require an explicit kick.
    try { var p = el.play(); if (p && p.catch) p.catch(function () { /* ignored */ }); } catch (e) {}
  }
  function detachRemote(peerId) {
    var entry = remotes[peerId];
    if (!entry) return;
    try { if (entry.call && entry.call.close) entry.call.close(); } catch (e) {}
    try { if (entry.conn && entry.conn.close) entry.conn.close(); } catch (e) {}
    try { if (entry.audioEl) { entry.audioEl.srcObject = null; entry.audioEl.remove(); } } catch (e) {}
    delete remotes[peerId];
    post('participantLeft', { id: peerId });
    notifyPeerList();
  }

  // Register a remote peer with an optional display name. If we hear the
  // peer twice - once via "call" (no name yet) and once via "hello" or
  // "peer-list" (with a name) - we re-post participantJoined whenever the
  // name changes from blank to real so the RN UI updates.
  function registerRemote(peerId, displayName) {
    if (!peerId || peerId === myId) return false;
    var entry = remotes[peerId];
    var name = typeof displayName === 'string' ? displayName : '';
    if (!entry) {
      remotes[peerId] = { displayName: name };
      post('participantJoined', { id: peerId, displayName: name });
      notifyPeerList();
      return true;
    }
    // Already known — update name if we just learned a better one.
    if (name && entry.displayName !== name) {
      entry.displayName = name;
      // Re-emit so the host UI replaces the empty placeholder.
      post('participantJoined', { id: peerId, displayName: name });
    }
    return false;
  }

  // ============================================================================
  // transport — pluggable signaling/discovery layer.
  //
  // To migrate to Supabase Realtime / custom WS / Firebase RTDB, replace the
  // body of this object. The four functions documented at the top of the file
  // are the entire contract.
  // ============================================================================
  var transport = {
    _peer: null,
    _onPeer: null,
    _onReady: null,
    _onError: null,

    init: function (opts) {
      var self = this;
      self._onPeer = opts.onPeer || function () {};
      self._onReady = opts.onReady || function () {};
      self._onError = opts.onError || function () {};

      // Step 1: try to claim the deterministic host id. If it is taken,
      // PeerJS fires an "unavailable-id" error and we fall back to guest.
      function startAs(id) {
        try {
          // pingInterval keeps the signaling socket warm — the default is
          // 5000ms and PeerJS only declares the socket dead after a missed
          // ping. We make it explicit here so a future PeerJS default change
          // does not silently regress our heartbeat cadence.
          var p = new Peer(id, { debug: 1, pingInterval: 5000 });
          self._peer = p;
          self._onPeer(p, id === HOST_ID);
          p.on('open', function (openedId) {
            // Any 'open' after the first one means PeerJS just succeeded a
            // .reconnect() — surface it as 'connected' so the RN badge
            // flips back from yellow to green.
            self._onReady(openedId, id === HOST_ID);
            onReconnectSucceeded();
          });
          // 'disconnected' is emitted when the signaling socket drops but
          // PeerJS still considers the local Peer object usable. We must
          // call .reconnect() ourselves — PeerJS does not auto-reconnect.
          p.on('disconnected', function () {
            postStatus('reconnecting');
            scheduleReconnect();
          });
          p.on('error', function (e) {
            var t = e && e.type ? String(e.type) : 'peer_error';
            if (t === 'unavailable-id' && id === HOST_ID) {
              // Recoverable: someone already hosts this room.
              try { p.destroy(); } catch (ee) {}
              self._peer = null;
              startAs(guestId());
              return;
            }
            // Silent recovery for any transient transport/server error: we
            // never propagate these as bridgeError messages because the RN
            // layer would surface them as a banner/modal. Just keep retrying.
            if (
              t === 'network' ||
              t === 'disconnected' ||
              t === 'server-error' ||
              t === 'socket-error' ||
              t === 'socket-closed'
            ) {
              postStatus('reconnecting');
              scheduleReconnect();
              return;
            }
            self._onError(t, e && e.message ? e.message : '');
          });
        } catch (ex) {
          self._onError('peer_construct_failed', ex && ex.message ? ex.message : String(ex));
        }
      }
      startAs(HOST_ID);
    },

    announce: function () {
      // PeerJS-specific behaviour: host has nothing to broadcast on its own,
      // it just waits for guests to connect. Guests will be told to send a
      // hello message inside the script (see onPeer wire-up below).
      // Kept as a no-op for transport-contract symmetry.
    },

    onPeerListChanged: function (cb) {
      if (typeof cb === 'function') peerListListeners.push(cb);
    },

    dispose: function () {
      // Cancel any pending silent-reconnect retry so a user-initiated hangup
      // doesn't accidentally revive the peer 8s later (PeerJS would happily
      // succeed if the network came back in the meantime).
      clearReconnectTimer();
      reconnectAttempt = 0;
      lastPostedStatus = null;
      peerListListeners.length = 0;
      try { if (this._peer) this._peer.destroy(); } catch (e) {}
      this._peer = null;
    }
  };

  // ----- Mute helpers exposed to React Native --------------------------------
  function applyMuteToTracks() {
    if (!localStream) return;
    var tracks = localStream.getAudioTracks();
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].enabled = !muted;
    }
  }
  window.bwToggleMute = function () {
    muted = !muted;
    applyMuteToTracks();
    post('audioMuteStatusChanged', { muted: muted });
    return true;
  };
  window.bwSetMuted = function (b) {
    muted = !!b;
    applyMuteToTracks();
    post('audioMuteStatusChanged', { muted: muted });
    return true;
  };
  window.bwHangup = function () {
    try {
      // Close all calls + data connections.
      Object.keys(remotes).forEach(function (pid) { detachRemote(pid); });
      if (localStream) {
        var tracks = localStream.getTracks();
        for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) {} }
      }
      localStream = null;
      transport.dispose();
      post('videoConferenceLeft', { roomName: ROOM });
    } catch (e) {
      err('hangup_threw', e && e.message ? e.message : String(e));
    }
    return true;
  };
  window.bwGetState = function () {
    return {
      hasAPP: !!peer,
      hasConference: !!myId,
      isJoined: !!myId,
      isLocalAudioMuted: muted,
      memberCount: listKnownPeers().length,
    };
  };

  // ----- Position broadcast (Fase 8) -----------------------------------------
  // Fan our latest GPS fix out to every open DataConnection in the mesh.
  // Short keys ('lat','lng','hd','sp','ts') keep each packet small enough
  // to slip into a single DataChannel frame at our 3s cadence — full keys
  // would more than double the payload over hundreds of broadcasts per ride.
  // Each call is best-effort; a closed conn just fails silently so the rest
  // of the mesh keeps receiving updates.
  window.bwSendPosition = function (lat, lng, hd, sp) {
    // Pause the 3s GPS broadcast while the signaling socket is down — the
    // DataConnections are technically still 'open' for a few seconds after
    // a network drop, so without this guard we keep queuing packets that
    // will be dropped at the WebRTC layer and waste CPU/battery. Resumes
    // automatically the next tick after peer.reconnect() succeeds.
    if (!peer || peer.disconnected || peer.destroyed) return false;
    var pkt = { type: 'pos', id: myId, name: DISPLAY_NAME, lat: lat, lng: lng, hd: hd, sp: sp, ts: Date.now() };
    Object.keys(remotes).forEach(function (pid) {
      var entry = remotes[pid];
      if (entry && entry.conn && entry.conn.open) {
        try { entry.conn.send(pkt); } catch (e) { /* swallow */ }
      }
    });
    return true;
  };

  // Forwards a "pos" packet to React Native via the bridge. Shared by both
  // the host inbound conn handler and the guest outbound-then-callback
  // conn handler so neither path silently drops position updates.
  function emitPeerPosition(data, conn) {
    post('peerPositionUpdate', {
      id: String((data && data.id) || (conn && conn.peer) || ''),
      displayName: typeof data.name === 'string' ? data.name : '',
      latitude: Number(data.lat),
      longitude: Number(data.lng),
      heading: typeof data.hd === 'number' ? data.hd : null,
      speed: typeof data.sp === 'number' ? data.sp : null,
      timestamp: typeof data.ts === 'number' ? data.ts : Date.now(),
    });
  }

  // ----- Peer event wiring (host + guest both run this) ----------------------
  function wirePeer(p, predictedHost) {
    // Inbound DATA connection - host receives this from guests.
    p.on('connection', function (conn) {
      conn.on('open', function () {
        var pid = conn.peer;
        // Register FIRST so registerRemote can emit participantJoined for new
        // peers; then attach the conn to the entry afterwards. Pre-creating
        // remotes[pid] before calling registerRemote was the silent killer of
        // host-info / peer-list propagation: registerRemote saw the existing
        // entry and returned wasNew=false, so the conditional sends below
        // never fired.
        registerRemote(pid, '');
        var entry = remotes[pid];
        if (entry) entry.conn = conn;
      });
      conn.on('data', function (data) {
        try {
          if (!data || typeof data !== 'object') return;
          if (data.type === 'hello') {
            var pid = String(data.id || conn.peer || '');
            var nm = typeof data.name === 'string' ? data.name : '';
            registerRemote(pid, nm);
            // Host broadcasts host-info + peer-list whenever a hello arrives,
            // not only on first connection. This handles late-joining guests
            // and recovers if the first broadcast was dropped.
            if (isHost) {
              try {
                conn.send({ type: 'host-info', id: myId, name: DISPLAY_NAME });
              } catch (e) { /* swallow */ }
              broadcastPeerList();
            }
          } else if (data.type === 'host-info') {
            registerRemote(String(data.id || conn.peer || ''), String(data.name || ''));
          } else if (data.type === 'pos') {
            emitPeerPosition(data, conn);
          }
        } catch (e) { /* swallow */ }
      });
      conn.on('close', function () { detachRemote(conn.peer); });
      conn.on('error', function () { /* keep mesh resilient */ });
    });

    // Inbound CALL — answer with our local stream and attach inbound audio.
    p.on('call', function (call) {
      try {
        call.answer(localStream || undefined);
      } catch (e) {
        err('call_answer_failed', e && e.message ? e.message : String(e));
        return;
      }
      var pid = call.peer;
      // PeerJS passes the caller metadata at call.metadata - we stuff the
      // display name in there when we initiate, so the answerer can label
      // the row right away.
      var callerName = '';
      try {
        if (call.metadata && typeof call.metadata.name === 'string') {
          callerName = call.metadata.name;
        }
      } catch (e) { /* swallow */ }
      var entry = remotes[pid] || (remotes[pid] = {});
      entry.call = call;
      registerRemote(pid, callerName);
      call.on('stream', function (remoteStream) {
        attachRemoteStream(pid, remoteStream);
      });
      call.on('close', function () { detachRemote(pid); });
      call.on('error', function () { /* swallow */ });
    });
  }

  function broadcastPeerList() {
    // Send (id, name) pairs so guests can display labels correctly without
    // each needing to negotiate a separate hello round-trip with every peer.
    var pairs = Object.keys(remotes).map(function (pid) {
      var entry = remotes[pid] || {};
      return { id: pid, name: entry.displayName || '' };
    });
    Object.keys(remotes).forEach(function (pid) {
      var entry = remotes[pid];
      if (entry && entry.conn && entry.conn.open) {
        try { entry.conn.send({ type: 'peer-list', peers: pairs }); } catch (e) {}
      }
    });
  }

  function callPeer(targetId) {
    if (!localStream || !peer || !targetId || targetId === myId) return;
    if (remotes[targetId] && remotes[targetId].call) return; // already calling
    try {
      // Stash our DISPLAY_NAME in the call metadata so the receiver can
      // render the row label even before any data-channel hello arrives.
      var call = peer.call(targetId, localStream, {
        metadata: { name: DISPLAY_NAME },
      });
      if (!call) return;
      var entry = remotes[targetId] || (remotes[targetId] = {});
      entry.call = call;
      call.on('stream', function (remoteStream) {
        registerRemote(targetId);
        attachRemoteStream(targetId, remoteStream);
      });
      call.on('close', function () { detachRemote(targetId); });
      call.on('error', function () { /* swallow */ });
    } catch (e) {
      err('outbound_call_threw', e && e.message ? e.message : String(e));
    }
  }

  function connectToHostAsGuest() {
    if (!peer) return;
    var conn = peer.connect(HOST_ID, { reliable: true });
    conn.on('open', function () {
      // Order matters: registerRemote FIRST so it emits participantJoined
      // for the host. If we pre-create remotes[HOST_ID] before calling
      // registerRemote, registerRemote sees the entry already exists and
      // skips the event - the host never shows up in the guest UI.
      registerRemote(HOST_ID, '');
      var hostEntry = remotes[HOST_ID];
      if (hostEntry) hostEntry.conn = conn;
      try { conn.send({ type: 'hello', id: myId, name: DISPLAY_NAME }); } catch (e) {}
      // Also initiate an audio call up to the host.
      callPeer(HOST_ID);
    });
    conn.on('data', function (data) {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'host-info') {
        // The host just told us its name — store it so the row labels
        // "Willian - PCX 2020" instead of "Piloto" once the call completes.
        registerRemote(String(data.id || HOST_ID), String(data.name || ''));
      } else if (data.type === 'pos') {
        emitPeerPosition(data, conn);
      } else if (data.type === 'peer-list' && Array.isArray(data.peers)) {
        data.peers.forEach(function (entry) {
          var pid;
          var name = '';
          if (entry && typeof entry === 'object') {
            pid = entry.id;
            name = typeof entry.name === 'string' ? entry.name : '';
          } else {
            pid = entry; // back-compat with the old ID-only format
          }
          if (!pid || pid === myId) return;
          var isNew = !remotes[pid];
          registerRemote(pid, name);
          if (isNew && pid !== HOST_ID) {
            callPeer(pid);
          }
        });
      }
    });
    conn.on('close', function () { detachRemote(HOST_ID); });
    conn.on('error', function () { /* swallow */ });
  }

  // ----- Boot sequence -------------------------------------------------------
  function getMicAndStart() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      err('no_media_devices', 'navigator.mediaDevices.getUserMedia missing');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (stream) {
      localStream = stream;
      applyMuteToTracks();
      post('audioMuteStatusChanged', { muted: muted });

      transport.init({
        onPeer: function (p, _predictedHost) {
          peer = p;
          wirePeer(p);
        },
        onReady: function (openedId, predictedHost) {
          myId = openedId;
          isHost = !!predictedHost;
          post('bridgeReady', { roomName: ROOM });
          if (!notifiedJoin) {
            notifiedJoin = true;
            post('videoConferenceJoined', { id: myId, roomName: ROOM });
          }
          logLine((isHost ? 'host ' : 'guest ') + myId);
          if (!isHost) {
            connectToHostAsGuest();
          }
          transport.announce();
        },
        onError: function (reason, message) {
          err(reason, message);
        }
      });
    }).catch(function (e) {
      err('getusermedia_denied', e && e.message ? e.message : String(e));
    });
  }

  // ----- Diagnostic ping ------------------------------------------------------
  setInterval(function () {
    try {
      post('bridgeDiagnostic', {
        hasAPP: !!peer,
        hasConference: !!myId,
        isJoined: !!myId,
        isLocalAudioMuted: muted,
        readyState: document.readyState,
        url: location.href,
        title: document.title,
        localId: myId,
        memberCount: listKnownPeers().length,
      });
    } catch (e) { /* swallow */ }
  }, 3000);

  // ----- Go --------------------------------------------------------------------
  if (typeof window.Peer === 'undefined') {
    // PeerJS CDN failed to load (offline / blocked). Wait a tick in case the
    // script tag is still parsing, then give up.
    setTimeout(function () {
      if (typeof window.Peer === 'undefined') {
        err('peerjs_cdn_unavailable', 'window.Peer is undefined after load');
        return;
      }
      getMicAndStart();
    }, 1500);
  } else {
    getMicAndStart();
  }
})();
</script>
</body>
</html>`;
}
