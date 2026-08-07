# Product specification

## Problem

Raid commanders already use Discord to speak to the full squad. They sometimes need a second private voice path for 2–4 commanders/leads without leaving or replacing the Discord voice channel.

## MVP promise

**Hold one control to speak privately to the commander group; release it to disappear from that microphone path.** Discord continues untouched in parallel.

## Users

- Desktop commander: game focused, Discord active, Commander Link minimized/backgrounded, global F8 for private PTT.
- Browser commander: no installation; second monitor/browser window with a very large hold-to-talk control.

## Core journeys

### Create
A user creates a temporary room and receives one HTTPS invitation. No account required.

### Join in browser
Open invite, enter display name, grant microphone, join muted, hold red button to speak.

### Join in desktop app
Open same invite, choose desktop app, deep link opens/activates Electron, join muted, hold F8 to speak.

## UX rules

- Never auto-transmit.
- Never toggle by default.
- Clear visual TX indicator while transmitting.
- Participant state must not pretend to know Discord mute state.
- The app must remain useful with Discord on the same PC.
- No unnecessary setup during a raid.
