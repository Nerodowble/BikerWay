import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildSosPeerJSHtml } from '@/infrastructure/sos/sosPeerJSHtml';

/**
 * F29.2b — Wrapper React Native pra WebView da rede SOS.
 *
 * A WebView e singleton no app (montada via SOSPeerJSMount no root) e
 * existe pra conectar este device com outros pilotos do mesmo geohash
 * via PeerJS DataConnection. NAO usa audio — so data channels — entao
 * o componente nao precisa de permissoes nem de visibilidade.
 *
 * Tamanho 1x1 invisivel; o JavaScript da pagina e que importa.
 *
 * Props:
 *   - geohash: identifica a sala. Quando muda (piloto cruzou de celula),
 *     o componente pai forca remount via `key={geohash}` pra zerar a
 *     pagina e o Peer interno.
 *   - onBridgeReady: chamado quando a pagina conseguiu registrar peer
 *     (broker ou subscriber). Pai pode trocar transport agora.
 *   - onMessage: payload JSON ja parseado vindo de outro peer.
 *   - onError: surface de erros da pagina.
 *   - onPeerStatus: diagnostic; conta de subs (quando broker) e role.
 */
export interface SOSPeerJSWebViewHandle {
  /**
   * Envia uma mensagem pro broker (ou pra todos, se este device for o
   * broker). Espera string JSON ja serializada — fazemos no caller pra
   * que o tipo `SOSWireMessage` seja a fonte da verdade.
   */
  broadcast: (jsonString: string) => void;
  /**
   * Diz pra pagina destruir o Peer e fechar conexoes. Chamado quando
   * a WebView vai sair (remount por geohash change ou teardown).
   */
  teardown: () => void;
}

export interface SOSPeerJSWebViewProps {
  geohash: string;
  onBridgeReady?: (role: 'broker' | 'subscriber') => void;
  onMessage?: (raw: unknown) => void;
  onError?: (reason: string, message: string) => void;
  onPeerStatus?: (status: {
    role: 'broker' | 'subscriber';
    subCount?: number;
  }) => void;
}

type BridgeMessage =
  | {
      type: 'sosBridgeReady';
      payload: { role: 'broker' | 'subscriber'; geohash: string } | null;
    }
  | {
      type: 'sosBridgeError';
      payload: { reason: string; message: string } | null;
    }
  | { type: 'sosMessage'; payload: { payload: unknown } | null }
  | {
      type: 'sosPeerStatus';
      payload: { role: 'broker' | 'subscriber'; subCount?: number } | null;
    };

export const SOSPeerJSWebView = forwardRef<
  SOSPeerJSWebViewHandle,
  SOSPeerJSWebViewProps
>(({ geohash, onBridgeReady, onMessage, onError, onPeerStatus }, ref) => {
  const webRef = useRef<WebView | null>(null);

  const html = useMemo(() => buildSosPeerJSHtml({ geohash }), [geohash]);

  const inject = useCallback((script: string) => {
    if (!webRef.current) return;
    webRef.current.injectJavaScript(script);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      broadcast: (jsonString: string) => {
        // Embedamos a string JSON via JSON.stringify do RN pra que o
        // wrapper escape aspas/quebras corretamente antes de virar JS
        // literal dentro do snippet injetado.
        const escaped = JSON.stringify(jsonString);
        inject(
          `(function(){try{if(typeof window.bwSosBroadcast==='function'){window.bwSosBroadcast(${escaped});}}catch(e){}})();true;`,
        );
      },
      teardown: () => {
        inject(
          `(function(){try{if(typeof window.bwSosTeardown==='function'){window.bwSosTeardown();}}catch(e){}})();true;`,
        );
      },
    }),
    [inject],
  );

  const handleMessage = useCallback(
    (evt: WebViewMessageEvent) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(evt.nativeEvent.data) as BridgeMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'sosBridgeReady':
          if (msg.payload) onBridgeReady?.(msg.payload.role);
          break;
        case 'sosBridgeError':
          if (msg.payload)
            onError?.(msg.payload.reason, msg.payload.message ?? '');
          break;
        case 'sosMessage':
          if (msg.payload) onMessage?.(msg.payload.payload);
          break;
        case 'sosPeerStatus':
          if (msg.payload) onPeerStatus?.(msg.payload);
          break;
        default:
          break;
      }
    },
    [onBridgeReady, onError, onMessage, onPeerStatus],
  );

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost' }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        // Pra evitar que o WebView "durma" em segundo plano (Android),
        // mantemos `androidLayerType=hardware` que o RN-WebView usa nas
        // WebViews ativas.
        androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
        // Nao precisamos abrir links externos — qualquer navegacao e bug.
        onShouldStartLoadWithRequest={() => true}
        cacheEnabled={false}
        testID="sos-peerjs-webview"
      />
    </View>
  );
});

SOSPeerJSWebView.displayName = 'SOSPeerJSWebView';

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -100,
    top: -100,
  },
});
