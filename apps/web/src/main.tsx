import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PttController,
  extractRoomId,
  type JoinRoomResponse,
  type PttState,
} from "@commander-link/core";
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

  const navigate = useCallback((id: string | null) => {
    window.history.pushState({}, "", id ? `/r/${id}` : "/");
    setRoomId(id);
  }, []);

  // Desktop deep links route straight into a room.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const off = bridge.onDeepLinkRoom((id) => navigate(id));
    void bridge.getInitialRoom().then((id) => {
      if (id) navigate(id);
    });
    return off;
  }, [navigate]);

  useEffect(() => {
    const onPop = () => setRoomId(currentRoomId());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return roomId ? <JoinView roomId={roomId} /> : <HomeView onEnterRoom={navigate} />;
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-text">Commander Link</span>
    </div>
  );
}

function HomeView({ onEnterRoom }: { onEnterRoom: (id: string) => void }) {
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

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

  const onJoinExisting = useCallback(() => {
    const id = extractRoomId(joinInput);
    if (!id) {
      setJoinError("Kein gültiger Link, Raumcode oder Room-ID erkannt.");
      return;
    }
    setJoinError(null);
    onEnterRoom(id);
  }, [joinInput, onEnterRoom]);

  return (
    <main className="shell home">
      <Brand />
      <div className="hero">
        <h1>Privater Sprachkanal für Kommandeure</h1>
        <p className="lead">
          Ein ruhiger, privater Push-to-Talk-Kanal für bis zu vier Kommandeure – parallel
          zu Discord, das unverändert weiterläuft.
        </p>
      </div>

      <div className="home-grid">
        <section className="panel">
          <h2>Neuen Raum erstellen</h2>
          <p className="panel-sub">Erzeuge einen temporären Raum und teile die Einladung.</p>
          <button className="btn btn-primary btn-block" onClick={onCreate} disabled={busy}>
            {busy ? "Erstelle …" : "Raum erstellen"}
          </button>
          {error && <p className="error">{error}</p>}

          {invite && (
            <div className="invite-box">
              <span className="field-label">Einladungslink</span>
              <code className="invite-url">{invite}</code>
              <div className="row">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(invite).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? "Kopiert ✓" : "Link kopieren"}
                </button>
                <a className="btn btn-primary" href={invite}>
                  Raum öffnen
                </a>
              </div>
            </div>
          )}
        </section>

        <div className="home-divider" aria-hidden="true">
          <span>oder</span>
        </div>

        <section className="panel">
          <h2>Vorhandenem Raum beitreten</h2>
          <p className="panel-sub">Füge einen Einladungslink, Deep-Link oder Raumcode ein.</p>
          <label className="field">
            <span className="field-label">Einladungslink oder Raumcode</span>
            <input
              type="text"
              value={joinInput}
              placeholder="https://…/r/…  ·  commanderlink://join/…  ·  Room-ID"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setJoinInput(e.target.value);
                if (joinError) setJoinError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onJoinExisting();
              }}
            />
          </label>
          <button
            className="btn btn-secondary btn-block"
            onClick={onJoinExisting}
            disabled={!joinInput.trim()}
          >
            Beitreten
          </button>
          {joinError && <p className="error">{joinError}</p>}
        </section>
      </div>
    </main>
  );
}

interface StatusMeta {
  label: string;
  tone: "ok" | "wait" | "bad";
}

const STATUS_META: Record<ConnectionStatus, StatusMeta> = {
  idle: { label: "Bereit", tone: "wait" },
  connecting: { label: "Verbinde …", tone: "wait" },
  connected: { label: "Verbunden", tone: "ok" },
  reconnecting: { label: "Verbinde neu …", tone: "wait" },
  disconnected: { label: "Getrennt", tone: "bad" },
};

function StatusPill({ status }: { status: ConnectionStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`status-pill tone-${meta.tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function shortRoom(roomId: string): string {
  return roomId.length > 14 ? `${roomId.slice(0, 6)}…${roomId.slice(-4)}` : roomId;
}

function JoinView({ roomId }: { roomId: string }) {
  const [displayName, setDisplayName] = useState("");
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [speakingRemotes, setSpeakingRemotes] = useState<string[]>([]);
  const [pttState, setPttState] = useState<PttState>("muted");
  const [error, setError] = useState<string | null>(null);

  const connectionRef = useRef<RoomConnection | null>(null);
  const controllerRef = useRef<PttController | null>(null);
  const sessionRef = useRef<JoinRoomResponse | null>(null);
  // name -> last time Metered reported them as active speaker.
  const recentSpeakersRef = useRef<Map<string, number>>(new Map());

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
      onActiveSpeaker: (speaker) => {
        if (speaker) recentSpeakersRef.current.set(speaker, Date.now());
      },
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

  // Derive who is currently speaking from the activeSpeaker signal (no audio analysis).
  useEffect(() => {
    if (!joined) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const map = recentSpeakersRef.current;
      const active: string[] = [];
      for (const [name, seen] of map) {
        if (now - seen < 700) active.push(name);
        else map.delete(name);
      }
      setSpeakingRemotes((prev) =>
        prev.length === active.length && prev.every((n, i) => n === active[i]) ? prev : active
      );
    }, 250);
    return () => window.clearInterval(timer);
  }, [joined]);

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
      <main className="shell join-gate">
        <Brand />
        <section className="panel panel-centered">
          <span className="room-chip">Raum {shortRoom(roomId)}</span>
          <h1>Raum beitreten</h1>
          <p className="lead">Audio-only. Du trittst stummgeschaltet bei.</p>
          <label className="field">
            <span className="field-label">Anzeigename</span>
            <input
              type="text"
              value={displayName}
              maxLength={48}
              autoFocus
              placeholder="z. B. Commander Dorn"
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onJoin();
              }}
            />
          </label>
          <button className="btn btn-primary btn-block" onClick={onJoin} disabled={busy}>
            {busy ? "Verbinde …" : "Mikrofon freigeben & beitreten"}
          </button>
          {error && <p className="error">{error}</p>}
          {!desktop && (
            <a className="link" href={`commanderlink://join/${roomId}`}>
              In Desktop-App öffnen
            </a>
          )}
        </section>
      </main>
    );
  }

  const own = pttState === "transmitting";
  const speaking = own || speakingRemotes.length > 0;
  const circle = pttCircleLabel(pttState, own, speakingRemotes);

  return (
    <main className="shell room">
      <header className="room-header">
        <Brand />
        <StatusPill status={status} />
      </header>

      <div className="ptt-stage">
        <PttButton
          main={circle.main}
          sub={circle.sub}
          active={speaking}
          own={own}
          onPress={() => controllerRef.current?.press()}
          onRelease={() => controllerRef.current?.release()}
        />
        {desktop && <p className="ptt-hint">Global: F8 gedrückt halten zum Sprechen.</p>}
      </div>

      <section className="panel peers-panel">
        <div className="panel-head">
          <div className="room-meta">
            <span className="field-label">Raum</span>
            <span className="room-id" title={roomId}>
              {shortRoom(roomId)}
            </span>
          </div>
          <span className="peer-count">{peers.length} / 4</span>
        </div>

        <ul className="peer-list">
          {peers.length === 0 && <li className="peer-empty">Noch niemand online.</li>}
          {peers.map((peer) => {
            const isSpeaking = speakingRemotes.includes(peer.name);
            return (
              <li key={peer.id} className={`peer-row${isSpeaking ? " speaking" : ""}`}>
                <span className={`mic-icon${isSpeaking ? " on" : ""}`} aria-hidden="true" />
                <span className="peer-name">{peer.name}</span>
                <input
                  className="volume"
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
            );
          })}
        </ul>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}

function pttCircleLabel(
  state: PttState,
  own: boolean,
  remotes: string[]
): { main: string; sub: string } {
  if (state === "blocked") return { main: "BLOCKIERT", sub: "" };
  if (state === "disconnected") return { main: "GETRENNT", sub: "" };
  if (own) return { main: "DU", sub: "sprichst" };
  if (remotes.length === 1) return { main: remotes[0].toUpperCase(), sub: "spricht" };
  if (remotes.length > 1) {
    return { main: remotes.map((n) => n.toUpperCase()).join(" + "), sub: "sprechen" };
  }
  return { main: "HALTEN", sub: "zum Sprechen" };
}

function PttButton({
  main,
  sub,
  active,
  own,
  onPress,
  onRelease,
}: {
  main: string;
  sub: string;
  active: boolean;
  own: boolean;
  onPress: () => void;
  onRelease: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <button
      ref={ref}
      className={`ptt${active ? " active" : ""}${own ? " own" : ""}`}
      aria-pressed={own}
      aria-label="Push-to-talk: gedrückt halten zum Sprechen"
      onPointerDown={(e) => {
        ref.current?.setPointerCapture(e.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onPointerLeave={onRelease}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="ptt-main">{main}</span>
      {sub && <span className="ptt-sub">{sub}</span>}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
