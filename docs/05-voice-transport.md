# Voice Transport (Comboio) — current implementation and migration notes

## Current implementation: PeerJS public broker

The voice module no longer talks to `meet.jit.si`. Instead, the WebView hosts a tiny
custom HTML page (built by `src/infrastructure/voice/jitsiHtml.ts`) that loads
PeerJS from the public CDN (`unpkg.com/peerjs@1.5.4`) and uses the **public PeerJS
broker** at `peerjs.com` for signaling. Audio media flows directly peer-to-peer
over WebRTC; the broker is only used during the handshake. The broker is free
and unauthenticated but rate-limited and best-effort — fine for a free MVP, not
fine for a paying customer base.

## Host-election pattern (mesh, no SFU)

For each comboio we derive a deterministic host PeerJS id of the form
`bw-<roomCode>-host`. On boot, every peer tries to *claim* that id by calling
`new Peer(hostId)`. Exactly one peer succeeds; everyone else gets PeerJS's
`unavailable-id` error and falls back to a random guest id
(`bw-<roomCode>-<6 hex>`). The winner is the **host**.

- Guests open a DataConnection to the host, send `{ type: 'hello', id }`, and
  also initiate an audio call up to the host.
- The host accumulates the guest list and broadcasts it back as
  `{ type: 'peer-list', peers: [...] }` whenever someone new joins.
- Each guest, on receiving the peer list, dials every other guest with a
  PeerJS audio call. This produces a full **mesh**: each peer holds N-1
  RTCPeerConnections.

The mesh is the simplest possible topology that requires no media server.
Its limit is bandwidth: with ~32 kbps of Opus per direction, **six concurrent
peers** is roughly the upper bound before mobile data plans start to suffer.
Anything beyond that needs an SFU (selective forwarding unit) — out of scope
for the free tier.

Known limitation: if the **host disconnects**, the mesh keeps working for
existing peers, but new joiners cannot discover the group because there is
no automatic host re-election in this first cut. A future iteration can add
that on top of the same transport contract (see below).

## Swapping the signaling layer later

All signaling/discovery code is isolated inside the HTML behind a single
`transport` object. The contract is four functions:

```js
const transport = {
  init(opts),            // bootstrap signaling; eventually calls opts.onReady(myId, isHost)
  announce(),            // tell other peers we're here (no-op in PeerJS — handled implicitly)
  onPeerListChanged(cb), // register a listener fired with the current peer-id list
  dispose(),             // tear down sockets/peer/listeners
};
```

To migrate to **Supabase Realtime channels**, **a custom WS server**, or
**Firebase RTDB**, replace the body of that object — nothing else in the
page needs to change. The audio plane (getUserMedia + RTCPeerConnection)
remains identical; only how peers find each other moves.

A Supabase Realtime port, for example, would have `init` subscribe to a
channel named after the room code, `announce` broadcast a presence event,
`onPeerListChanged` translate Supabase presence-sync events into the peer-id
array, and `dispose` `removeChannel()` it.

## Known quirks

- **WebView secure context**: the HTML must be hosted with
  `source={{ html, baseUrl: 'https://localhost' }}`. Chromium-based WebViews
  only expose `getUserMedia` under a secure-context origin; without the
  baseUrl, mic access silently fails on Android.
- **First-connection latency**: the very first peer to enter a brand-new room
  often waits ~3-5 s while PeerJS allocates the deterministic host id on the
  public broker. Subsequent joins are near-instant.
- **Public broker flakiness**: `peerjs.com` occasionally times out under
  load. The HTML emits a `bridgeError` with reason `peerjs_cdn_unavailable`
  or `peer_construct_failed` so the React Native layer can show a banner.
- **No host re-election**: if the elected host leaves, late joiners cannot
  find the group. Existing audio calls between remaining peers stay up.
