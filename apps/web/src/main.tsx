import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PttController,
  extractRoomId,
  type JoinRoomResponse,
  type PttBinding,
  type PttSettings,
  type PttState,
} from "@commander-link/core";
import "./styles.css";
import { ApiError, joinRoom, leaveRoom, sendHeartbeat } from "./api";
import {
  createVoiceTransport,
  type ConnectionStatus,
  type PeerView,
  type VoiceTransport,
} from "./connection";
import {
  getBridge,
  isDesktop,
  supportsPttSettings,
  showWindowsDownload,
  WINDOWS_DOWNLOAD_URL,
} from "./desktop";
import type { SpeakerLevel } from "./audio-level";
import { PttGesture } from "./ptt";
import type { TransportDiagnostics, TransportDiagnosticsPeer } from "./transport";
import { formatDiagnosticsReport, setWebrtcLogEnabled, type LogEvent } from "./webrtc-log";

const ROOM_PATH = /^\/r\/([A-Za-z0-9_-]{20,128})$/;
const APP_LAUNCHER_PATH = /^\/app\/([A-Za-z0-9_-]{20,128})$/;

// Development-only diagnostics: visible in `vite dev` or with `?diag` in the URL.
const DIAGNOSTICS_ENABLED =
  import.meta.env.DEV || new URLSearchParams(window.location.search).has("diag");

// WebRTC/PTT diagnostics: enabled with `?debug=webrtc` (also enables the
// diagnostics panel), or always in dev. Never affects behaviour — observation only.
const WEBRTC_DEBUG_ENABLED =
  import.meta.env.DEV || new URLSearchParams(window.location.search).get("debug") === "webrtc";

if (WEBRTC_DEBUG_ENABLED) setWebrtcLogEnabled(true);

const CLIENT_PLATFORM: "Electron" | "Browser" = getBridge() ? "Electron" : "Browser";

const PLATFORM_NAME = (() => {
  const ua = navigator.userAgent;
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "unknown";
})();

function DiagnosticsPanel({ transport }: { transport: VoiceTransport | null }) {
  const [diag, setDiag] = useState<TransportDiagnostics | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!transport) return;
    let alive = true;
    const tick = async () => {
      if (!alive || !transport) return;
      try {
        setDiag(await transport.getDiagnostics());
      } catch {
        // Diagnostics must never break the app.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [transport]);

  const copyReport = async () => {
    if (!transport) return;
    try {
      const current =
        diag ?? (await transport.getDiagnostics());
      const report = formatDiagnosticsReport({
        client: CLIENT_PLATFORM,
        platform: PLATFORM_NAME,
        roomId: current.roomId,
        channel: current.channel,
        localPeerId: current.localPeerId ?? "",
        state: current.state,
        iceServers: current.iceServers,
        peers: (current.remotePeers ?? []).map((p) => ({
          name: p.name,
          id: p.id,
          connectionState: p.connectionState ?? "n/a",
          iceConnectionState: p.iceConnectionState,
          signalingState: p.signalingState ?? "n/a",
          candidateType: p.candidateType,
          localCandidateType: p.localCandidateType,
          remoteCandidateType: p.remoteCandidateType,
          protocol: p.protocol,
          rttMs: p.rttMs,
          bytesSent: p.bytesSent,
          bytesReceived: p.bytesReceived,
          packetsSent: p.packetsSent,
          packetsReceived: p.packetsReceived,
          audioTrackState: p.audioTrackState ?? "n/a",
          audioMuted: p.audioMuted,
          audioEnabled: p.audioEnabled,
          gathered: p.gathered,
          turnCandidateAvailable: p.turnCandidateAvailable,
        })),
        history: (current.events ?? []) as LogEvent[],
      });
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (e.g. non-secure context); no crash.
    }
  };

  const peerDetails = (p: TransportDiagnosticsPeer) => [
    ["State", p.state],
    ["ICE", p.iceConnectionState],
    ["Signaling", p.signalingState ?? "n/a"],
    ["Selected path", p.candidateType ?? "n/a"],
    ["Local candidate", p.localCandidateType ?? "n/a"],
    ["Remote candidate", p.remoteCandidateType ?? "n/a"],
    ["Protocol", p.protocol ?? "n/a"],
    ["RTT", p.rttMs !== null ? `${p.rttMs.toFixed(1)} ms` : "n/a"],
    ["Audio bytes sent", p.bytesSent !== null ? String(p.bytesSent) : "n/a"],
    ["Audio bytes recv", p.bytesReceived !== null ? String(p.bytesReceived) : "n/a"],
    ["Audio packets sent", p.packetsSent !== null ? String(p.packetsSent) : "n/a"],
    ["Audio packets recv", p.packetsReceived !== null ? String(p.packetsReceived) : "n/a"],
    ["Track", p.audioTrackState ?? "n/a"],
    ["Track enabled", p.audioEnabled === null ? "n/a" : String(p.audioEnabled)],
    ["Track muted", p.audioMuted === null ? "n/a" : String(p.audioMuted)],
    ["ICE candidates", p.gathered],
    ["TURN candidate", p.turnCandidateAvailable === null || p.turnCandidateAvailable === undefined ? "n/a" : p.turnCandidateAvailable ? "YES" : "NO"],
  ] as const;

  return (
    <details className="diagnostics">
      <summary>Diagnostik (Entwicklung)</summary>
      {diag ? (
        <>
          <table className="diag-table">
            <tbody>
              <tr>
                <td>Raum</td>
                <td>{diag.roomId || "–"}</td>
              </tr>
              <tr>
                <td>Realtime Channel</td>
                <td>{diag.channel || "–"}</td>
              </tr>
              <tr>
                <td>Peer-ID</td>
                <td>{diag.localPeerId ?? "–"}</td>
              </tr>
              <tr>
                <td>SDK-State</td>
                <td>{diag.state}</td>
              </tr>
              <tr>
                <td>Client</td>
                <td>{CLIENT_PLATFORM} · {PLATFORM_NAME}</td>
              </tr>
              {diag.iceServers && (
                <>
                  <tr>
                    <td>TURN config received</td>
                    <td>{diag.iceServers.received ? "YES" : "NO"}</td>
                  </tr>
                  <tr>
                    <td>Open Relay fallback</td>
                    <td>{diag.iceServers.fallbackApplied ? "applied" : "off"}</td>
                  </tr>
                  <tr>
                    <td>forceRelay (debug)</td>
                    <td>{diag.iceServers.forceRelay ? "YES" : "NO"}</td>
                  </tr>
                  <tr>
                    <td>STUN servers</td>
                    <td>{diag.iceServers.stunCount}</td>
                  </tr>
                  <tr>
                    <td>TURN servers</td>
                    <td>{diag.iceServers.turnCount}</td>
                  </tr>
                  {diag.iceServers.entries.map((e, i) => (
                    <tr key={i}>
                      <td>ICE server {i + 1}</td>
                      <td>
                        {e.scheme}:{e.hostname}
                        {e.port ? `:${e.port}` : ""}
                        {e.transport ? `?transport=${e.transport}` : ""}
                        {e.hasUsername || e.hasCredential ? " (creds present)" : ""}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
          {WEBRTC_DEBUG_ENABLED && (
            <button className="btn btn-secondary diag-copy" onClick={copyReport}>
              {copied ? "Kopiert ✓" : "Copy diagnostics"}
            </button>
          )}
        </>
      ) : (
        <p>Keine Verbindung.</p>
      )}
      <ul className="diag-peers">
        {diag?.remotePeers.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> <span className="muted">({p.id.slice(0, 8)}…)</span>
            <ul>
              {peerDetails(p).map(([label, value]) => (
                <li key={label}>
                  {label}: {value}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {WEBRTC_DEBUG_ENABLED && diag && diag.events && diag.events.length > 0 && (
        <details className="diag-events">
          <summary>Letzte Events ({diag.events.length})</summary>
          <ul className="diag-event-list">
            {diag.events
              .slice(-40)
              .map((ev, i) => (
                <li key={`${ev.time}-${i}`}>
                  {ev.time} {ev.label} {ev.detail}
                </li>
              ))}
          </ul>
        </details>
      )}
    </details>
  );
}

function currentRoomId(): string | null {
  const roomMatch = window.location.pathname.match(ROOM_PATH);
  if (roomMatch) return roomMatch[1];
  
  const appMatch = window.location.pathname.match(APP_LAUNCHER_PATH);
  if (appMatch) return appMatch[1];
  
  return null;
}

function isAppLauncher(): boolean {
  return APP_LAUNCHER_PATH.test(window.location.pathname);
}

function App() {
  const [roomId, setRoomId] = useState<string | null>(currentRoomId());
  const [isLauncher, setIsLauncher] = useState<boolean>(isAppLauncher());

  const navigate = useCallback((id: string | null) => {
    window.history.pushState({}, "", id ? `/r/${id}` : "/");
    setRoomId(id);
    setIsLauncher(false);
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
    const onPop = () => {
      setRoomId(currentRoomId());
      setIsLauncher(isAppLauncher());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const content = isLauncher && roomId
    ? <AppLauncherView roomId={roomId} />
    : roomId ? <JoinView roomId={roomId} /> : <HomeView onEnterRoom={navigate} />;
  return <>{content}<DesktopSettings /></>;
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-text">Commander Link</span>
    </div>
  );
}

function bindingLabel(binding: PttBinding | null): string {
  return binding?.label ?? "Nicht eingerichtet";
}

function DesktopSettings() {
  const bridge = getBridge();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<PttSettings | null>(null);
  const [capture, setCapture] = useState<"primary" | "secondary" | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [testActive, setTestActive] = useState(false);
  const [testSpeaking, setTestSpeaking] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!bridge || !supportsPttSettings()) return;
    void bridge.getPttSettings().then(setSettings);
    const offChanged = bridge.onPttSettingsChanged(setSettings);
    const offCapture = bridge.onPttCapture((binding) => {
      setCapture((slot) => {
        if (!slot) return slot;
        setSettings((current) => {
          if (!current) return current;
          const other = slot === "primary" ? current.secondaryPttBinding : current.primaryPttBinding;
          if (other && other.label === binding.label && JSON.stringify(other) === JSON.stringify(binding)) {
            setCaptureError("Diese Taste ist bereits als PTT-Taste eingestellt.");
            return current;
          }
          const next = { ...current, [slot === "primary" ? "primaryPttBinding" : "secondaryPttBinding"]: binding };
          void bridge.savePttSettings(next).then((saved) => {
            setSettings(saved);
            window.dispatchEvent(new CustomEvent("commander:settings", { detail: saved }));
          });
          return next;
        });
        return null;
      });
      setCaptureError(null);
    });
    const offCancelled = bridge.onPttCaptureCancelled(() => setCapture(null));
    const offDown = bridge.onPttDown(() => { if (testActive) setTestSpeaking(true); });
    const offUp = bridge.onPttUp(() => setTestSpeaking(false));
    return () => { offChanged(); offCapture(); offCancelled(); offDown(); offUp(); };
  }, [bridge, testActive]);

  useEffect(() => {
    if (!open || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDevices([]));
  }, [open]);

  if (!bridge || !supportsPttSettings()) return null;

  const update = (next: PttSettings) => {
    setSettings(next);
    void bridge.savePttSettings(next).then((saved) => {
      setSettings(saved);
      window.dispatchEvent(new CustomEvent("commander:settings", { detail: saved }));
    });
  };
  const startCapture = (slot: "primary" | "secondary") => {
    setCaptureError(null);
    setCapture(slot);
    void bridge.startPttCapture();
  };
  const stopTest = () => { setTestActive(false); setTestSpeaking(false); };

  return (
    <>
      <button className="settings-gear" aria-label="Commander Link Einstellungen" onClick={() => setOpen(true)}>⚙</button>
      {open && settings && (
        <div className="settings-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) { stopTest(); setOpen(false); } }}>
          <section className="panel settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="panel-head"><h2 id="settings-title">⚙ Commander Link Einstellungen</h2><button className="settings-close" onClick={() => { stopTest(); setOpen(false); }}>×</button></div>
            <h3>Push-to-Talk</h3>
            <div className="settings-row"><span>PTT-Taste</span><code>{bindingLabel(settings.primaryPttBinding)}</code><button className="btn btn-secondary" onClick={() => startCapture("primary")}>Ändern</button></div>
            <div className="settings-row"><span>Alternative Taste</span><code>{bindingLabel(settings.secondaryPttBinding)}</code><div className="settings-actions"><button className="btn btn-secondary" onClick={() => startCapture("secondary")}>Ändern</button>{settings.secondaryPttBinding && <button className="btn btn-quiet" onClick={() => update({ ...settings, secondaryPttBinding: null })}>Entfernen</button>}</div></div>
            {capture && <p className="settings-capture">Gewünschte Taste drücken … <small>Esc = Abbrechen</small></p>}
            {captureError && <p className="error">{captureError}</p>}
            <h3>Mikrofon</h3>
            <label className="settings-field"><span>Gerät</span><select value={settings.microphoneDevice} onChange={(e) => update({ ...settings, microphoneDevice: e.target.value })}><option value="default">Systemstandard</option>{devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "default").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Mikrofon"}</option>)}</select></label>
            <h3>Audioausgabe</h3>
            <label className="settings-field"><span>Gerät</span><select value={settings.audioOutputDevice} onChange={(e) => update({ ...settings, audioOutputDevice: e.target.value })}><option value="default">Systemstandard</option>{devices.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Audioausgabe"}</option>)}</select></label>
            <h3>PTT testen</h3>
            <div className={`ptt-test-status${testSpeaking ? " speaking" : ""}`}>{testSpeaking ? "🔴 Du sendest gerade" : "⚪ Mikrofon stumm"}</div>
            <button className="btn btn-primary btn-block" onClick={() => { if (testActive) stopTest(); else { setTestActive(true); setTestSpeaking(false); } }}>{testActive ? "Test beenden" : "Test starten"}</button>
            {testActive && <p className="panel-sub">Halte deine konfigurierte Taste gedrückt und prüfe Press/Release.</p>}
          </section>
        </div>
      )}
    </>
  );
}

function DesktopPttIndicator() {
  const bridge = getBridge();
  const [settings, setSettings] = useState<PttSettings | null>(null);
  useEffect(() => {
    if (!bridge || !supportsPttSettings()) return;
    void bridge.getPttSettings().then(setSettings);
    return bridge.onPttSettingsChanged(setSettings);
  }, [bridge]);
  return bridge ? <span className="ptt-indicator">PTT · {bindingLabel(settings?.primaryPttBinding ?? null)}</span> : null;
}

function AppLauncherView({ roomId }: { roomId: string }) {
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    // Attempt to launch the desktop app via custom protocol
    const deepLinkUrl = `commanderlink://join/${roomId}`;
    
    // Create a hidden iframe to attempt the custom protocol launch
    // This is more reliable than window.location for some browsers
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = deepLinkUrl;
    document.body.appendChild(iframe);
    
    // Clean up iframe after a short delay
    const timer = setTimeout(() => {
      document.body.removeChild(iframe);
      setAttempted(true);
    }, 1000);
    
    // Also try window.location as fallback mechanism
    window.location.href = deepLinkUrl;
    
    return () => {
      clearTimeout(timer);
      if (iframe.parentNode) {
        try {
          document.body.removeChild(iframe);
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [roomId]);

  const browserUrl = `/r/${roomId}`;

  return (
    <main className="shell launcher">
      <Brand />
      <section className="panel panel-centered">
        <h1>Commander Link wird geöffnet …</h1>
        <p className="lead">
          Falls die App nicht automatisch startet:
        </p>
        <div className="launcher-actions">
          <a className="btn btn-primary btn-block" href={browserUrl}>
            Im Browser öffnen
          </a>
          {showWindowsDownload() && (
            <a className="btn btn-secondary btn-block" href={WINDOWS_DOWNLOAD_URL} target="_blank" rel="noreferrer">
              Commander Link herunterladen
            </a>
          )}
        </div>
      </section>
    </main>
  );
}

function HomeView({ onEnterRoom }: { onEnterRoom: (id: string) => void }) {
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

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
        <p className="panel-sub">Commander-Link-Räume werden über Discord gestartet.</p>
      </div>

      <section className="panel panel-centered">
        <h2>Vorhandenem Raum beitreten</h2>
        <p className="panel-sub">
          Füge einen Einladungslink, Deep-Link oder Raumcode aus Discord ein.
        </p>
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

      {showWindowsDownload() && (
        <p className="desktop-download">
          Commander Link für Windows?{" "}
          <a className="link" href={WINDOWS_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            Desktop-App herunterladen
          </a>
          <span className="desktop-download-sub"> · mit konfigurierbarer globaler Push-to-Talk-Taste</span>
        </p>
      )}
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
  const [speakerLevels, setSpeakerLevels] = useState<SpeakerLevel[]>([]);
  const [pttState, setPttState] = useState<PttState>("muted");
  const [error, setError] = useState<string | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<PttSettings | null>(null);

  const connectionRef = useRef<VoiceTransport | null>(null);
  const controllerRef = useRef<PttController | null>(null);
  const sessionRef = useRef<JoinRoomResponse | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge || !supportsPttSettings()) return;
    void bridge.getPttSettings().then(setDesktopSettings);
    const offBridge = bridge.onPttSettingsChanged(setDesktopSettings);
    const onSettings = (event: Event) => {
      const next = (event as CustomEvent<PttSettings>).detail;
      setDesktopSettings(next);
      if (connectionRef.current) {
        void connectionRef.current.setMicrophoneDevice?.(next.microphoneDevice);
        void connectionRef.current.setAudioOutputDevice?.(next.audioOutputDevice);
      }
    };
    window.addEventListener("commander:settings", onSettings);
    return () => { offBridge(); window.removeEventListener("commander:settings", onSettings); };
  }, []);

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

    const connection = createVoiceTransport({
      onStatus: (s) => {
        setStatus(s);
        const controller = controllerRef.current;
        if (!controller) return;
        if (s === "disconnected" || s === "reconnecting") controller.disconnect();
      },
      onPeers: setPeers,
      onActiveSpeaker: () => {
        // Kept as optional metadata; visual speaker detection uses audio levels.
      },
      onSpeakerLevels: setSpeakerLevels,
      onError: setError,
      onReconnect: () => controllerRef.current?.reconnect(),
    }, {
      microphoneDeviceId: desktopSettings?.microphoneDevice,
      audioOutputDeviceId: desktopSettings?.audioOutputDevice,
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
  }, [displayName, roomId, desktopSettings]);

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
      controllerRef.current?.release();
      void connectionRef.current?.disconnect();
    };
  }, [joined, roomId]);

  // Derive who is currently speaking from the audio level analysis.
  const speakingRemotes = useMemo(() => {
    return speakerLevels
      .filter((s) => s.speaking)
      .map((s) => {
        const peer = peers.find((p) => p.id === s.participantId);
        return peer?.name ?? "";
      })
      .filter((name) => name.length > 0);
  }, [speakerLevels, peers]);

  const maxSpeakerLevel = useMemo(() => {
    if (speakerLevels.length === 0) return 0;
    return speakerLevels.reduce((max, s) => (s.speaking ? Math.max(max, s.level) : max), 0);
  }, [speakerLevels]);

  // Global fail-closed events + desktop global PTT. Every ambiguity path —
  // window blur, page hidden, pagehide — maps to a fail-closed mute; the shared
  // PttController treats repeated releases as harmless no-ops.
  useEffect(() => {
    if (!joined) return;
    const controller = controllerRef.current;
    if (!controller) return;

    const onBlur = () => controller.release();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") controller.release();
    };
    const onPageHide = () => controller.release();
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    const bridge = getBridge();
    const offDown = bridge?.onPttDown(() => controller.press());
    const offUp = bridge?.onPttUp(() => controller.release());

    return () => {
      controller.release();
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
            <div className="desktop-fallback">
              <a className="link" href={`commanderlink://join/${roomId}`}>
                In Desktop-App öffnen
              </a>
              <p className="desktop-fallback-hint">
                App noch nicht installiert?{" "}
                <a className="link" href={WINDOWS_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                  Windows-App herunterladen
                </a>
              </p>
            </div>
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
        <DesktopPttIndicator />
        <StatusPill status={status} />
      </header>

      <div className="ptt-stage">
        <PttButton
          main={circle.main}
          sub={circle.sub}
          active={speaking}
          own={own}
          speakerLevel={maxSpeakerLevel}
          onPress={() => controllerRef.current?.press()}
          onRelease={() => controllerRef.current?.release()}
        />
        {desktop && <p className="ptt-hint">Global: {bindingLabel(desktopSettings?.primaryPttBinding ?? null)} halten zum Sprechen.</p>}
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
            const levelInfo = speakerLevels.find((s) => s.participantId === peer.id);
            const isSpeaking = levelInfo?.speaking ?? false;
            return (
              <li key={peer.id} className={`peer-row${isSpeaking ? " speaking" : ""}`}>
                <span className={`mic-icon${isSpeaking ? " on" : ""}`} aria-hidden="true" />
                <span className="peer-name">
                  {peer.name}
                  {peer.connectionState === "reconnecting" && (
                    <span className="peer-reconnect"> · verbindet neu</span>
                  )}
                </span>
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

      {(DIAGNOSTICS_ENABLED || WEBRTC_DEBUG_ENABLED) && (
        <DiagnosticsPanel transport={connectionRef.current} />
      )}

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
  speakerLevel,
  onPress,
  onRelease,
}: {
  main: string;
  sub: string;
  active: boolean;
  own: boolean;
  speakerLevel: number;
  onPress: () => void;
  onRelease: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const gestureRef = useRef<PttGesture | null>(null);
  const onPressRef = useRef(onPress);
  const onReleaseRef = useRef(onRelease);
  const scale = active ? 1 + (speakerLevel / 100) * 0.15 : 1;

  // Keep the gesture callbacks current without re-creating the gesture (and
  // without spuriously releasing PTT) on every re-render.
  useEffect(() => {
    onPressRef.current = onPress;
    onReleaseRef.current = onRelease;
  });

  useEffect(() => {
    const gesture = new PttGesture({
      getElement: () => ref.current,
      onPress: () => onPressRef.current(),
      onRelease: () => onReleaseRef.current(),
    });
    gestureRef.current = gesture;
    const unbindGlobal = gesture.bindGlobalListeners({
      window: {
        addEventListener: (type, listener) => window.addEventListener(type, listener),
        removeEventListener: (type, listener) => window.removeEventListener(type, listener),
      },
      document: {
        visibilityState: () => document.visibilityState,
        addEventListener: (type, listener) =>
          document.addEventListener(type, listener),
        removeEventListener: (type, listener) =>
          document.removeEventListener(type, listener),
      },
    });
    return () => {
      gesture.stopTalking();
      unbindGlobal();
      gestureRef.current = null;
    };
  }, []);

  return (
    <button
      ref={ref}
      className={`ptt${active ? " active" : ""}${own ? " own" : ""}`}
      style={{ "--speaker-scale": scale } as React.CSSProperties}
      aria-pressed={own}
      aria-label="Push-to-talk: gedrückt halten zum Sprechen"
      onPointerDown={(e) => gestureRef.current?.handlePointerDown(e)}
      onPointerUp={(e) => gestureRef.current?.handlePointerUp(e)}
      onPointerCancel={(e) => gestureRef.current?.handlePointerCancel(e)}
      onLostPointerCapture={(e) => gestureRef.current?.handleLostPointerCapture(e)}
      onPointerLeave={(e) => gestureRef.current?.handlePointerLeave(e)}
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
