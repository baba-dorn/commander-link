import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PttController, type JoinRoomResponse, type PttState } from "@commander-link/core";
import "./styles.css";
import { ApiError, createRoom, joinRoom, leaveRoom, sendHeartbeat } from "./api";
import {
  RoomConnection,
  type ConnectionStatus,
  type PeerView,
} from "./connection";
import { getBridge, isDesktop } from "./desktop";

const ROOM_PATH = /^\/r\/([A-Za-z0-9_-]{20,128})$/;

function currentRoomId(): string | null {
  const match = window.location.pathname.match(ROOM_PATH);
  return match ? match[1] : null;
}

function App() {
  const [roomId, setRoomId] = useState<string | null>(currentRoomId());

  // Desktop deep links route straight into a room.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const off = bridge.onDeepLinkRoom((id) => {
      window.history.pushState({}, "", `/r/${id}`);
      setRoomId(id);
    });
    void bridge.getInitialRoom().then((id) => {
      if (id) {
        window.history.pushState({}, "", `/r/${id}`);
        setRoomId(id);
      }
    });
    return off;
  }, []);

  useEffect(() => {
    const onPop = () => setRoomId(currentRoomId());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return roomId ? <JoinView roomId={roomId} /> : <HomeView />;
}

function HomeView() {
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onCreate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom();
      setInvite(room.inviteUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Raum konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <main className="shell">
      <p className="eyebrow">COMMANDER LINK</p>
      <h1>Privater PTT-Kanal neben Discord</h1>
      <p className="lead">
        Erstelle einen temporären Audio-Raum für bis zu 4 Kommandeure. Discord läuft
        unverändert weiter.
      </p>

      <button className="primary" onClick={onCreate} disabled={busy}>
        {busy ? "Erstelle …" : "Raum erstellen"}
      </button>

      {error && <p className="error">{error}</p>}

      {invite && (
        <section className="card invite">
          <h2>Einladung teilen</h2>
          <code className="invite-url">{invite}</code>
          <div className="actions">
            <button
              className="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(invite).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Kopiert" : "Link kopieren"}
            </button>
            <a className="button" href={invite}>
              Raum öffnen
            </a>
          </div>
          <p className="hint">
            Derselbe Link funktioniert im Browser oder – über „In Desktop-App öffnen“ – in
            der Desktop-App.
          </p>
        </section>
      )}
    </main>
  );
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "bereit",
  connecting: "verbinde …",
  connected: "verbunden",
  reconnecting: "verbinde neu …",
  disconnected: "getrennt",
};

const PTT_LABEL: Record<PttState, string> = {
  muted: "STUMM · HALTEN ZUM SPRECHEN",
  transmitting: "SENDET …",
  blocked: "BLOCKIERT",
  disconnected: "GETRENNT",
};

function JoinView({ roomId }: { roomId: string }) {
  const [displayName, setDisplayName] = useState("");
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [pttState, setPttState] = useState<PttState>("muted");
  const [error, setError] = useState<string | null>(null);

  const connectionRef = useRef<RoomConnection | null>(null);
  const controllerRef = useRef<PttController | null>(null);
  const sessionRef = useRef<JoinRoomResponse | null>(null);

  // Translate PTT state into the actual microphone action. Fail-closed: anything
  // that is not "transmitting" mutes.
  useEffect(() => {
    const controller = new PttController();
    controllerRef.current = controller;
    const off = controller.on((state) => {
      setPttState(state);
      const connection = connectionRef.current;
      if (!connection) return;
      if (state === "transmitting") void connection.transmit();
      else void connection.mute();
    });
    return () => {
      off();
    };
  }, []);

  const onJoin = useCallback(async () => {
    const name = displayName.trim();
    if (!name) {
      setError("Bitte einen Anzeigenamen eingeben.");
      return;
    }
    setBusy(true);
    setError(null);

    const connection = new RoomConnection({
      onStatus: (s) => {
        setStatus(s);
        const controller = controllerRef.current;
        if (!controller) return;
        if (s === "disconnected" || s === "reconnecting") controller.disconnect();
      },
      onPeers: setPeers,
      onActiveSpeaker: setActiveSpeaker,
      onError: setError,
      onReconnect: () => controllerRef.current?.reconnect(),
    });
    connectionRef.current = connection;

    try {
      const session = await joinRoom(roomId, name);
      sessionRef.current = session;
      await connection.connect(session, name);
      setJoined(true);
    } catch (err) {
      let message = "Beitritt fehlgeschlagen.";
      if (err instanceof ApiError) {
        message =
          err.message === "full"
            ? "Der Raum ist voll (max. 4)."
            : err.message === "expired" || err.message === "not_found"
              ? "Der Raum existiert nicht mehr."
              : err.message;
      } else if (err instanceof Error) {
        message = err.message;
      }
      setError(message);
      connectionRef.current = null;
    } finally {
      setBusy(false);
    }
  }, [displayName, roomId]);

  // Heartbeat + leave lifecycle.
  useEffect(() => {
    if (!joined) return;
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (session) sendHeartbeat(roomId, session.admissionId);
    }, 30_000);
    const onUnload = () => {
      const session = sessionRef.current;
      if (session) sendHeartbeat(roomId, session.admissionId);
    };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onUnload);
      const session = sessionRef.current;
      if (session) void leaveRoom(roomId, session.admissionId).catch(() => {});
      void connectionRef.current?.disconnect();
    };
  }, [joined, roomId]);

  // Global fail-closed events + desktop global PTT.
  useEffect(() => {
    if (!joined) return;
    const controller = controllerRef.current;
    if (!controller) return;

    const onBlur = () => controller.blur();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") controller.hidden();
    };
    const onPageHide = () => controller.hidden();
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    const bridge = getBridge();
    const offDown = bridge?.onPttDown(() => controller.press());
    const offUp = bridge?.onPttUp(() => controller.release());

    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      offDown?.();
      offUp?.();
    };
  }, [joined]);

  const desktop = useMemo(() => isDesktop(), []);

  if (!joined) {
    return (
      <main className="shell">
        <p className="eyebrow">COMMANDER LINK</p>
        <h1>Raum beitreten</h1>
        <p className="lead">Audio-only. Du trittst stummgeschaltet bei.</p>
        <label className="field">
          Anzeigename
          <input
            type="text"
            value={displayName}
            maxLength={48}
            autoFocus
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onJoin();
            }}
          />
        </label>
        <button className="primary" onClick={onJoin} disabled={busy}>
          {busy ? "Verbinde …" : "Mikrofon freigeben & beitreten"}
        </button>
        {error && <p className="error">{error}</p>}
        {!desktop && (
          <a className="link" href={`commanderlink://join/${roomId}`}>
            In Desktop-App öffnen
          </a>
        )}
      </main>
    );
  }

  const transmitting = pttState === "transmitting";

  return (
    <main className="shell room">
      <header className="room-head">
        <p className="eyebrow">COMMANDER LINK</p>
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
      </header>

      <PttButton
        state={pttState}
        onPress={() => controllerRef.current?.press()}
        onRelease={() => controllerRef.current?.release()}
      />
      <p className={`ptt-caption${transmitting ? " live" : ""}`}>{PTT_LABEL[pttState]}</p>
      {desktop && <p className="hint">Global: F8 gedrückt halten zum Sprechen.</p>}

      <section className="card peers">
        <h2>Teilnehmer ({peers.length})</h2>
        <p className="hint">Aktiver Sprecher: {activeSpeaker ?? "–"}</p>
        <ul className="peer-list">
          {peers.length === 0 && <li className="empty">Noch niemand online.</li>}
          {peers.map((peer) => (
            <li key={peer.id} className="peer-row">
              <span className="peer-name">{peer.name}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={peer.volume}
                aria-label={`Lautstärke ${peer.name}`}
                onChange={(e) =>
                  connectionRef.current?.setVolume(peer.id, Number(e.target.value))
                }
              />
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}

function PttButton({
  state,
  onPress,
  onRelease,
}: {
  state: PttState;
  onPress: () => void;
  onRelease: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const transmitting = state === "transmitting";
  return (
    <button
      ref={ref}
      className={`ptt${transmitting ? " transmitting" : ""}`}
      aria-pressed={transmitting}
      onPointerDown={(e) => {
        ref.current?.setPointerCapture(e.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onPointerLeave={onRelease}
      onContextMenu={(e) => e.preventDefault()}
    >
      {transmitting ? "SPRICHT" : "HALTEN"}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
