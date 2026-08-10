# Discord invitation sharing

`/commander` remains an ephemeral private room-creation response. When
`COMMANDER_CHANNEL_ID` and `DISCORD_BOT_TOKEN` are configured, the response also
contains **An Commander senden**. Clicking it publishes the existing room's
browser and app links to that channel; it never creates another room.

Discord channel permissions determine invitation visibility. The application
needs **View Channel**, **Send Messages**, and **Embed Links** in the configured
channel. Administrator permission is not required.

Required Discord Worker configuration:

```text
COMMANDER_CHANNEL_ID=<discord-channel-id>
COMMANDER_LINK_WEB_URL=https://commander-link.joinoops.win
```

If the channel is absent or unreachable, room creation continues normally and
sharing returns a private, user-safe error. The server logs only a reason, never
the bot token or other credentials.
