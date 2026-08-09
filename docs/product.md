# Product specification

## Problem

Raid commanders already use Discord to speak to the full squad. They sometimes need a second private voice path for 2–4 commanders/leads without leaving or replacing the Discord voice channel.

## MVP promise

**Hold one control to speak privately to the commander group; release it to disappear from that microphone path.** Discord continues untouched in parallel.

## Users

- Desktop commander: game focused, Discord active, Commander Link minimized/backgrounded, global F8 for private PTT.
- Browser commander: no installation; second monitor/browser window with a very large hold-to-talk control.

## Core journeys

### Start a room (Discord)
Rooms are started only through the authorized Discord integration. A commander in
a configured, enabled guild with the Commander role runs `/commander`; Discord
authorizes, Commander Link initializes the room, and Discord publishes **two**
links to the same room — an HTTPS browser invite and a `commanderlink://` deep
link for the installed desktop app. There is no public "create room" on the
website and no creator account/key.

### Join in browser
Open the HTTPS invite, enter display name, grant microphone, join muted, hold red button to speak.

### Join in desktop app
Open the same invite (or the `commanderlink://` deep link), which opens/activates Electron on the same room, join muted, hold F8 to speak.

## UX rules

- Never auto-transmit.
- Never toggle by default.
- Clear visual TX indicator while transmitting.
- Participant state must not pretend to know Discord mute state.
- The app must remain useful with Discord on the same PC.
- No unnecessary setup during a raid.
