// Ambient types for the Metered Video SDK loaded from the CDN in index.html.
// We intentionally use the proven Video SDK (global `Metered`) as validated in the
// working reference app, rather than a bundled npm package. See docs/vendor-notes.md.

export interface MeteredParticipant {
  _id?: string;
  name?: string;
  isAdmin?: boolean;
  meetingSessionId?: string;
  roomId?: string;
}

export interface MeteredTrackItem {
  type: "audio" | "video";
  streamId: string;
  track: MediaStreamTrack;
  participantSessionId?: string;
  name?: string;
}

export interface MeteredJoinOptions {
  roomURL: string;
  name: string;
  accessToken?: string;
  receiveAudioStreamType?: "only_individual" | "none" | "only_composed" | "all";
  receiveVideoStreamType?: "only_individual" | "none" | "only_composed" | "all";
}

export interface MeteredMeetingInfo {
  roomId: string;
  meetingSessionId: string;
  participantSessionId: string;
  onlineParticipants: MeteredParticipant[];
}

export interface MeteredMeeting {
  join(options: MeteredJoinOptions): Promise<MeteredMeetingInfo>;
  leaveMeeting(): Promise<void>;
  startAudio(): Promise<void>;
  stopAudio(): Promise<void>;
  muteLocalAudio(): Promise<void>;
  unmuteLocalAudio(): Promise<void> | void;
  getOnlineParticipants(): MeteredParticipant[];
  on(event: "participantJoined", cb: (p: MeteredParticipant) => void): void;
  on(event: "participantLeft", cb: (p: MeteredParticipant) => void): void;
  on(event: "onlineParticipants", cb: (p: MeteredParticipant[]) => void): void;
  on(event: "activeSpeaker", cb: (info: { name?: string } | null) => void): void;
  on(event: "stateChanged", cb: (state: string) => void): void;
  on(event: "meetingLeft", cb: () => void): void;
  on(event: "remoteTrackStarted", cb: (t: MeteredTrackItem) => void): void;
  on(event: "remoteTrackStopped", cb: (t: MeteredTrackItem) => void): void;
  on(event: "localTrackStarted", cb: (t: MeteredTrackItem) => void): void;
  on(event: "localTrackStopped", cb: (t: MeteredTrackItem) => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

export interface MeteredNamespace {
  Meeting: new () => MeteredMeeting;
}

declare global {
  interface Window {
    Metered?: MeteredNamespace;
  }
  // eslint-disable-next-line no-var
  var Metered: MeteredNamespace | undefined;
}
